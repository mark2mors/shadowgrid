package models

import "time"

type Agent struct {
	ID           string    `json:"id"`
	Hostname     string    `json:"hostname"`
	Username     string    `json:"username"`
	OS           string    `json:"os"`
	Arch         string    `json:"arch"`
	ProcessName  string    `json:"process_name"`
	PID          int       `json:"pid"`
	IPInternal   string    `json:"ip_internal"`
	IPExternal   string    `json:"ip_external"`
	Country      string    `json:"country"`
	DomainName   string    `json:"domain_name"`
	IsAdmin      bool      `json:"is_admin"`
	SleepSeconds int       `json:"sleep_seconds"`
	JitterPct    int       `json:"jitter_percent"`
	ListenerID   int       `json:"listener_id"`
	FirstSeen    time.Time `json:"first_seen"`
	LastSeen     time.Time `json:"last_seen"`
	Status       string    `json:"status"`
}
