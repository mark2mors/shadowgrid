package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"shadowgrid/listener"
	"shadowgrid/models"
)

type createListenerRequest struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	BindHost   string `json:"bind_host"`
	BindPort   int    `json:"bind_port"`
	Domain     string `json:"domain"`
	ConfigJSON string `json:"config_json"`
}

func (s *Server) handleGetListeners(w http.ResponseWriter, r *http.Request) {
	listeners, err := s.DB.GetListeners()
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if listeners == nil {
		listeners = []models.Listener{}
	}
	jsonResponse(w, listeners)
}

func (s *Server) handleCreateListener(w http.ResponseWriter, r *http.Request) {
	var req createListenerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.ConfigJSON == "" {
		req.ConfigJSON = "{}"
	}
	l := &models.Listener{
		Name:       req.Name,
		Type:       req.Type,
		BindHost:   req.BindHost,
		BindPort:   req.BindPort,
		Domain:     req.Domain,
		ConfigJSON: req.ConfigJSON,
	}
	id, err := s.DB.CreateListener(l)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	operator := r.Context().Value(operatorKey).(string)
	s.DB.LogActivity("listener", operator+" created listener "+req.Name)
	jsonResponse(w, map[string]interface{}{"id": id, "status": "created"})
}

func (s *Server) handleUpdateListener(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, _ := strconv.Atoi(idStr)
	var req createListenerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.ConfigJSON == "" {
		req.ConfigJSON = "{}"
	}
	l := &models.Listener{
		Name:       req.Name,
		Type:       req.Type,
		BindHost:   req.BindHost,
		BindPort:   req.BindPort,
		Domain:     req.Domain,
		ConfigJSON: req.ConfigJSON,
	}
	if err := s.DB.UpdateListener(id, l); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]string{"status": "updated"})
}

func (s *Server) handleStartListener(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, _ := strconv.Atoi(idStr)

	// Load listener config from DB
	l, err := s.DB.GetListener(id)
	if err != nil {
		jsonError(w, fmt.Sprintf("listener #%d not found: %v", id, err), http.StatusNotFound)
		return
	}

	// Check if already running in-memory
	s.mu.Lock()
	if existing, ok := s.Listeners[id]; ok && existing.IsRunning() {
		s.mu.Unlock()
		jsonError(w, "listener is already running", http.StatusConflict)
		return
	}
	s.mu.Unlock()

	// Create and start the HTTPS listener
	hl := &listener.HTTPSListener{
		ID:       l.ID,
		Name:     l.Name,
		BindHost: l.BindHost,
		BindPort: l.BindPort,
		Domain:   l.Domain,
		Handler:  s.Handler,
		Config:   s.Config,
	}

	if err := hl.Start(); err != nil {
		jsonError(w, fmt.Sprintf("failed to start listener: %v", err), http.StatusInternalServerError)
		return
	}

	// Store in running map
	s.mu.Lock()
	s.Listeners[id] = hl
	s.mu.Unlock()

	// Update DB status
	if err := s.DB.UpdateListenerStatus(id, "running"); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	operator := r.Context().Value(operatorKey).(string)
	s.DB.LogActivity("listener", operator+" started listener "+l.Name+" (#"+idStr+")")
	log.Printf("[API] Listener %q (#%d) started on %s:%d by %s", l.Name, id, l.BindHost, l.BindPort, operator)
	jsonResponse(w, map[string]string{"status": "running"})
}

func (s *Server) handleStopListener(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, _ := strconv.Atoi(idStr)

	// Find running listener
	s.mu.Lock()
	hl, ok := s.Listeners[id]
	s.mu.Unlock()

	if !ok || hl == nil {
		// Not in memory — just update DB
		s.DB.UpdateListenerStatus(id, "stopped")
		jsonResponse(w, map[string]string{"status": "stopped"})
		return
	}

	// Graceful stop
	if err := hl.Stop(); err != nil {
		log.Printf("[API] Error stopping listener #%d: %v", id, err)
	}

	// Remove from running map
	s.mu.Lock()
	delete(s.Listeners, id)
	s.mu.Unlock()

	// Update DB status
	if err := s.DB.UpdateListenerStatus(id, "stopped"); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	operator := r.Context().Value(operatorKey).(string)
	s.DB.LogActivity("listener", operator+" stopped listener #"+idStr)
	log.Printf("[API] Listener #%d stopped by %s", id, operator)
	jsonResponse(w, map[string]string{"status": "stopped"})
}
