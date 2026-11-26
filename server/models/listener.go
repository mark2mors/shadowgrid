package models

import "time"

type Listener struct {
	ID         int       `json:"id"`
	Name       string    `json:"name"`
	Type       string    `json:"type"`
	BindHost   string    `json:"bind_host"`
	BindPort   int       `json:"bind_port"`
	Domain     string    `json:"domain"`
	Status     string    `json:"status"`
	ConfigJSON string    `json:"config_json"`
	CreatedAt  time.Time `json:"created_at"`
}
