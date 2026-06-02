# Goose docs

Goose was rewritten from a native iOS app (SwiftUI + Rust core) into a cross-platform
**Expo SDK 56 / TypeScript** app. What's here:

- **`goose-swift-mvp/`** — the original product/UX contracts (Home, Health, Coach, More,
  data pipeline). These remain the **behavior spec** for the screens; the implementation is
  now TypeScript under `src/`, not Swift. Treat references to Swift files/`GooseSwift` as
  historical.
- **`rust-reference/`** — a **frozen, read-only snapshot** of the original Rust core
  (`src/`) and its test suite (`tests/`), kept as the source of truth while porting the
  engine to `src/core/`. The golden fixtures it produced live in `/__fixtures__/`. This
  directory is not built and can be removed once the remaining deferred ports (the
  capture-correlation-gated feature pipeline and recovery/energy rollup persistence) land.
- **`assets/`** — README imagery.

Implementation status and scope live in the root `README.md`.
