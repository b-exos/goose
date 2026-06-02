/**
 * Rollup / overnight-poll schema tables, deferred from the initial `schema.ts` port.
 *
 * Ported verbatim from `docs/rust-reference/src/store.rs` — the daily/hourly activity rollups,
 * daily recovery rollup, metric provenance, step-counter samples, and historical-range polls.
 * Applied alongside the core schema in `migrate()`.
 */
export const ROLLUP_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS daily_activity_metrics (
    daily_metric_id TEXT PRIMARY KEY,
    date_key TEXT NOT NULL,
    timezone TEXT NOT NULL,
    start_time_unix_ms INTEGER NOT NULL,
    end_time_unix_ms INTEGER NOT NULL,
    steps INTEGER,
    active_kcal REAL,
    resting_kcal REAL,
    total_kcal REAL,
    average_cadence_spm REAL,
    source_kind TEXT NOT NULL,
    confidence REAL NOT NULL,
    inputs_json TEXT NOT NULL DEFAULT '{}',
    quality_flags_json TEXT NOT NULL DEFAULT '[]',
    provenance_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_daily_activity_metrics_by_date ON daily_activity_metrics(date_key);
CREATE INDEX IF NOT EXISTS idx_daily_activity_metrics_by_window
    ON daily_activity_metrics(start_time_unix_ms, end_time_unix_ms);

CREATE TABLE IF NOT EXISTS hourly_activity_metrics (
    hourly_metric_id TEXT PRIMARY KEY,
    date_key TEXT NOT NULL,
    timezone TEXT NOT NULL,
    start_time_unix_ms INTEGER NOT NULL,
    end_time_unix_ms INTEGER NOT NULL,
    steps INTEGER,
    active_kcal REAL,
    resting_kcal REAL,
    total_kcal REAL,
    average_cadence_spm REAL,
    source_kind TEXT NOT NULL,
    confidence REAL NOT NULL,
    inputs_json TEXT NOT NULL DEFAULT '{}',
    quality_flags_json TEXT NOT NULL DEFAULT '[]',
    provenance_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_hourly_activity_metrics_by_date ON hourly_activity_metrics(date_key);

CREATE TABLE IF NOT EXISTS daily_recovery_metrics (
    daily_metric_id TEXT PRIMARY KEY,
    date_key TEXT NOT NULL,
    timezone TEXT NOT NULL,
    start_time_unix_ms INTEGER NOT NULL,
    end_time_unix_ms INTEGER NOT NULL,
    resting_hr_bpm REAL,
    hrv_rmssd_ms REAL,
    respiratory_rate_rpm REAL,
    oxygen_saturation_percent REAL,
    skin_temperature_delta_c REAL,
    source_kind TEXT NOT NULL,
    confidence REAL NOT NULL,
    inputs_json TEXT NOT NULL DEFAULT '{}',
    quality_flags_json TEXT NOT NULL DEFAULT '[]',
    provenance_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_daily_recovery_metrics_by_date ON daily_recovery_metrics(date_key);

CREATE TABLE IF NOT EXISTS metric_provenance (
    provenance_id TEXT PRIMARY KEY,
    metric_scope TEXT NOT NULL,
    metric_id TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    source_detail TEXT NOT NULL DEFAULT '',
    confidence REAL,
    inputs_json TEXT NOT NULL DEFAULT '{}',
    quality_flags_json TEXT NOT NULL DEFAULT '[]',
    provenance_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_metric_provenance_by_metric ON metric_provenance(metric_scope, metric_id);

CREATE TABLE IF NOT EXISTS step_counter_samples (
    sample_id TEXT PRIMARY KEY,
    sample_time_unix_ms INTEGER NOT NULL,
    counter_value INTEGER NOT NULL,
    cadence_spm REAL,
    activity_state TEXT,
    source_kind TEXT NOT NULL,
    packet_family TEXT NOT NULL DEFAULT '',
    json_path TEXT NOT NULL DEFAULT '',
    frame_id TEXT,
    evidence_id TEXT,
    capture_session_id TEXT,
    quality_flags_json TEXT NOT NULL DEFAULT '[]',
    provenance_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_step_counter_samples_by_time ON step_counter_samples(sample_time_unix_ms);

CREATE TABLE IF NOT EXISTS historical_range_polls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    status TEXT NOT NULL,
    command_sequence INTEGER NOT NULL,
    result_code INTEGER NOT NULL,
    result_name TEXT NOT NULL,
    raw_payload_hex TEXT NOT NULL,
    raw_body_hex TEXT NOT NULL,
    revision_or_status INTEGER,
    page_current INTEGER,
    page_oldest INTEGER,
    page_end INTEGER,
    pages_behind INTEGER,
    pending_response_count INTEGER NOT NULL DEFAULT 0,
    retry_count INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(session_id, captured_at, command_sequence, status, result_code, raw_body_hex)
);
CREATE INDEX IF NOT EXISTS idx_historical_range_polls_session_time
    ON historical_range_polls(session_id, captured_at);
`;
