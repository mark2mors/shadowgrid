package models

import "time"

type File struct {
	ID        int       `json:"id"`
	AgentID   string    `json:"agent_id"`
	Filename  string    `json:"filename"`
	Filepath  string    `json:"filepath"`
	Size      int64     `json:"size"`
	Direction string    `json:"direction"`
	LocalPath string    `json:"local_path"`
	CreatedAt time.Time `json:"created_at"`
}
