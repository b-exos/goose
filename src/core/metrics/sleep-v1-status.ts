/**
 * Sleep V1 model-status state machine.
 *
 * Ported from `evaluate_sleep_model_status` + `sleep_model_status_report` in
 * `docs/rust-reference/src/metrics.rs`. Decides where the personal sleep model is in its
 * lifecycle (setup → learning → baseline → training → trained) and which score states the
 * UI may show.
 */

export type SleepModelStatus =
  | 'setup_needed'
  | 'importing_history'
  | 'learning'
  | 'baseline_ready'
  | 'training'
  | 'trained'
  | 'needs_relearn'
  | 'blocked';

export interface SleepModelStatusInput {
  sleepPermissionGranted?: boolean;
  historyImportInProgress?: boolean;
  timestampSyncBlocked?: boolean;
  trustedGooseSleepNights?: number;
  importedPlatformSleepNights?: number;
  excludedSleepNights?: number;
  motionCoverageFraction?: number | null;
  heartRateCoverageFraction?: number | null;
  calibrationLabelCount?: number;
  holdoutValidationPassed?: boolean;
  daysSinceLastValidNight?: number | null;
  timezoneOrScheduleShiftDetected?: boolean;
  repeatedLowConfidenceNights?: boolean;
}

export interface SleepModelStatusReport {
  status: SleepModelStatus;
  statusLabel: string;
  statusReason: string;
  reportState: 'blocked' | 'final' | 'provisional' | 'pending';
  validSleepNights: number;
  trustedGooseSleepNights: number;
  importedPlatformSleepNights: number;
  excludedSleepNights: number;
  calibrationLabelCount: number;
  nightsUntilBaseline: number;
  nightsUntilGooseTraining: number;
  nightsUntilTraining: number;
  canShowProvisionalScore: boolean;
  canShowFinalScore: boolean;
  canShowPersonalBaseline: boolean;
  canShowTrainedScore: boolean;
  qualityFlags: string[];
  nextActions: string[];
}

const sat = (a: number, b: number): number => Math.max(0, a - b);
const coverageOk = (coverage: number | null | undefined, threshold: number): boolean =>
  typeof coverage === 'number' && Number.isFinite(coverage) && coverage >= threshold;
const plural = (n: number): string => (n === 1 ? '' : 's');

function report(
  status: SleepModelStatus,
  statusLabel: string,
  statusReason: string,
  input: Required<Pick<SleepModelStatusInput, never>> & SleepModelStatusInput,
  validSleepNights: number,
  nightsUntilBaseline: number,
  nightsUntilTraining: number,
  qualityFlags: string[],
  nextActions: string[],
): SleepModelStatusReport {
  const trusted = input.trustedGooseSleepNights ?? 0;
  const canShowPersonalBaseline =
    status === 'baseline_ready' || status === 'training' || status === 'trained';
  const coverageReady = !qualityFlags.some(
    (f) => f === 'motion_coverage_low' || f === 'heart_rate_coverage_low',
  );
  const canShowFinalScore = canShowPersonalBaseline && coverageReady && trusted > 0;
  const canShowProvisionalScore = validSleepNights > 0 && status !== 'blocked';
  const canShowTrainedScore = status === 'trained';
  const reportState = status === 'blocked'
    ? 'blocked'
    : canShowFinalScore
      ? 'final'
      : canShowProvisionalScore
        ? 'provisional'
        : 'pending';
  return {
    status,
    statusLabel,
    statusReason,
    reportState,
    validSleepNights,
    trustedGooseSleepNights: trusted,
    importedPlatformSleepNights: input.importedPlatformSleepNights ?? 0,
    excludedSleepNights: input.excludedSleepNights ?? 0,
    calibrationLabelCount: input.calibrationLabelCount ?? 0,
    nightsUntilBaseline,
    nightsUntilGooseTraining: sat(7, trusted),
    nightsUntilTraining,
    canShowProvisionalScore,
    canShowFinalScore,
    canShowPersonalBaseline,
    canShowTrainedScore,
    qualityFlags,
    nextActions,
  };
}

/** Evaluate the sleep model status from lifecycle signals. */
export function evaluateSleepModelStatus(input: SleepModelStatusInput): SleepModelStatusReport {
  const qualityFlags: string[] = [];
  const nextActions: string[] = [];
  const trusted = input.trustedGooseSleepNights ?? 0;
  const imported = input.importedPlatformSleepNights ?? 0;
  const calibration = input.calibrationLabelCount ?? 0;
  const validSleepNights = trusted + imported;
  const nightsUntilBaseline = sat(7, validSleepNights);
  const nightsUntilTraining = sat(14, calibration);
  const motionOk = coverageOk(input.motionCoverageFraction, 0.7);
  const heartRateOk = coverageOk(input.heartRateCoverageFraction, 0.5);
  const r = (s: SleepModelStatus, label: string, reason: string) =>
    report(s, label, reason, input, validSleepNights, nightsUntilBaseline, nightsUntilTraining, qualityFlags, nextActions);

  if (input.timestampSyncBlocked) {
    qualityFlags.push('timestamp_sync_blocked');
    nextActions.push('Validate and normalize historical packet timestamps before trusting final sleep reports.');
    return r('blocked', 'Blocked', 'Historical packet timestamps are not reliable enough for personalized sleep.');
  }
  if (!input.sleepPermissionGranted && validSleepNights === 0) {
    qualityFlags.push('sleep_history_permission_missing');
    nextActions.push('Grant sleep history access or complete one Goose packet-derived sleep night.');
    return r('setup_needed', 'Setup needed', 'Goose needs sleep history access or one packet-derived night to begin learning.');
  }
  if (input.historyImportInProgress && nightsUntilBaseline > 0) {
    qualityFlags.push('sleep_history_import_in_progress');
    nextActions.push('Keep importing sleep history to bootstrap the baseline.');
    return r('importing_history', 'Importing history', 'Goose is importing existing sleep history before building a baseline.');
  }
  if (!motionOk) {
    qualityFlags.push('motion_coverage_low');
    nextActions.push('Collect a sleep night with stronger motion coverage before trusting personalization.');
  }
  if (!heartRateOk) {
    qualityFlags.push('heart_rate_coverage_low');
    nextActions.push('Collect more overnight heart-rate coverage to improve recovery and HR-dip baselines.');
  }
  if (input.timezoneOrScheduleShiftDetected || input.repeatedLowConfidenceNights) {
    if (input.timezoneOrScheduleShiftDetected) qualityFlags.push('timezone_or_schedule_shift_detected');
    if (input.repeatedLowConfidenceNights) qualityFlags.push('repeated_low_confidence_nights');
    nextActions.push('Collect several recent high-confidence nights so Goose can refresh the baseline.');
    return r('needs_relearn', 'Needs relearn', 'Recent sleep patterns differ enough that Goose should refresh the personal model.');
  }
  if ((input.daysSinceLastValidNight ?? -1) >= 14 && validSleepNights >= 7) {
    qualityFlags.push('sleep_baseline_stale');
    nextActions.push('Record a recent sleep night before relying on the baseline.');
    return r('needs_relearn', 'Needs relearn', 'The sleep baseline is stale because Goose has not seen a recent valid night.');
  }
  if (input.holdoutValidationPassed && trusted >= 7 && calibration >= 14 && motionOk && heartRateOk) {
    return r('trained', 'Trained', 'Goose has a passed personal sleep model for this algorithm version.');
  }
  if (validSleepNights === 0) {
    nextActions.push('Complete one sleep night to start learning.');
    return r('setup_needed', 'Setup needed', 'Goose needs one valid sleep night to start learning.');
  }
  if (validSleepNights < 7) {
    nextActions.push(`Collect ${nightsUntilBaseline} more valid sleep night${plural(nightsUntilBaseline)} for a personal baseline.`);
    return r('learning', 'Learning', `${validSleepNights} valid sleep night${plural(validSleepNights)} collected; ${nightsUntilBaseline} more for baseline.`);
  }
  if (trusted >= 7 && calibration >= 14 && !input.holdoutValidationPassed) {
    nextActions.push('Run holdout validation before marking Sleep V1 trained.');
    return r('training', 'Training', 'Goose has enough sleep history for training, but holdout validation has not passed.');
  }
  if (trusted === 0) {
    nextActions.push('Complete one Goose packet-derived sleep night before showing a final Sleep V1 score.');
  } else if (trusted < 7) {
    nextActions.push(`Collect ${sat(7, trusted)} more Goose packet-derived sleep night${plural(sat(7, trusted))} before training.`);
  } else if (calibration < 14) {
    nextActions.push(`Add ${nightsUntilTraining} more user-owned sleep calibration label${plural(nightsUntilTraining)} before training.`);
  } else {
    nextActions.push('Run holdout validation before marking Sleep V1 trained.');
  }
  return r('baseline_ready', 'Baseline ready', 'Goose has enough sleep history for personal schedule and debt baselines.');
}
