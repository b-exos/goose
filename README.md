# Goose — Local Companion for WHOOP 5.0

**Alpha. A local-first companion app for WHOOP 5.0 bands, built with Expo SDK 56 and
TypeScript.** Goose connects to a WHOOP 5.0 over Bluetooth, parses packet data, and computes
recovery, sleep, strain, stress, HRV, and energy metrics **entirely on-device**.

> This is a from-scratch rewrite of the original native iOS app (SwiftUI + Rust core) into a
> single cross-platform Expo/TypeScript codebase targeting iOS and Android. The health
> algorithms were ported with **golden parity tests** against the original engine's fixtures.

## Stack

- **Expo SDK 56** (React Native 0.85, React 19), `expo-router` (file-based routing)
- **Expo UI** (`@expo/ui` universal — SwiftUI on iOS, Jetpack Compose on Android)
- **Zustand** for state
- **expo-sqlite** for local storage, **react-native-ble-plx** for BLE
- **expo-widgets** for the workout Live Activity, **expo-location** for GPS
- Pure-TS health engine (no native Rust) — Jest-tested against preserved fixtures

## Project layout

```text
src/
  app/                  expo-router routes: index (Home), health, coach, more, _layout
  core/                 pure-TS health engine (replaces the old Rust core)
    protocol/           WHOOP frame decode/encode + CRC (8 / 16-Modbus / 32-IEEE)
    metrics/            hrv, sleep v0/v1, strain, recovery, stress + algorithm registry
    store/              expo-sqlite schema + repositories (capture, runs, activity, sleep, prefs)
    capture/            frame-batch ingest pipeline
    features/ activity/ calibration/ hash/   feature extractors, rollups, sha256, calibration
    testing/            fixtures + better-sqlite3 test adapter
  ble/                  react-native-ble-plx transport: uuids, base64, notifications, client
  coach/                OpenAI client + tool-calling loop + local metric tools
  widgets/              workout Live Activity (expo-widgets + Expo UI / SwiftUI)
  features/             UI components, onboarding, workout (live activity controller, GPS)
  state/                Zustand stores (ble, coach, workout, onboarding) + app controller
__fixtures__/           golden test inputs + expected outputs (from the original Rust core)
docs/rust-reference/    frozen snapshot of the original Rust source/tests (port reference)
```

## Getting started

```bash
bun install
bun run ios       # or: bun run android
```

BLE and Live Activities require a **development build** on a physical device (they don't work
in Expo Go or the simulator). See "Builds" below.

## Scripts

```bash
bun test           # Jest — engine golden + unit tests
bun run typecheck  # tsc --noEmit
bun run lint       # eslint (incl. max-lines file-size guard)
```

## How the engine stays correct

The original Rust core shipped a fixture suite. Those fixtures (inputs + expected outputs)
live in `__fixtures__/`, and each ported algorithm has a **golden test** asserting the
TypeScript output matches the Rust output exactly (e.g. HRV RMSSD, the 82.0136… sleep v1
score, strain 8.05, recovery 77.5). The protocol parser and SQLite store are round-trip
tested via an in-memory `better-sqlite3` adapter that runs the same SQL the device uses.

## Builds (EAS)

`eas.json` defines `development`, `preview`, and `production` profiles.

```bash
bun i -g eas-cli && eas login
eas build --profile development --platform ios      # dev client (device)
eas build --profile development --platform android
```

The `development` profile produces a dev client (required for BLE + Live Activities).

## Status & scope

Ported and tested: the full health engine (metrics, protocol, store, capture, calibration,
feature/energy/step cores), the BLE transport, the Expo UI tab shell + onboarding, the
workout Live Activity, and the OpenAI coach with local metric tools.

Known follow-ups: wiring inbound BLE frames into the capture-import persistence, populating
the Home/Health surfaces from stored runs, the recovery-sensor rollup persistence, and
secure storage for the coach API key. Dev/validation tooling from the Rust core (debug WS,
audits, export/sync CLIs) is intentionally out of scope for the app.

This prototype targets WHOOP 5.0 only.
