/**
 * SQLite schema for the Goose local store.
 *
 * Ported verbatim from the migration in `docs/rust-reference/src/store.rs`
 * (`migrate` + `ensure_overnight_mirror_tables`). The DDL is kept identical so the
 * pure-TS engine reads/writes the same shapes the Rust core did. Applied via
 * `expo-sqlite` at runtime and `better-sqlite3` in tests.
 *
 * NOTE: this covers the central tables the capture/metrics/activity/sleep paths need.
 * Still TODO (deferred to a later batch, with their repositories): daily_activity_metrics,
 * hourly_activity_metrics, daily_recovery_metrics, metric_provenance, metric_debug_features,
 * step_counter_samples, activity_labels, sleep_correction_labels, command_validation_records,
 * calibration_labels, calibration_runs, debug_sessions/commands/events, historical_range_polls.
 */

/** Core schema: created on first open. Mirrors store.rs migrate() (user_version 14). */
export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS goose_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS capture_sessions (
    session_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    started_at_unix_ms INTEGER NOT NULL,
    ended_at_unix_ms INTEGER,
    device_model TEXT NOT NULL,
    active_device_id TEXT,
    status TEXT NOT NULL,
    frame_count INTEGER NOT NULL DEFAULT 0,
    provenance_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS raw_evidence (
    evidence_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    device_model TEXT NOT NULL,
    payload_hex TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    sensitivity TEXT NOT NULL,
    capture_session_id TEXT REFERENCES capture_sessions(session_id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS decoded_frames (
    frame_id TEXT PRIMARY KEY,
    evidence_id TEXT NOT NULL REFERENCES raw_evidence(evidence_id) ON DELETE CASCADE,
    device_type TEXT NOT NULL,
    raw_len INTEGER NOT NULL,
    header_len INTEGER NOT NULL,
    declared_len INTEGER NOT NULL,
    payload_hex TEXT NOT NULL,
    payload_crc_hex TEXT NOT NULL,
    header_crc_valid INTEGER NOT NULL,
    payload_crc_valid INTEGER NOT NULL,
    packet_type INTEGER,
    packet_type_name TEXT,
    sequence INTEGER,
    command_or_event INTEGER,
    packet_k INTEGER,
    parsed_payload_json TEXT NOT NULL DEFAULT 'null',
    parser_version TEXT NOT NULL,
    warnings_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS algorithm_definitions (
    algorithm_id TEXT NOT NULL,
    version TEXT NOT NULL,
    metric_family TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    implementation TEXT NOT NULL DEFAULT '',
    license TEXT NOT NULL DEFAULT '',
    input_schema TEXT NOT NULL,
    output_schema TEXT NOT NULL,
    input_requirements_json TEXT NOT NULL DEFAULT '{}',
    params_json TEXT NOT NULL,
    quality_gates_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'experimental',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (algorithm_id, version)
);

CREATE TABLE IF NOT EXISTS algorithm_runs (
    run_id TEXT PRIMARY KEY,
    algorithm_id TEXT NOT NULL,
    version TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    output_json TEXT NOT NULL,
    quality_flags_json TEXT NOT NULL,
    provenance_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (algorithm_id, version)
        REFERENCES algorithm_definitions(algorithm_id, version)
);

CREATE TABLE IF NOT EXISTS metric_values (
    metric_value_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES algorithm_runs(run_id) ON DELETE CASCADE,
    metric_family TEXT NOT NULL,
    name TEXT NOT NULL,
    value REAL NOT NULL,
    unit TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS metric_components (
    metric_component_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES algorithm_runs(run_id) ON DELETE CASCADE,
    component_name TEXT NOT NULL,
    value REAL NOT NULL,
    unit TEXT NOT NULL,
    contribution_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS activity_sessions (
    session_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    start_time_unix_ms INTEGER NOT NULL,
    end_time_unix_ms INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    activity_type TEXT NOT NULL,
    external_activity_type_code TEXT,
    external_activity_type_name TEXT,
    custom_label TEXT,
    confidence REAL NOT NULL,
    detection_method TEXT NOT NULL,
    sync_status TEXT NOT NULL,
    provenance_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_sessions_by_window
    ON activity_sessions(start_time_unix_ms, end_time_unix_ms);
CREATE INDEX IF NOT EXISTS idx_activity_sessions_by_type ON activity_sessions(activity_type);
CREATE INDEX IF NOT EXISTS idx_activity_sessions_by_source ON activity_sessions(source);
CREATE INDEX IF NOT EXISTS idx_activity_sessions_by_sync_status ON activity_sessions(sync_status);

CREATE TABLE IF NOT EXISTS activity_metrics (
    metric_id TEXT PRIMARY KEY,
    activity_session_id TEXT NOT NULL REFERENCES activity_sessions(session_id) ON DELETE CASCADE,
    metric_name TEXT NOT NULL,
    value REAL NOT NULL,
    unit TEXT NOT NULL,
    start_time_unix_ms INTEGER NOT NULL,
    end_time_unix_ms INTEGER NOT NULL,
    quality_flags_json TEXT NOT NULL DEFAULT '[]',
    provenance_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_metrics_by_session ON activity_metrics(activity_session_id);
CREATE INDEX IF NOT EXISTS idx_activity_metrics_by_name ON activity_metrics(metric_name);

CREATE TABLE IF NOT EXISTS activity_intervals (
    interval_id TEXT PRIMARY KEY,
    activity_session_id TEXT NOT NULL REFERENCES activity_sessions(session_id) ON DELETE CASCADE,
    interval_type TEXT NOT NULL,
    start_time_unix_ms INTEGER NOT NULL,
    end_time_unix_ms INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    sequence INTEGER NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    provenance_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_intervals_by_session ON activity_intervals(activity_session_id);
CREATE INDEX IF NOT EXISTS idx_activity_intervals_by_type ON activity_intervals(interval_type);

CREATE TABLE IF NOT EXISTS external_sleep_sessions (
    sleep_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    platform TEXT NOT NULL,
    platform_record_id TEXT,
    start_time_unix_ms INTEGER NOT NULL,
    end_time_unix_ms INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    timezone TEXT,
    stage_summary_json TEXT NOT NULL DEFAULT '{}',
    confidence REAL NOT NULL,
    provenance_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(platform, platform_record_id)
);

CREATE TABLE IF NOT EXISTS external_sleep_stages (
    stage_id TEXT PRIMARY KEY,
    sleep_id TEXT NOT NULL REFERENCES external_sleep_sessions(sleep_id) ON DELETE CASCADE,
    stage_kind TEXT NOT NULL,
    start_time_unix_ms INTEGER NOT NULL,
    end_time_unix_ms INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    confidence REAL NOT NULL,
    provenance_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS algorithm_preferences (
    scope TEXT NOT NULL,
    metric_family TEXT NOT NULL,
    algorithm_id TEXT NOT NULL,
    version TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (scope, metric_family),
    FOREIGN KEY (algorithm_id, version)
        REFERENCES algorithm_definitions(algorithm_id, version)
);

INSERT OR IGNORE INTO goose_schema_migrations(version) VALUES
    (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12),(13),(14);
PRAGMA user_version = 14;
`;

/**
 * Overnight-mirror tables. In Rust these were created lazily; here they are part of
 * the same migration for simplicity. Mirrors `ensure_overnight_mirror_tables`.
 */
export const OVERNIGHT_MIRROR_SQL = `
CREATE TABLE IF NOT EXISTS overnight_sync_sessions (
    session_id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    band_identifier TEXT,
    app_version TEXT,
    mode TEXT NOT NULL,
    final_status TEXT NOT NULL,
    raw_frame_count INTEGER NOT NULL DEFAULT 0,
    historical_frame_count INTEGER NOT NULL DEFAULT 0,
    range_poll_count INTEGER NOT NULL DEFAULT 0,
    successful_range_poll_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS ble_raw_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    source TEXT NOT NULL,
    characteristic_uuid TEXT NOT NULL,
    device_type TEXT,
    command_or_event INTEGER,
    packet_type INTEGER,
    k_revision INTEGER,
    sequence INTEGER,
    frame_hex TEXT NOT NULL,
    payload_hex TEXT,
    byte_count INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    decode_status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(session_id, captured_at, characteristic_uuid, sha256)
);
CREATE INDEX IF NOT EXISTS idx_ble_raw_notifications_session_time
    ON ble_raw_notifications(session_id, captured_at);
`;
