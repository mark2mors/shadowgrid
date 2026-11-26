package api

import (
	"encoding/json"
	"net/http"
	"strconv"
)

func (s *Server) handleGetStats(w http.ResponseWriter, r *http.Request) {
	stats, err := s.DB.GetStats()
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, stats)
}

func (s *Server) handleGetActivity(w http.ResponseWriter, r *http.Request) {
	limitStr := r.URL.Query().Get("limit")
	limit := 50
	if limitStr != "" {
		limit, _ = strconv.Atoi(limitStr)
	}
	activity, err := s.DB.GetActivity(limit)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if activity == nil {
		jsonResponse(w, []interface{}{})
		return
	}
	jsonResponse(w, activity)
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.DB.GetSettings()
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, settings)
}

func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var settings map[string]string
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		jsonError(w, "Invalid request", http.StatusBadRequest)
		return
	}
	for k, v := range settings {
		if err := s.DB.SetSetting(k, v); err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	operator := r.Context().Value(operatorKey).(string)
	s.DB.LogActivity("settings", operator+" updated settings")
	jsonResponse(w, map[string]string{"status": "updated"})
}
