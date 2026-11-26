package models

import "time"

type Result struct {
	ID         int       `json:"id"`
	TaskID     int       `json:"task_id"`
	AgentID    string    `json:"agent_id"`
	Output     string    `json:"output"`
	OutputType string    `json:"output_type"`
	CreatedAt  time.Time `json:"created_at"`
}
