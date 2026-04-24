package demoapi

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

import _ "modernc.org/sqlite"

type DemoStorage struct {
	dbPath string
	mu     sync.Mutex
}

func NewDemoStorage(dbPath string) (*DemoStorage, error) {
	store := &DemoStorage{dbPath: dbPath}
	if err := store.init(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *DemoStorage) init() error {
	parent := filepath.Dir(s.dbPath)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return err
	}
	db, err := sql.Open("sqlite", s.dbPath)
	if err != nil {
		return err
	}
	defer func() {
		_ = db.Close()
	}()

	ddl := []string{
		`CREATE TABLE IF NOT EXISTS runs (
			id TEXT PRIMARY KEY,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			mode TEXT NOT NULL,
			model_id TEXT NOT NULL,
			device TEXT NOT NULL,
			status TEXT NOT NULL,
			wall_time_ms REAL,
			audio_duration_s REAL,
			rtf REAL,
			payload_json TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS training_jobs (
			id TEXT PRIMARY KEY,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			training_mode TEXT NOT NULL,
			model_id TEXT NOT NULL,
			device TEXT NOT NULL,
			precision_mode TEXT NOT NULL,
			status TEXT NOT NULL,
			experimental INTEGER NOT NULL DEFAULT 0,
			output_dir TEXT,
			log_path TEXT,
			payload_json TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS bench_jobs (
			id TEXT PRIMARY KEY,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			model_id TEXT NOT NULL,
			device TEXT NOT NULL,
			status TEXT NOT NULL,
			payload_json TEXT NOT NULL
		);`,
	}

	for _, statement := range ddl {
		if _, err := db.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}

func (s *DemoStorage) db() (*sql.DB, error) {
	return sql.Open("sqlite", s.dbPath)
}

func (s *DemoStorage) saveJSON(record map[string]any) (string, error) {
	payload, err := json.Marshal(record)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

func (s *DemoStorage) loadJSON(payload string) map[string]any {
	var data map[string]any
	_ = json.Unmarshal([]byte(payload), &data)
	return data
}

func (s *DemoStorage) SaveRun(record map[string]any) (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	payload, err := s.saveJSON(record)
	if err != nil {
		return nil, err
	}
	db, err := s.db()
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = db.Close()
	}()

	metrics, _ := record["metrics"].(map[string]any)
	wallTime := toFloat(metrics["wall_time_ms"])
	duration := toFloat(metrics["audio_duration_s"])
	rtf := toFloat(metrics["rtf"])

	query := `INSERT INTO runs (
		id, created_at, updated_at, mode, model_id, device, status,
		wall_time_ms, audio_duration_s, rtf, payload_json
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET
		updated_at=excluded.updated_at,
		status=excluded.status,
		wall_time_ms=excluded.wall_time_ms,
		audio_duration_s=excluded.audio_duration_s,
		rtf=excluded.rtf,
		payload_json=excluded.payload_json`

	_, err = db.Exec(
		query,
		record["id"], record["created_at"], record["updated_at"],
		record["mode"], record["model_id"], record["device"], record["status"],
		wallTime, duration, rtf, payload,
	)
	return record, err
}

func (s *DemoStorage) ListRuns(limit int) ([]map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	db, err := s.db()
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = db.Close()
	}()

	rows, err := db.Query(`SELECT payload_json FROM runs ORDER BY datetime(created_at) DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = rows.Close()
	}()
	records := []map[string]any{}
	for rows.Next() {
		var payload string
		if err := rows.Scan(&payload); err != nil {
			continue
		}
		records = append(records, s.loadJSON(payload))
	}
	return records, nil
}

func (s *DemoStorage) GetRun(runID string) (map[string]any, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	db, err := s.db()
	if err != nil {
		return nil, false, err
	}
	defer func() {
		_ = db.Close()
	}()

	var payload string
	err = db.QueryRow(`SELECT payload_json FROM runs WHERE id = ?`, runID).Scan(&payload)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return s.loadJSON(payload), true, nil
}

func (s *DemoStorage) SaveTrainingJob(record map[string]any) (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	payload, err := s.saveJSON(record)
	if err != nil {
		return nil, err
	}
	db, err := s.db()
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = db.Close()
	}()

	experimental := 0
	if record["experimental"] == true {
		experimental = 1
	}
	_, err = db.Exec(
		`INSERT INTO training_jobs (
			id, created_at, updated_at, training_mode, model_id, device,
			precision_mode, status, experimental, output_dir, log_path, payload_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			updated_at=excluded.updated_at,
			status=excluded.status,
			experimental=excluded.experimental,
			output_dir=excluded.output_dir,
			log_path=excluded.log_path,
			payload_json=excluded.payload_json`,
		record["id"], record["created_at"], record["updated_at"],
		record["training_mode"], record["model_id"], record["device"],
		record["precision_mode"], record["status"], experimental,
		record["output_dir"], record["log_path"], payload,
	)
	return record, err
}

func (s *DemoStorage) GetTrainingJob(jobID string) (map[string]any, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	db, err := s.db()
	if err != nil {
		return nil, false, err
	}
	defer func() {
		_ = db.Close()
	}()

	var payload string
	err = db.QueryRow(`SELECT payload_json FROM training_jobs WHERE id = ?`, jobID).Scan(&payload)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return s.loadJSON(payload), true, nil
}

func (s *DemoStorage) LatestTrainingJob() (map[string]any, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	db, err := s.db()
	if err != nil {
		return nil, false, err
	}
	defer func() {
		_ = db.Close()
	}()

	var payload string
	err = db.QueryRow(`SELECT payload_json FROM training_jobs ORDER BY datetime(created_at) DESC LIMIT 1`).Scan(&payload)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return s.loadJSON(payload), true, nil
}

func (s *DemoStorage) SaveBenchJob(record map[string]any) (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	payload, err := s.saveJSON(record)
	if err != nil {
		return nil, err
	}
	db, err := s.db()
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = db.Close()
	}()

	_, err = db.Exec(
		`INSERT INTO bench_jobs (
			id, created_at, updated_at, model_id, device, status, payload_json
		) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			updated_at=excluded.updated_at,
			status=excluded.status,
			payload_json=excluded.payload_json`,
		record["id"], record["created_at"], record["updated_at"],
		record["model_id"], record["device"], record["status"], payload,
	)
	return record, err
}

func (s *DemoStorage) GetBenchJob(jobID string) (map[string]any, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	db, err := s.db()
	if err != nil {
		return nil, false, err
	}
	defer func() {
		_ = db.Close()
	}()
	var payload string
	err = db.QueryRow(`SELECT payload_json FROM bench_jobs WHERE id = ?`, jobID).Scan(&payload)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return s.loadJSON(payload), true, nil
}

func (s *DemoStorage) RecoverInterruptedJobs(now string) error {
	if err := s.recoverJobs("training_jobs", "training", now); err != nil {
		return err
	}
	return s.recoverJobs("bench_jobs", "bench", now)
}

func (s *DemoStorage) recoverJobs(table string, kind string, now string) error {
	db, err := s.db()
	if err != nil {
		return err
	}
	defer func() {
		_ = db.Close()
	}()

	rows, err := db.Query(
		fmt.Sprintf(`SELECT payload_json FROM %s WHERE status IN ('starting', 'running', 'stopping')`, table),
	)
	if err != nil {
		return err
	}
	records := []map[string]any{}
	for rows.Next() {
		var payload string
		if err := rows.Scan(&payload); err != nil {
			continue
		}
		record := s.loadJSON(payload)
		record["status"] = "failed"
		record["updated_at"] = now
		record["error"] = fmt.Sprintf("%s job interrupted by API restart", kind)
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}

	for _, record := range records {
		if kind == "training" {
			if _, err := s.SaveTrainingJob(record); err != nil {
				return err
			}
			continue
		}
		if _, err := s.SaveBenchJob(record); err != nil {
			return err
		}
	}
	return nil
}

func (s *DemoStorage) SaveBusyState(state map[string]any) error {
	if id, ok := state["id"].(string); ok && id != "" {
		record := map[string]any{
			"id":             id,
			"created_at":     state["created_at"],
			"updated_at":     state["updated_at"],
			"training_mode":  "runtime",
			"model_id":       "",
			"device":         "",
			"precision_mode": "",
			"status":         state["kind"],
			"experimental":   0,
		}
		_, _ = s.SaveTrainingJob(record)
	}
	return nil
}

func toFloat(v any) sql.NullFloat64 {
	switch typed := v.(type) {
	case float64:
		return sql.NullFloat64{Float64: typed, Valid: true}
	case float32:
		return sql.NullFloat64{Float64: float64(typed), Valid: true}
	case int:
		return sql.NullFloat64{Float64: float64(typed), Valid: true}
	case int64:
		return sql.NullFloat64{Float64: float64(typed), Valid: true}
	case int32:
		return sql.NullFloat64{Float64: float64(typed), Valid: true}
	case nil:
		return sql.NullFloat64{Valid: false}
	default:
		return sql.NullFloat64{Valid: false}
	}
}

func (s *DemoStorage) DebugDump() (string, error) {
	db, err := s.db()
	if err != nil {
		return "", err
	}
	defer func() {
		_ = db.Close()
	}()

	var name string
	if err := db.QueryRow("select name from sqlite_master where type='table'").Scan(&name); err != nil {
		return "", err
	}
	if name == "" {
		return "no tables", nil
	}
	return fmt.Sprintf("sqlite ok @ %s", s.dbPath), nil
}

func (s *DemoStorage) NormalizePath(path string) string {
	if strings.TrimSpace(path) == "" {
		return ""
	}
	return filepath.Clean(path)
}
