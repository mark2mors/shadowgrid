package tunnel

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// Message types for the WebSocket tunnel protocol
type TunnelMessage struct {
	Type   string `json:"type"`    // "connect", "connected", "data", "close", "error"
	ConnID string `json:"conn_id"` // unique connection ID
	Addr   string `json:"addr,omitempty"`
	Port   int    `json:"port,omitempty"`
	Data   string `json:"data,omitempty"` // base64 encoded
	Error  string `json:"error,omitempty"`
}

type agentTunnel struct {
	ws          *websocket.Conn
	listener    net.Listener
	port        int
	connCount   int64
	connections map[string]net.Conn
	mu          sync.Mutex
	stopCh      chan struct{}
}

// TunnelRelay manages SOCKS5 tunnels through agents
type TunnelRelay struct {
	agents map[string]*agentTunnel
	mu     sync.RWMutex
}

func NewRelay() *TunnelRelay {
	return &TunnelRelay{
		agents: make(map[string]*agentTunnel),
	}
}

var upgrader = websocket.Upgrader{
	CheckOrigin:  func(r *http.Request) bool { return true },
	ReadBufferSize:  16384,
	WriteBufferSize: 16384,
}

// HandleAgentTunnel upgrades to WebSocket for agent tunnel data relay
func (r *TunnelRelay) HandleAgentTunnel(w http.ResponseWriter, req *http.Request) {
	agentID := req.URL.Query().Get("agent_id")
	if agentID == "" {
		http.Error(w, "agent_id required", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, req, nil)
	if err != nil {
		log.Printf("[TUNNEL] WebSocket upgrade failed for %s: %v", agentID, err)
		return
	}

	log.Printf("[TUNNEL] Agent %s connected for tunnel relay", agentID)

	r.mu.Lock()
	existing, exists := r.agents[agentID]
	if exists && existing.ws != nil {
		existing.ws.Close()
	}
	if !exists {
		r.agents[agentID] = &agentTunnel{
			connections: make(map[string]net.Conn),
			stopCh:      make(chan struct{}),
		}
	}
	r.agents[agentID].ws = conn
	at := r.agents[agentID]
	r.mu.Unlock()

	// Read messages from agent
	for {
		_, msgBytes, err := conn.ReadMessage()
		if err != nil {
			log.Printf("[TUNNEL] Agent %s WebSocket read error: %v", agentID, err)
			break
		}

		var msg TunnelMessage
		if err := json.Unmarshal(msgBytes, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "connected":
			// Agent successfully connected to target — nothing to do,
			// SOCKS5 success reply is already sent in handleSOCKS5
			log.Printf("[TUNNEL] Agent %s connected to target for conn %s", agentID, msg.ConnID)

		case "data":
			// Data from agent → send to SOCKS5 client
			data, err := base64.StdEncoding.DecodeString(msg.Data)
			if err != nil {
				continue
			}
			at.mu.Lock()
			clientConn, ok := at.connections[msg.ConnID]
			at.mu.Unlock()
			if ok {
				clientConn.Write(data)
			}

		case "close":
			at.mu.Lock()
			if clientConn, ok := at.connections[msg.ConnID]; ok {
				clientConn.Close()
				delete(at.connections, msg.ConnID)
			}
			at.mu.Unlock()

		case "error":
			log.Printf("[TUNNEL] Agent %s error for conn %s: %s", agentID, msg.ConnID, msg.Error)
			at.mu.Lock()
			if clientConn, ok := at.connections[msg.ConnID]; ok {
				clientConn.Close()
				delete(at.connections, msg.ConnID)
			}
			at.mu.Unlock()
		}
	}

	// Cleanup
	r.mu.Lock()
	if at, ok := r.agents[agentID]; ok {
		at.ws = nil
	}
	r.mu.Unlock()
}

// StartProxy starts a local SOCKS5 listener that relays through an agent
func (r *TunnelRelay) StartProxy(agentID string) (int, error) {
	r.mu.Lock()
	at, exists := r.agents[agentID]
	if !exists || at.ws == nil {
		r.mu.Unlock()
		return 0, fmt.Errorf("agent %s not connected for tunnel", agentID)
	}
	if at.listener != nil {
		port := at.port
		r.mu.Unlock()
		return port, nil // already running
	}
	r.mu.Unlock()

	listener, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		return 0, fmt.Errorf("failed to bind: %v", err)
	}

	port := listener.Addr().(*net.TCPAddr).Port

	r.mu.Lock()
	at.listener = listener
	at.port = port
	at.stopCh = make(chan struct{})
	r.mu.Unlock()

	log.Printf("[TUNNEL] SOCKS5 proxy started on port %d for agent %s", port, agentID)

	go r.acceptLoop(agentID, listener)

	return port, nil
}

// StopProxy stops the SOCKS5 listener for an agent
func (r *TunnelRelay) StopProxy(agentID string) error {
	r.mu.Lock()
	at, exists := r.agents[agentID]
	if !exists {
		r.mu.Unlock()
		return fmt.Errorf("no tunnel for agent %s", agentID)
	}
	if at.listener != nil {
		at.listener.Close()
		at.listener = nil
	}
	if at.stopCh != nil {
		close(at.stopCh)
		at.stopCh = nil
	}
	// Close all client connections
	at.mu.Lock()
	for id, conn := range at.connections {
		conn.Close()
		delete(at.connections, id)
	}
	at.mu.Unlock()
	at.port = 0
	atomic.StoreInt64(&at.connCount, 0)
	r.mu.Unlock()

	log.Printf("[TUNNEL] SOCKS5 proxy stopped for agent %s", agentID)
	return nil
}

// GetStatus returns tunnel status for an agent
func (r *TunnelRelay) GetStatus(agentID string) (bool, int, int64) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	at, exists := r.agents[agentID]
	if !exists {
		return false, 0, 0
	}
	active := at.listener != nil && at.ws != nil
	return active, at.port, atomic.LoadInt64(&at.connCount)
}

func (r *TunnelRelay) acceptLoop(agentID string, listener net.Listener) {
	for {
		conn, err := listener.Accept()
		if err != nil {
			return // listener closed
		}
		go r.handleSOCKS5(agentID, conn)
	}
}

func (r *TunnelRelay) handleSOCKS5(agentID string, client net.Conn) {
	defer func() {
		client.Close()
	}()

	r.mu.RLock()
	at, exists := r.agents[agentID]
	r.mu.RUnlock()
	if !exists || at.ws == nil {
		return
	}

	// Set read deadline for handshake
	client.SetReadDeadline(time.Now().Add(10 * time.Second))

	// SOCKS5 handshake
	buf := make([]byte, 258)
	n, err := client.Read(buf)
	if err != nil || n < 2 || buf[0] != 0x05 {
		return
	}

	// No auth required
	client.Write([]byte{0x05, 0x00})

	// Read connect request
	n, err = client.Read(buf)
	if err != nil || n < 7 || buf[1] != 0x01 {
		client.Write([]byte{0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
		return
	}

	var targetAddr string
	var targetPort int

	switch buf[3] {
	case 0x01: // IPv4
		if n < 10 {
			return
		}
		targetAddr = fmt.Sprintf("%d.%d.%d.%d", buf[4], buf[5], buf[6], buf[7])
		targetPort = int(buf[8])<<8 | int(buf[9])
	case 0x03: // Domain
		domLen := int(buf[4])
		if n < 5+domLen+2 {
			return
		}
		targetAddr = string(buf[5 : 5+domLen])
		targetPort = int(buf[5+domLen])<<8 | int(buf[6+domLen])
	case 0x04: // IPv6
		if n < 22 {
			return
		}
		targetAddr = net.IP(buf[4:20]).String()
		targetPort = int(buf[20])<<8 | int(buf[21])
	default:
		client.Write([]byte{0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
		return
	}

	// Clear read deadline
	client.SetReadDeadline(time.Time{})

	// Generate connection ID
	connID := fmt.Sprintf("%s-%d", agentID[:8], time.Now().UnixNano()%1000000)

	// Store the client connection
	at.mu.Lock()
	at.connections[connID] = client
	at.mu.Unlock()
	atomic.AddInt64(&at.connCount, 1)

	// Send connect request to agent via WebSocket
	connectMsg := TunnelMessage{
		Type:   "connect",
		ConnID: connID,
		Addr:   targetAddr,
		Port:   targetPort,
	}
	msgBytes, _ := json.Marshal(connectMsg)

	at.mu.Lock()
	wsErr := at.ws.WriteMessage(websocket.TextMessage, msgBytes)
	at.mu.Unlock()

	if wsErr != nil {
		client.Write([]byte{0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
		at.mu.Lock()
		delete(at.connections, connID)
		at.mu.Unlock()
		return
	}

	// Send SOCKS5 success reply (we optimistically reply before agent confirms)
	client.Write([]byte{0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0})

	// Read data from client and forward to agent via WebSocket
	buf = make([]byte, 16384)
	for {
		n, err := client.Read(buf)
		if err != nil {
			break
		}
		if n > 0 {
			dataMsg := TunnelMessage{
				Type:   "data",
				ConnID: connID,
				Data:   base64.StdEncoding.EncodeToString(buf[:n]),
			}
			msgBytes, _ := json.Marshal(dataMsg)
			at.mu.Lock()
			err := at.ws.WriteMessage(websocket.TextMessage, msgBytes)
			at.mu.Unlock()
			if err != nil {
				break
			}
		}
	}

	// Send close to agent
	closeMsg := TunnelMessage{
		Type:   "close",
		ConnID: connID,
	}
	msgBytes, _ = json.Marshal(closeMsg)
	at.mu.Lock()
	at.ws.WriteMessage(websocket.TextMessage, msgBytes)
	delete(at.connections, connID)
	at.mu.Unlock()
	atomic.AddInt64(&at.connCount, -1)
}

// ServeWs is an HTTP handler that wraps HandleAgentTunnel for use with Chi
func (r *TunnelRelay) ServeWs(w http.ResponseWriter, req *http.Request) {
	r.HandleAgentTunnel(w, req)
}

// HandleStartProxy is the HTTP handler for POST /api/tunnel/start
func (r *TunnelRelay) HandleStartProxy(w http.ResponseWriter, req *http.Request) {
	var body struct {
		AgentID string `json:"agent_id"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil || body.AgentID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "agent_id required"})
		return
	}

	port, err := r.StartProxy(body.AgentID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"port":   port,
		"active": true,
	})
}

// HandleStopProxy is the HTTP handler for POST /api/tunnel/stop
func (r *TunnelRelay) HandleStopProxy(w http.ResponseWriter, req *http.Request) {
	var body struct {
		AgentID string `json:"agent_id"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil || body.AgentID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "agent_id required"})
		return
	}

	if err := r.StopProxy(body.AgentID); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"active": false,
	})
}

// HandleStatus is the HTTP handler for GET /api/tunnel/status?agent_id=X
func (r *TunnelRelay) HandleStatus(w http.ResponseWriter, req *http.Request) {
	agentID := req.URL.Query().Get("agent_id")
	if agentID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "agent_id required"})
		return
	}

	active, port, connections := r.GetStatus(agentID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"active":      active,
		"port":        port,
		"connections": connections,
	})
}

// Ensure io is used
var _ = io.EOF
