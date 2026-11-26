package models

import "time"

type Credential struct {
	ID        int       `json:"id"`
	AgentID   string    `json:"agent_id"`
	Source    string    `json:"source"`
	URL       string    `json:"url"`
	Username  string    `json:"username"`
	Password  string    `json:"password"`
	Notes     string    `json:"notes"`
	CreatedAt time.Time `json:"created_at"`
}
