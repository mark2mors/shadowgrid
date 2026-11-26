package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"shadowgrid/models"
)

func (s *Server) handleGetAgents(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	search := r.URL.Query().Get("search")
	agents, err := s.DB.GetAgents(status, search)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if agents == nil {
		agents = []models.Agent{}
	}
	jsonResponse(w, agents)
}

func (s *Server) handleGetAgentsByCountry(w http.ResponseWriter, r *http.Request) {
	countries, err := s.DB.GetAgentsByCountry()
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if countries == nil {
		countries = []map[string]interface{}{}
	}
	jsonResponse(w, countries)
}

func (s *Server) handleGetAgent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	agent, err := s.DB.GetAgent(id)
	if err != nil {
		jsonError(w, "Agent not found", http.StatusNotFound)
		return
	}
	jsonResponse(w, agent)
}

func (s *Server) handleDeleteAgent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.DB.DeleteAgent(id); err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	operator := r.Context().Value(operatorKey).(string)
	s.DB.LogActivity("agent", operator+" deleted agent "+id)
	jsonResponse(w, map[string]string{"status": "deleted"})
}

func (s *Server) handleGetAgentTasks(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tasks, err := s.DB.GetTasksForAgent(id)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if tasks == nil {
		jsonResponse(w, []interface{}{})
		return
	}
	jsonResponse(w, tasks)
}

func (s *Server) handleGetAgentResults(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	results, err := s.DB.GetResultsForAgent(id)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if results == nil {
		jsonResponse(w, []interface{}{})
		return
	}
	jsonResponse(w, results)
}
