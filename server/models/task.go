package models

import "time"

type Task struct {
	ID          int        `json:"id"`
	AgentID     string     `json:"agent_id"`
	TaskType    string     `json:"task_type"`
	ArgsJSON    string     `json:"args_json"`
	Status      string     `json:"status"`
	CreatedBy   string     `json:"created_by"`
	CreatedAt   time.Time  `json:"created_at"`
	SentAt      *time.Time `json:"sent_at,omitempty"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
}
