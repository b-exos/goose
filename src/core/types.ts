/**
 * Shared types for the pure-TS health engine.
 *
 * These mirror the structs the Rust core serialized across the FFI bridge
 * (`docs/rust-reference/src/metrics.rs`). They are intentionally plain data shapes —
 * the engine is a set of pure functions over these types, called directly from the
 * UI/Zustand layer (no JSON-RPC envelope anymore).
 */

/** A single named sub-value contributing to a metric result. */
export interface MetricComponent {
  name: string;
  value: number;
  unit: string;
}

/**
 * The envelope every algorithm returns. `output` is null when `errors` is non-empty.
 * `provenance` carries the inputs/policy used, matching the Rust `provenance` JSON.
 */
export interface AlgorithmRunResult<TOutput> {
  algorithmId: string;
  algorithmVersion: string;
  family: string;
  startTime: string;
  endTime: string;
  output: TOutput | null;
  qualityFlags: string[];
  errors: string[];
  provenance: Record<string, unknown>;
}
