/**
 * Goose Sleep V1 — personalized sleep score layered on Sleep v0.
 *
 * Ported from `goose_sleep_v1` in `docs/rust-reference/src/metrics.rs`. Combines seven
 * weighted components (need, continuity, schedule, architecture, cardiovascular, context,
 * data-confidence) and applies fragmentation guardrails. Pinned by `sleep-v1.test.ts`
 * against the hand-derived expectation (score 82.01361892264234).
 *
 * Scope note: prior-night baseline personalization is deferred (baseline = null); see
 * `sleep-v1-scores.ts`. Output matches Rust whenever `prior_nights` is empty.
 */
import { componentSum, scoreComponent, clampFraction, type ScoreComponent } from '../scoring';
import { gooseSleepV0, type SleepInput, type SleepScoreOutput } from './sleep';
import {
  sleepArchitectureScore,
  sleepCardiovascularScore,
  sleepContextScore,
  sleepContinuityScore,
  sleepNeedFulfillmentScore,
  sleepScheduleScore,
} from './sleep-v1-scores';
import {
  evaluateSleepModelStatus,
  type SleepModelStatus,
  type SleepModelStatusInput,
  type SleepModelStatusReport,
} from './sleep-v1-status';
import type { AlgorithmRunResult } from '../types';

export const GOOSE_SLEEP_V1_ID = 'goose.sleep.v1';
export const GOOSE_SLEEP_V1_VERSION = '0.1.0';

export interface SleepV1Input {
  sleep: SleepInput;
  modelStatus: SleepModelStatusInput;
  priorNights: unknown[];
  bedtimeDeviationMinutes: number;
  wakeTimeDeviationMinutes: number;
  rollingSleepDebtMinutes: number;
  sleepHrAverageBpm: number | null;
  sleepHrMinBpm: number | null;
  preSleepAwakeHrAverageBpm: number | null;
  sleepHrTrendBpmPerHour: number | null;
  napsMinutes: number;
  priorDayStrain: number | null;
  dataCoverageFraction: number | null;
}

export interface SleepV1Output {
  algorithmId: string;
  algorithmVersion: string;
  modelStatus: SleepModelStatus;
  modelStatusLabel: string;
  score0To100: number;
  sleepWindowConfidence0To1: number;
  sleepNeedMinutes: number;
  sleepDebtMinutes: number;
  rollingSleepDebtMinutes: number;
  bedtimeDeviationMinutes: number;
  wakeTimeDeviationMinutes: number;
  deepSleepMinutes: number;
  remSleepMinutes: number;
  coreSleepMinutes: number;
  sleepHrAverageBpm: number | null;
  sleepHrMinBpm: number | null;
  sleepHrTrendBpmPerHour: number | null;
  sleepHrDipPercent: number | null;
  sleepHrRecoveryScore: number | null;
  napsMinutes: number;
  priorDayStrain: number | null;
  dataCoverageFraction: number | null;
  confidence0To1: number;
  statusReport: SleepModelStatusReport;
  components: ScoreComponent[];
}

function effectiveStageMinutes(input: SleepV1Input): Record<string, number> {
  return { ...input.sleep.stageMinutes };
}

function confidence0To1(
  status: SleepModelStatusReport,
  dataCoverageFraction: number | null,
  heartRateDipPercent: number | null,
  hasArchitecture: boolean,
): number {
  const statusBasis = { trained: 0.95, baseline_ready: 0.78, training: 0.78, learning: 0.55, importing_history: 0.55, needs_relearn: 0.45, setup_needed: 0.3, blocked: 0.1 }[status.status];
  const coverage = Math.min(Math.max(dataCoverageFraction ?? 0.65, 0), 1);
  const hrBasis = heartRateDipPercent != null ? 1 : 0.82;
  const archBasis = hasArchitecture ? 1 : 0.86;
  let c = clampFraction(statusBasis * 0.55 + coverage * 0.25 + hrBasis * 0.1 + archBasis * 0.1);
  if (status.qualityFlags.includes('motion_coverage_low')) c = Math.min(c, 0.6);
  if (status.qualityFlags.includes('heart_rate_coverage_low')) c = Math.min(c, 0.72);
  return c;
}

function windowConfidence0To1(
  input: SleepV1Input,
  status: SleepModelStatusReport,
  dataCoverageFraction: number | null,
): number {
  if (status.status === 'blocked') return 0.1;
  const statusBasis = { trained: 0.96, baseline_ready: 0.84, training: 0.84, learning: 0.62, importing_history: 0.62, needs_relearn: 0.52, setup_needed: 0.35, blocked: 0.1 }[status.status];
  const coverage = Math.min(Math.max(dataCoverageFraction ?? input.modelStatus.motionCoverageFraction ?? 0.65, 0), 1);
  const tib = input.sleep.timeInBedMinutes;
  const dur = input.sleep.sleepDurationMinutes;
  const durationBasis = tib >= 180 && dur >= 60 && dur <= tib ? 1 : 0.45;
  let c = statusBasis * 0.55 + coverage * 0.35 + durationBasis * 0.1;
  if (status.qualityFlags.includes('motion_coverage_low')) c = Math.min(c, 0.55);
  if (status.qualityFlags.includes('heart_rate_coverage_low')) c = Math.min(c, 0.7);
  return clampFraction(c);
}

function guardrail(score: number, input: SleepV1Input, efficiencyFraction: number, flags: string[]): number {
  let s = Math.min(Math.max(score, 0), 100);
  if (input.sleep.sleepDurationMinutes < 180) {
    flags.push('sleep_v1_guardrail_very_short_sleep');
    s = Math.min(s, 45);
  }
  if (input.sleep.wakeAfterSleepOnsetMinutes >= 120 || input.sleep.wakeEpisodeCount >= 10) {
    flags.push('sleep_v1_guardrail_severe_fragmentation');
    s = Math.min(s, 65);
  }
  if (efficiencyFraction < 0.55) {
    flags.push('sleep_v1_guardrail_low_efficiency');
    s = Math.min(s, 60);
  }
  return s;
}

function components(
  input: SleepV1Input,
  v0: SleepScoreOutput,
  rollingDebt: number,
  dataCoverage: number | null,
  conf: number,
  windowConf: number,
  stages: Record<string, number>,
): ScoreComponent[] {
  const dataConfidenceScore = conf * windowConf * (dataCoverage ?? 0.65) * 100;
  return [
    scoreComponent('sleep_need_fulfillment', input.sleep.sleepDurationMinutes, 'minutes', sleepNeedFulfillmentScore(input.sleep.sleepDurationMinutes, input.sleep.sleepNeedMinutes, rollingDebt, input.napsMinutes), 0.25, 100),
    scoreComponent('continuity', input.sleep.wakeAfterSleepOnsetMinutes, 'minutes_waso', sleepContinuityScore(v0.efficiencyFraction, input.sleep.sleepLatencyMinutes, input.sleep.wakeAfterSleepOnsetMinutes, input.sleep.wakeEpisodeCount), 0.2, 100),
    scoreComponent('schedule_regularity', input.sleep.midpointDeviationMinutes, 'minutes_deviation', sleepScheduleScore(input.bedtimeDeviationMinutes, input.wakeTimeDeviationMinutes, input.sleep.midpointDeviationMinutes), 0.15, 100),
    scoreComponent('sleep_architecture', v0.restorativeSleepMinutes, 'minutes_restorative', sleepArchitectureScore(stages, input.sleep.sleepDurationMinutes), 0.15, 100),
    scoreComponent('cardiovascular_recovery', input.sleep.heartRateDipPercent ?? 0, 'hr_dip_percent', sleepCardiovascularScore({ heartRateDipPercent: input.sleep.heartRateDipPercent, preSleepAwakeHrAverageBpm: input.preSleepAwakeHrAverageBpm, sleepHrAverageBpm: input.sleepHrAverageBpm, sleepHrTrendBpmPerHour: input.sleepHrTrendBpmPerHour }), 0.15, 100),
    scoreComponent('context_adjustment', input.priorDayStrain ?? 0, 'strain_0_to_21', sleepContextScore(input.priorDayStrain, input.napsMinutes), 0.05, 100),
    scoreComponent('data_confidence', dataCoverage ?? 0.65, 'fraction', dataConfidenceScore, 0.05, 100),
  ];
}

export function gooseSleepV1(input: SleepV1Input): AlgorithmRunResult<SleepV1Output> {
  const qualityFlags: string[] = [];
  const statusReport = evaluateSleepModelStatus(input.modelStatus);
  qualityFlags.push(...statusReport.qualityFlags);
  if (statusReport.status === 'blocked') qualityFlags.push('sleep_v1_status_blocked');

  const v0Result = gooseSleepV0(input.sleep);
  qualityFlags.push(...v0Result.qualityFlags);
  const errors = [...v0Result.errors];

  let output: SleepV1Output | null = null;
  if (errors.length === 0 && v0Result.output) {
    const v0 = v0Result.output;
    const stages = effectiveStageMinutes(input);
    const dataCoverage = input.dataCoverageFraction;
    const conf = confidence0To1(statusReport, dataCoverage, input.sleep.heartRateDipPercent, Object.keys(stages).length > 0);
    const windowConf = windowConfidence0To1(input, statusReport, dataCoverage);
    const rollingDebt = input.rollingSleepDebtMinutes > 0 ? input.rollingSleepDebtMinutes : v0.sleepDebtMinutes;
    const comps = components(input, v0, rollingDebt, dataCoverage, conf, windowConf, stages);
    const score = guardrail(componentSum(comps), input, v0.efficiencyFraction, qualityFlags);
    const dip = input.sleep.heartRateDipPercent;

    output = {
      algorithmId: GOOSE_SLEEP_V1_ID,
      algorithmVersion: GOOSE_SLEEP_V1_VERSION,
      modelStatus: statusReport.status,
      modelStatusLabel: statusReport.statusLabel,
      score0To100: score,
      sleepWindowConfidence0To1: windowConf,
      sleepNeedMinutes: input.sleep.sleepNeedMinutes,
      sleepDebtMinutes: v0.sleepDebtMinutes,
      rollingSleepDebtMinutes: rollingDebt,
      bedtimeDeviationMinutes: input.bedtimeDeviationMinutes,
      wakeTimeDeviationMinutes: input.wakeTimeDeviationMinutes,
      deepSleepMinutes: stages.deep ?? 0,
      remSleepMinutes: stages.rem ?? 0,
      coreSleepMinutes: stages.core ?? 0,
      sleepHrAverageBpm: input.sleepHrAverageBpm,
      sleepHrMinBpm: input.sleepHrMinBpm,
      sleepHrTrendBpmPerHour: input.sleepHrTrendBpmPerHour,
      sleepHrDipPercent: dip,
      sleepHrRecoveryScore: dip == null ? null : Math.min(Math.max((dip / 20) * 100, 0), 100),
      napsMinutes: input.napsMinutes,
      priorDayStrain: input.priorDayStrain,
      dataCoverageFraction: dataCoverage,
      confidence0To1: conf,
      statusReport,
      components: comps,
    };
  }

  return {
    algorithmId: GOOSE_SLEEP_V1_ID,
    algorithmVersion: GOOSE_SLEEP_V1_VERSION,
    family: 'sleep',
    startTime: input.sleep.startTime,
    endTime: input.sleep.endTime,
    output,
    qualityFlags,
    errors,
    provenance: {
      input_ids: input.sleep.inputIds,
      score_policy: 'weighted_sleep_v1_components_with_fragmentation_guardrails',
      status_policy: 'rust_sleep_model_status_report',
      expected_values_policy: 'hand-derived-tests-and-versioned-goose-output',
    },
  };
}
