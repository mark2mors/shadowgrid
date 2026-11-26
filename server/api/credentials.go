package api

import (
	"encoding/csv"
	"fmt"
	"net/http"
)

func (s *Server) handleGetCredentials(w http.ResponseWriter, r *http.Request) {
	agentID := r.URL.Query().Get("agent_id")
	source := r.URL.Query().Get("source")
	search := r.URL.Query().Get("search")
	creds, err := s.DB.GetCredentials(agentID, source, search)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if creds == nil {
		jsonResponse(w, []interface{}{})
		return
	}
	jsonResponse(w, creds)
}

func (s *Server) handleExportCredentials(w http.ResponseWriter, r *http.Request) {
	creds, err := s.DB.GetCredentials("", "", "")
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", "attachment; filename=credentials.csv")
	writer := csv.NewWriter(w)
	writer.Write([]string{"Agent", "Source", "URL", "Username", "Password", "Notes", "Created"})
	for _, c := range creds {
		writer.Write([]string{c.AgentID, c.Source, c.URL, c.Username, c.Password, c.Notes, fmt.Sprintf("%v", c.CreatedAt)})
	}
	writer.Flush()
}
