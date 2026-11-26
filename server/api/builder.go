package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

type buildRequest struct {
	ServerURL    string   `json:"server_url"`
	EncKey       string   `json:"encryption_key"`
	Sleep        int      `json:"sleep"`
	Jitter       int      `json:"jitter"`
	KillDate     string   `json:"kill_date"`
	WorkingHours string   `json:"working_hours"`
	TargetOS     string   `json:"target_os"`
	TargetArch   string   `json:"target_arch"`
	Modules      []string `json:"modules"`
	OutputFormat string   `json:"output_format"`
	CodeSign     bool     `json:"code_sign"`
}

func (s *Server) handleBuilderGenerate(w http.ResponseWriter, r *http.Request) {
	var req buildRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "Invalid request", http.StatusBadRequest)
		return
	}
	// In Phase 2 this will trigger GitHub Actions
	operator := r.Context().Value(operatorKey).(string)
	s.DB.LogActivity("builder", operator+" triggered agent build ("+req.TargetOS+"/"+req.TargetArch+")")
	jsonResponse(w, map[string]interface{}{
		"build_id": "build-" + req.TargetOS + "-" + req.TargetArch,
		"status":   "queued",
		"message":  "Build queued. GitHub Actions will compile the agent.",
	})
}

func (s *Server) handleBuilderStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	jsonResponse(w, map[string]string{
		"build_id": id,
		"status":   "pending",
		"message":  "Build system not yet configured (Phase 2)",
	})
}

func (s *Server) handleBuilderDownload(w http.ResponseWriter, r *http.Request) {
	jsonError(w, "Build not available yet (Phase 2)", http.StatusNotFound)
}
