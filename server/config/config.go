package config

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"strconv"
)

type Config struct {
	ListenAddr   string
	ListenPort   int
	DBPath       string
	JWTSecret    string
	AESKey       string
	TLSCert      string
	TLSKey       string
	StaticDir    string
	DataDir      string
}

func Load() *Config {
	cfg := &Config{
		ListenAddr: getEnv("SG_LISTEN_ADDR", "0.0.0.0"),
		ListenPort: getEnvInt("SG_LISTEN_PORT", 8443),
		DBPath:     getEnv("SG_DB_PATH", "shadowgrid.db"),
		JWTSecret:  getEnv("SG_JWT_SECRET", "shadowgrid-jwt-secret-key-2026"),
		AESKey:     getEnv("SG_AES_KEY", generateRandom(32)),
		TLSCert:    getEnv("SG_TLS_CERT", ""),
		TLSKey:     getEnv("SG_TLS_KEY", ""),
		StaticDir:  getEnv("SG_STATIC_DIR", "static"),
		DataDir:    getEnv("SG_DATA_DIR", "data"),
	}
	os.MkdirAll(cfg.DataDir, 0755)
	return cfg
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func generateRandom(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}
