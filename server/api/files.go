package api

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"shadowgrid/models"
)

func (s *Server) handleGetFiles(w http.ResponseWriter, r *http.Request) {
	agentID := r.URL.Query().Get("agent_id")
	direction := r.URL.Query().Get("direction")
	files, err := s.DB.GetFiles(agentID, direction)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if files == nil {
		jsonResponse(w, []interface{}{})
		return
	}
	jsonResponse(w, files)
}

func (s *Server) handleFileUpload(w http.ResponseWriter, r *http.Request) {
	r.ParseMultipartForm(100 << 20) // 100MB max
	file, header, err := r.FormFile("file")
	if err != nil {
		jsonError(w, "No file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	uploadDir := filepath.Join(s.Config.DataDir, "uploads")
	os.MkdirAll(uploadDir, 0755)

	ts := time.Now().UnixNano()
	localName := filepath.Join(uploadDir, strconv.FormatInt(ts, 10)+"_"+header.Filename)
	dst, err := os.Create(localName)
	if err != nil {
		jsonError(w, "Failed to save file", http.StatusInternalServerError)
		return
	}
	defer dst.Close()
	written, _ := io.Copy(dst, file)

	agentID := r.FormValue("agent_id")
	f := &models.File{
		AgentID:   agentID,
		Filename:  header.Filename,
		Filepath:  r.FormValue("filepath"),
		Size:      written,
		Direction: "upload",
		LocalPath: localName,
	}
	id, err := s.DB.CreateFile(f)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	operator := r.Context().Value(operatorKey).(string)
	s.DB.LogActivity("file", operator+" uploaded "+header.Filename)
	jsonResponse(w, map[string]interface{}{"id": id, "status": "uploaded"})
}

func (s *Server) handleFileDownload(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, _ := strconv.Atoi(idStr)
	f, err := s.DB.GetFile(id)
	if err != nil {
		jsonError(w, "File not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Disposition", "attachment; filename="+f.Filename)
	http.ServeFile(w, r, f.LocalPath)
}
