# Rust reference material (read-only, not built)

This directory is a **frozen snapshot** of the original Rust core that powered the
pre-Expo native iOS app. It is **not part of the build** and exists only as the
source of truth while the engine is reimplemented in pure TypeScript under `src/core/`.

## Contents
- `src/` — the original `Rust/core/src` (~80k LOC). Algorithm definitions, protocol
  parsing, SQLite schema, sync/capture/export logic. Port from here.
- `tests/` — the original Rust test suite. These contain the **expected outputs / golden
  assertions** that the TS golden tests (`src/core/**/*.test.ts`) must reproduce.
- `goose_core_bridge.h` — the 3-function C FFI contract (`goose_core_version_json`,
  `goose_bridge_handle_json`, `goose_bridge_free_string`) and the ~100 JSON-RPC methods it
  dispatched. Each method becomes a typed TS function in `src/core/`.

## Golden test inputs
Fixture inputs and expected-output snapshots live in `/__fixtures__/` (copied from the
original `Rust/core/fixtures/`). `*.fixture.json` files are expected outputs; `*.json` /
`*.hex` are inputs.

## Removal
Delete this directory in Phase 7 once `src/core/` reaches parity and all golden tests pass.
