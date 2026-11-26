package vnc

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin:     func(r *http.Request) bool { return true },
	ReadBufferSize:  65536,
	WriteBufferSize: 65536,
}

// VNCSession represents an active remote desktop session
type VNCSession struct {
	ID        string          `json:"session_id"`
	AgentID   string          `json:"agent_id"`
	Mode      string          `json:"mode"` // watch, control, hidden
	Active    bool            `json:"active"`
	AgentConn *websocket.Conn `json:"-"`
	PanelConn *websocket.Conn `json:"-"`
	mu        sync.Mutex
}

// VNCRelay manages WebSocket connections for remote desktop sessions
type VNCRelay struct {
	sessions map[string]*VNCSession
	mu       sync.RWMutex
}

// NewVNCRelay creates a new VNC relay manager
func NewVNCRelay() *VNCRelay {
	return &VNCRelay{
		sessions: make(map[string]*VNCSession),
	}
}

// HandleAgentVNC handles WebSocket connections from agents streaming screen data
func (r *VNCRelay) HandleAgentVNC(w http.ResponseWriter, req *http.Request) {
	sessionID := req.URL.Query().Get("session_id")
	if sessionID == "" {
		http.Error(w, "session_id required", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, req, nil)
	if err != nil {
		log.Printf("[VNC] Agent WebSocket upgrade failed: %v", err)
		return
	}

	log.Printf("[VNC] Agent connected for session %s", sessionID)

	r.mu.Lock()
	session, exists := r.sessions[sessionID]
	if !exists {
		session = &VNCSession{
			ID:     sessionID,
			Active: true,
		}
		r.sessions[sessionID] = session
	}
	session.mu.Lock()
	if session.AgentConn != nil {
		session.AgentConn.Close()
	}
	session.AgentConn = conn
	session.Active = true
	session.mu.Unlock()
	r.mu.Unlock()

	// Relay: agent frames -> panel
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Printf("[VNC] Agent read error for session %s: %v", sessionID, err)
			break
		}

		session.mu.Lock()
		if session.PanelConn != nil {
			err = session.PanelConn.WriteMessage(websocket.TextMessage, msg)
			if err != nil {
				log.Printf("[VNC] Panel write error for session %s: %v", sessionID, err)
			}
		}
		session.mu.Unlock()
	}

	// Cleanup
	session.mu.Lock()
	session.AgentConn = nil
	session.Active = false
	session.mu.Unlock()

	log.Printf("[VNC] Agent disconnected from session %s", sessionID)
}

// HandlePanelVNC handles WebSocket connections from the panel for viewing/controlling
func (r *VNCRelay) HandlePanelVNC(w http.ResponseWriter, req *http.Request) {
	sessionID := req.URL.Query().Get("session_id")
	if sessionID == "" {
		http.Error(w, "session_id required", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, req, nil)
	if err != nil {
		log.Printf("[VNC] Panel WebSocket upgrade failed: %v", err)
		return
	}

	log.Printf("[VNC] Panel connected for session %s", sessionID)

	r.mu.Lock()
	session, exists := r.sessions[sessionID]
	if !exists {
		session = &VNCSession{
			ID:     sessionID,
			Active: true,
		}
		r.sessions[sessionID] = session
	}
	session.mu.Lock()
	if session.PanelConn != nil {
		session.PanelConn.Close()
	}
	session.PanelConn = conn
	session.mu.Unlock()
	r.mu.Unlock()

	// Relay: panel input events -> agent
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Printf("[VNC] Panel read error for session %s: %v", sessionID, err)
			break
		}

		session.mu.Lock()
		if session.AgentConn != nil {
			err = session.AgentConn.WriteMessage(websocket.TextMessage, msg)
			if err != nil {
				log.Printf("[VNC] Agent write error for session %s: %v", sessionID, err)
			}
		}
		session.mu.Unlock()
	}

	// Cleanup
	session.mu.Lock()
	session.PanelConn = nil
	session.mu.Unlock()

	log.Printf("[VNC] Panel disconnected from session %s", sessionID)
}

// CreateSession creates a new VNC session and returns its ID
func (r *VNCRelay) CreateSession(agentID string, mode string) string {
	sessionID := uuid.New().String()[:8]

	r.mu.Lock()
	r.sessions[sessionID] = &VNCSession{
		ID:      sessionID,
		AgentID: agentID,
		Mode:    mode,
		Active:  true,
	}
	r.mu.Unlock()

	log.Printf("[VNC] Created session %s for agent %s (mode: %s)", sessionID, agentID, mode)
	return sessionID
}

// StopSession closes a VNC session
func (r *VNCRelay) StopSession(sessionID string) {
	r.mu.Lock()
	session, exists := r.sessions[sessionID]
	if exists {
		session.mu.Lock()
		session.Active = false
		if session.AgentConn != nil {
			// Send stop message to agent
			stopMsg, _ := json.Marshal(map[string]string{"type": "stop"})
			session.AgentConn.WriteMessage(websocket.TextMessage, stopMsg)
			session.AgentConn.Close()
			session.AgentConn = nil
		}
		if session.PanelConn != nil {
			session.PanelConn.Close()
			session.PanelConn = nil
		}
		session.mu.Unlock()
		delete(r.sessions, sessionID)
	}
	r.mu.Unlock()

	if exists {
		log.Printf("[VNC] Stopped session %s", sessionID)
	}
}

// GetSessions returns all active sessions
func (r *VNCRelay) GetSessions() []VNCSession {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var sessions []VNCSession
	for _, s := range r.sessions {
		s.mu.Lock()
		sessions = append(sessions, VNCSession{
			ID:      s.ID,
			AgentID: s.AgentID,
			Mode:    s.Mode,
			Active:  s.AgentConn != nil && s.PanelConn != nil,
		})
		s.mu.Unlock()
	}
	return sessions
}

// HandleStartSession is the HTTP handler for POST /api/vnc/start
func (r *VNCRelay) HandleStartSession(w http.ResponseWriter, req *http.Request) {
	var body struct {
		AgentID string `json:"agent_id"`
		Mode    string `json:"mode"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil || body.AgentID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "agent_id required"})
		return
	}
	if body.Mode == "" {
		body.Mode = "watch"
	}

	sessionID := r.CreateSession(body.AgentID, body.Mode)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"session_id": sessionID,
		"agent_id":   body.AgentID,
		"mode":       body.Mode,
	})
}

// HandleStopSession is the HTTP handler for POST /api/vnc/stop
func (r *VNCRelay) HandleStopSession(w http.ResponseWriter, req *http.Request) {
	var body struct {
		SessionID string `json:"session_id"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil || body.SessionID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "session_id required"})
		return
	}

	r.StopSession(body.SessionID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"stopped": true})
}

// HandleGetSessions is the HTTP handler for GET /api/vnc/sessions
func (r *VNCRelay) HandleGetSessions(w http.ResponseWriter, req *http.Request) {
	sessions := r.GetSessions()
	if sessions == nil {
		sessions = []VNCSession{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sessions)
}
