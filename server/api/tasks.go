package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"shadowgrid/models"
)

type createTaskRequest struct {
	TaskType string          `json:"task_type"`
	Args     json.RawMessage `json:"args"`
}

func (s *Server) handleCreateTask(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "id")
	var req createTaskRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "Invalid request", http.StatusBadRequest)
		return
	}

	argsJSON := "{}"
	if req.Args != nil {
		argsJSON = string(req.Args)
	}

	operator := r.Context().Value(operatorKey).(string)
	task := &models.Task{
		AgentID:   agentID,
		TaskType:  req.TaskType,
		ArgsJSON:  argsJSON,
		CreatedBy: operator,
	}

	id, err := s.DB.CreateTask(task)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.DB.LogActivity("task", operator+" created task "+req.TaskType+" for agent "+agentID)
	jsonResponse(w, map[string]interface{}{"id": id, "status": "created"})
}
