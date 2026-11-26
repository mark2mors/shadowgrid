package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type contextKey string

const operatorKey contextKey = "operator"

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginResponse struct {
	Token string `json:"token"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "Invalid request", http.StatusBadRequest)
		return
	}

	op, err := s.DB.GetOperatorByUsername(req.Username)
	if err != nil {
		jsonError(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(op.PasswordHash), []byte(req.Password)); err != nil {
		jsonError(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":      op.Username,
		"role":     op.Role,
		"operator": op.Username,
		"exp":      time.Now().Add(24 * time.Hour).Unix(),
		"iat":      time.Now().Unix(),
	})

	tokenString, err := token.SignedString([]byte(s.Config.JWTSecret))
	if err != nil {
		jsonError(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	s.DB.LogActivity("auth", op.Username+" logged in")
	jsonResponse(w, loginResponse{Token: tokenString})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	username := r.Context().Value(operatorKey).(string)
	op, err := s.DB.GetOperatorByUsername(username)
	if err != nil {
		jsonError(w, "Operator not found", http.StatusNotFound)
		return
	}
	jsonResponse(w, op)
}

func (s *Server) jwtMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if auth == "" {
			jsonError(w, "Missing authorization header", http.StatusUnauthorized)
			return
		}

		parts := strings.SplitN(auth, " ", 2)
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			jsonError(w, "Invalid authorization header", http.StatusUnauthorized)
			return
		}

		token, err := jwt.Parse(parts[1], func(t *jwt.Token) (interface{}, error) {
			return []byte(s.Config.JWTSecret), nil
		})
		if err != nil || !token.Valid {
			jsonError(w, "Invalid token", http.StatusUnauthorized)
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			jsonError(w, "Invalid token claims", http.StatusUnauthorized)
			return
		}

		username, _ := claims["operator"].(string)
		ctx := context.WithValue(r.Context(), operatorKey, username)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func jsonResponse(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
