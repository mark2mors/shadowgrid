package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

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
	if err := s.DB.UpdateListenerStatus(id, "running"); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	operator := r.Context().Value(operatorKey).(string)
	s.DB.LogActivity("listener", operator+" started listener #"+idStr)
	jsonResponse(w, map[string]string{"status": "running"})
}

func (s *Server) handleStopListener(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, _ := strconv.Atoi(idStr)
	if err := s.DB.UpdateListenerStatus(id, "stopped"); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	operator := r.Context().Value(operatorKey).(string)
	s.DB.LogActivity("listener", operator+" stopped listener #"+idStr)
	jsonResponse(w, map[string]string{"status": "stopped"})
}
