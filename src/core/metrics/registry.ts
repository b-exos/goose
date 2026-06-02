/**
 * Built-in algorithm catalog and default per-family selections.
 *
 * Mirrors `built_in_algorithm_definitions` / `built_in_default_algorithm_preferences`
 * in `docs/rust-reference/src/metrics.rs`. Definitions seed the `algorithm_definitions`
 * table (the FK target for runs and preferences); default preferences select the v0
 * algorithm for each metric family.
 *
 * sleep_v1 is registered as an experimental algorithm (the default for the `sleep` family
 * remains v0, matching the Rust catalog).
 */
import type { AlgorithmDefinitionInput } from '../store/algorithm-run-repository';
import { GOOSE_HRV_V0_ID, GOOSE_HRV_V0_VERSION } from './hrv';
import { GOOSE_RECOVERY_V0_ID, GOOSE_RECOVERY_V0_VERSION } from './recovery';
import { GOOSE_SLEEP_V0_ID, GOOSE_SLEEP_V0_VERSION } from './sleep';
import { GOOSE_SLEEP_V1_ID, GOOSE_SLEEP_V1_VERSION } from './sleep-v1';
import { GOOSE_STRAIN_V0_ID, GOOSE_STRAIN_V0_VERSION } from './strain';
import { GOOSE_STRESS_V0_ID, GOOSE_STRESS_V0_VERSION } from './stress';

/** The default preference scope. */
export const DEFAULT_SCOPE = 'default';

/** A built-in algorithm: its definition row plus the family it serves by default. */
export interface BuiltInAlgorithm {
  definition: AlgorithmDefinitionInput;
  isDefaultForFamily: boolean;
}

function def(
  algorithmId: string,
  version: string,
  metricFamily: string,
  displayName: string,
): AlgorithmDefinitionInput {
  return { algorithmId, version, metricFamily, displayName };
}

/** All built-in algorithm definitions (seed into `algorithm_definitions`). */
export const BUILT_IN_ALGORITHMS: BuiltInAlgorithm[] = [
  { definition: def(GOOSE_HRV_V0_ID, GOOSE_HRV_V0_VERSION, 'hrv', 'Goose HRV v0'), isDefaultForFamily: true },
  { definition: def(GOOSE_SLEEP_V0_ID, GOOSE_SLEEP_V0_VERSION, 'sleep', 'Goose Sleep v0'), isDefaultForFamily: true },
  // sleep_v1 is experimental; v0 stays the default for the `sleep` family.
  { definition: def(GOOSE_SLEEP_V1_ID, GOOSE_SLEEP_V1_VERSION, 'sleep', 'Goose Sleep v1'), isDefaultForFamily: false },
  { definition: def(GOOSE_STRAIN_V0_ID, GOOSE_STRAIN_V0_VERSION, 'strain', 'Goose Strain v0'), isDefaultForFamily: true },
  { definition: def(GOOSE_RECOVERY_V0_ID, GOOSE_RECOVERY_V0_VERSION, 'recovery', 'Goose Recovery v0'), isDefaultForFamily: true },
  { definition: def(GOOSE_STRESS_V0_ID, GOOSE_STRESS_V0_VERSION, 'stress', 'Goose Stress v0'), isDefaultForFamily: true },
];

/** A selected algorithm for a metric family. */
export interface AlgorithmPreference {
  scope: string;
  metricFamily: string;
  algorithmId: string;
  version: string;
}

/** Default preferences (one per family) for the given scope. */
export function defaultPreferencesForScope(scope: string = DEFAULT_SCOPE): AlgorithmPreference[] {
  return BUILT_IN_ALGORITHMS.filter((a) => a.isDefaultForFamily).map((a) => ({
    scope,
    metricFamily: a.definition.metricFamily,
    algorithmId: a.definition.algorithmId,
    version: a.definition.version,
  }));
}
