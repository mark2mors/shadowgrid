package listener

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"shadowgrid/config"
)

// HTTPSListener is a dynamically startable/stoppable TLS listener
// that routes agent sync traffic through the Handler.
type HTTPSListener struct {
	ID       int
	Name     string
	BindHost string
	BindPort int
	Domain   string
	CertFile string
	KeyFile  string
	Handler  *Handler
	Config   *config.Config

	server  *http.Server
	running bool
	mu      sync.Mutex
}

// Start launches the HTTPS listener in a background goroutine.
// If no cert/key files are configured, it generates a self-signed certificate.
func (l *HTTPSListener) Start() error {
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.running {
		return fmt.Errorf("listener %q is already running", l.Name)
	}

	certFile := l.CertFile
	keyFile := l.KeyFile

	// Generate self-signed cert if none provided
	if certFile == "" || keyFile == "" {
		var err error
		certFile, keyFile, err = l.generateSelfSigned()
		if err != nil {
			return fmt.Errorf("failed to generate self-signed cert: %w", err)
		}
		log.Printf("[LISTENER:%s] Generated self-signed TLS certificate", l.Name)
	}

	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return fmt.Errorf("failed to load TLS cert/key: %w", err)
	}

	tlsCfg := &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/sync", l.Handler.HandleSync)
	mux.HandleFunc("/api/v1/upload", l.Handler.HandleUpload)
	mux.HandleFunc("/api/v1/pkg/", l.Handler.HandleDownload)

	// Catch-all: return 200 with empty body for stealth (looks like a web server)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Server", "nginx")
		w.WriteHeader(http.StatusOK)
	})

	addr := fmt.Sprintf("%s:%d", l.BindHost, l.BindPort)
	l.server = &http.Server{
		Addr:      addr,
		Handler:   mux,
		TLSConfig: tlsCfg,
		// Timeouts to prevent slowloris
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("failed to bind %s: %w", addr, err)
	}

	tlsLn := tls.NewListener(ln, tlsCfg)

	go func() {
		log.Printf("[LISTENER:%s] HTTPS listening on %s", l.Name, addr)
		if err := l.server.Serve(tlsLn); err != nil && err != http.ErrServerClosed {
			log.Printf("[LISTENER:%s] Server error: %v", l.Name, err)
		}
		log.Printf("[LISTENER:%s] Stopped", l.Name)
	}()

	l.running = true
	return nil
}

// Stop gracefully shuts down the listener.
func (l *HTTPSListener) Stop() error {
	l.mu.Lock()
	defer l.mu.Unlock()

	if !l.running {
		return fmt.Errorf("listener %q is not running", l.Name)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := l.server.Shutdown(ctx); err != nil {
		// Force close if graceful shutdown fails
		l.server.Close()
		log.Printf("[LISTENER:%s] Forced shutdown: %v", l.Name, err)
	}

	l.running = false
	l.server = nil
	return nil
}

// IsRunning returns whether the listener is currently active.
func (l *HTTPSListener) IsRunning() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.running
}

// generateSelfSigned creates a self-signed ECDSA certificate and writes
// it to the data directory. Returns paths to the cert and key PEM files.
func (l *HTTPSListener) generateSelfSigned() (certPath, keyPath string, err error) {
	dataDir := "data"
	if l.Config != nil {
		dataDir = l.Config.DataDir
	}
	certsDir := filepath.Join(dataDir, "certs")
	os.MkdirAll(certsDir, 0700)

	certPath = filepath.Join(certsDir, fmt.Sprintf("listener_%d.crt", l.ID))
	keyPath = filepath.Join(certsDir, fmt.Sprintf("listener_%d.key", l.ID))

	// Generate ECDSA P-256 key
	privKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", err
	}

	serialNumber, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return "", "", err
	}

	// Determine SANs
	cn := l.Domain
	if cn == "" {
		cn = l.BindHost
	}
	if cn == "" || cn == "0.0.0.0" {
		cn = "localhost"
	}

	template := &x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			Organization: []string{"ShadowGrid"},
			CommonName:   cn,
		},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().Add(365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}

	// Add SANs
	if ip := net.ParseIP(cn); ip != nil {
		template.IPAddresses = []net.IP{ip}
	} else {
		template.DNSNames = []string{cn}
	}
	// Always include localhost
	template.DNSNames = append(template.DNSNames, "localhost")
	template.IPAddresses = append(template.IPAddresses, net.ParseIP("127.0.0.1"))

	derBytes, err := x509.CreateCertificate(rand.Reader, template, template, &privKey.PublicKey, privKey)
	if err != nil {
		return "", "", err
	}

	// Write cert PEM
	certOut, err := os.Create(certPath)
	if err != nil {
		return "", "", err
	}
	pem.Encode(certOut, &pem.Block{Type: "CERTIFICATE", Bytes: derBytes})
	certOut.Close()

	// Write key PEM
	keyOut, err := os.OpenFile(keyPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return "", "", err
	}
	privBytes, err := x509.MarshalECPrivateKey(privKey)
	if err != nil {
		return "", "", err
	}
	pem.Encode(keyOut, &pem.Block{Type: "EC PRIVATE KEY", Bytes: privBytes})
	keyOut.Close()

	return certPath, keyPath, nil
}
