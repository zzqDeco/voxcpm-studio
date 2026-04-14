from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any


class DemoStorage:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    @staticmethod
    def _dumps(payload: dict[str, Any]) -> str:
        return json.dumps(payload, ensure_ascii=False)

    @staticmethod
    def _loads(payload: str | None) -> dict[str, Any]:
        if not payload:
            return {}
        return json.loads(payload)

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS runs (
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
                );

                CREATE TABLE IF NOT EXISTS training_jobs (
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
                );

                CREATE TABLE IF NOT EXISTS bench_jobs (
                    id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    device TEXT NOT NULL,
                    status TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                );
                """
            )

    def save_run(self, record: dict[str, Any]) -> dict[str, Any]:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO runs (
                    id, created_at, updated_at, mode, model_id, device, status,
                    wall_time_ms, audio_duration_s, rtf, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    updated_at=excluded.updated_at,
                    status=excluded.status,
                    wall_time_ms=excluded.wall_time_ms,
                    audio_duration_s=excluded.audio_duration_s,
                    rtf=excluded.rtf,
                    payload_json=excluded.payload_json
                """,
                (
                    record["id"],
                    record["created_at"],
                    record["updated_at"],
                    record["mode"],
                    record["model_id"],
                    record["device"],
                    record["status"],
                    record.get("metrics", {}).get("wall_time_ms"),
                    record.get("metrics", {}).get("audio_duration_s"),
                    record.get("metrics", {}).get("rtf"),
                    self._dumps(record),
                ),
            )
        return record

    def list_runs(self, *, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT payload_json
                FROM runs
                ORDER BY datetime(created_at) DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [self._loads(row["payload_json"]) for row in rows]

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT payload_json FROM runs WHERE id = ?",
                (run_id,),
            ).fetchone()
        return self._loads(row["payload_json"]) if row else None

    def save_training_job(self, record: dict[str, Any]) -> dict[str, Any]:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO training_jobs (
                    id, created_at, updated_at, training_mode, model_id, device,
                    precision_mode, status, experimental, output_dir, log_path, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    updated_at=excluded.updated_at,
                    status=excluded.status,
                    experimental=excluded.experimental,
                    output_dir=excluded.output_dir,
                    log_path=excluded.log_path,
                    payload_json=excluded.payload_json
                """,
                (
                    record["id"],
                    record["created_at"],
                    record["updated_at"],
                    record["training_mode"],
                    record["model_id"],
                    record["device"],
                    record["precision_mode"],
                    record["status"],
                    1 if record.get("experimental") else 0,
                    record.get("output_dir"),
                    record.get("log_path"),
                    self._dumps(record),
                ),
            )
        return record

    def get_training_job(self, job_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT payload_json FROM training_jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
        return self._loads(row["payload_json"]) if row else None

    def latest_training_job(self) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT payload_json
                FROM training_jobs
                ORDER BY datetime(created_at) DESC
                LIMIT 1
                """
            ).fetchone()
        return self._loads(row["payload_json"]) if row else None

    def save_bench_job(self, record: dict[str, Any]) -> dict[str, Any]:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO bench_jobs (
                    id, created_at, updated_at, model_id, device, status, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    updated_at=excluded.updated_at,
                    status=excluded.status,
                    payload_json=excluded.payload_json
                """,
                (
                    record["id"],
                    record["created_at"],
                    record["updated_at"],
                    record["model_id"],
                    record["device"],
                    record["status"],
                    self._dumps(record),
                ),
            )
        return record

    def get_bench_job(self, job_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT payload_json FROM bench_jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
        return self._loads(row["payload_json"]) if row else None

