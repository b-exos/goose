/**
 * Linear (1-D OLS) calibration of an algorithm's predictions against labels.
 *
 * Ported from `evaluate_linear_calibration` + helpers in
 * `docs/rust-reference/src/calibration.rs`. Splits records by `splitAt` into train/holdout,
 * fits `label ≈ slope·prediction + intercept` on train, and reports MAE before/after on both
 * sides plus leakage checks. Pinned by the golden fixture `recovery_calibration_linear`.
 *
 * Scope note: the dev-only extras (score-band bias breakdown, remediation "next actions")
 * are intentionally omitted — they are validation tooling, not app runtime.
 */
import {
  StoreValidationError,
} from '../store/validation';

export interface CalibrationRecord {
  recordId: string;
  capturedAt: string;
  sessionId?: string | null;
  metricFamily: string;
  algorithmId: string;
  algorithmVersion: string;
  prediction: number;
  label: number;
}

export interface CalibrationDataset {
  schema: string;
  records: CalibrationRecord[];
}

export interface CalibrationOptions {
  metricFamily: string;
  algorithmId: string;
  algorithmVersion: string;
  splitAt: string;
  minTrainRows: number;
  minHoldoutRows: number;
}

export interface LinearCalibrationModel {
  modelType: 'ordinary_least_squares_1d';
  slope: number;
  intercept: number;
}

export interface CalibrationMetrics {
  mae: number;
  correlation: number | null;
  count: number;
}

export interface LeakageChecks {
  trainRowsBeforeSplit: boolean;
  holdoutRowsAtOrAfterSplit: boolean;
  noSessionOverlap: boolean;
}

export interface CalibrationReport {
  schema: 'goose.calibration-report.v1';
  pass: boolean;
  metricFamily: string;
  algorithmId: string;
  algorithmVersion: string;
  splitAt: string;
  trainCount: number;
  holdoutCount: number;
  model: LinearCalibrationModel | null;
  uncalibratedHoldout: CalibrationMetrics | null;
  calibratedHoldout: CalibrationMetrics | null;
  holdoutImproved: boolean;
  leakageChecks: LeakageChecks;
  issues: string[];
}

/** Predict a calibrated value from a raw prediction. */
export function predict(model: LinearCalibrationModel, prediction: number): number {
  return model.slope * prediction + model.intercept;
}

function fitLinearModel(records: CalibrationRecord[]): LinearCalibrationModel {
  const n = records.length;
  const xMean = records.reduce((s, r) => s + r.prediction, 0) / n;
  const yMean = records.reduce((s, r) => s + r.label, 0) / n;
  const xVar = records.reduce((s, r) => s + (r.prediction - xMean) ** 2, 0);
  if (xVar === 0) throw new StoreValidationError('training predictions have zero variance');
  const covariance = records.reduce(
    (s, r) => s + (r.prediction - xMean) * (r.label - yMean),
    0,
  );
  const slope = covariance / xVar;
  return { modelType: 'ordinary_least_squares_1d', slope, intercept: yMean - slope * xMean };
}

function correlation(x: number[], y: number[]): number | null {
  if (x.length < 2 || y.length < 2) return null;
  const xMean = x.reduce((s, v) => s + v, 0) / x.length;
  const yMean = y.reduce((s, v) => s + v, 0) / y.length;
  let cov = 0;
  let xVar = 0;
  let yVar = 0;
  for (let i = 0; i < x.length; i++) {
    cov += (x[i] - xMean) * (y[i] - yMean);
    xVar += (x[i] - xMean) ** 2;
    yVar += (y[i] - yMean) ** 2;
  }
  if (xVar === 0 || yVar === 0) return null;
  return cov / (Math.sqrt(xVar) * Math.sqrt(yVar));
}

function metricsFor(
  records: CalibrationRecord[],
  predictionFn: (r: CalibrationRecord) => number,
): CalibrationMetrics | null {
  if (records.length === 0) return null;
  const predictions = records.map(predictionFn);
  const labels = records.map((r) => r.label);
  const mae =
    records.reduce((s, r) => s + Math.abs(predictionFn(r) - r.label), 0) / records.length;
  return { mae, correlation: correlation(predictions, labels), count: records.length };
}

function leakageChecks(
  train: CalibrationRecord[],
  holdout: CalibrationRecord[],
  splitAt: string,
): LeakageChecks {
  const trainSessions = new Set(train.map((r) => r.sessionId).filter(Boolean));
  const holdoutSessions = new Set(holdout.map((r) => r.sessionId).filter(Boolean));
  const disjoint = [...trainSessions].every((s) => !holdoutSessions.has(s));
  return {
    trainRowsBeforeSplit: train.every((r) => r.capturedAt < splitAt),
    holdoutRowsAtOrAfterSplit: holdout.every((r) => r.capturedAt >= splitAt),
    noSessionOverlap: disjoint,
  };
}

/** Evaluate a linear calibration over the dataset for the configured algorithm/family. */
export function evaluateLinearCalibration(
  dataset: CalibrationDataset,
  options: CalibrationOptions,
): CalibrationReport {
  const issues: string[] = [];
  if (dataset.schema !== 'goose.calibration-dataset.v1') {
    issues.push(`unsupported dataset schema ${dataset.schema}`);
  }

  const scoped = dataset.records.filter(
    (r) =>
      r.metricFamily === options.metricFamily &&
      r.algorithmId === options.algorithmId &&
      r.algorithmVersion === options.algorithmVersion,
  );
  const train = scoped.filter((r) => r.capturedAt < options.splitAt);
  const holdout = scoped.filter((r) => r.capturedAt >= options.splitAt);

  if (train.length < options.minTrainRows) {
    issues.push(`train_count ${train.length} is below min_train_rows ${options.minTrainRows}`);
  }
  if (holdout.length < options.minHoldoutRows) {
    issues.push(`holdout_count ${holdout.length} is below min_holdout_rows ${options.minHoldoutRows}`);
  }

  const leakage = leakageChecks(train, holdout, options.splitAt);
  if (!leakage.trainRowsBeforeSplit) issues.push('train rows must be before split_at');
  if (!leakage.holdoutRowsAtOrAfterSplit) issues.push('holdout rows must be at or after split_at');
  if (!leakage.noSessionOverlap) issues.push('session_id appears in both train and holdout');

  let model: LinearCalibrationModel | null = null;
  if (issues.length === 0) {
    try {
      model = fitLinearModel(train);
    } catch (error) {
      issues.push(String(error instanceof Error ? error.message : error));
    }
  }

  const uncalibratedHoldout = metricsFor(holdout, (r) => r.prediction);
  const calibratedHoldout = model ? metricsFor(holdout, (r) => predict(model!, r.prediction)) : null;
  const holdoutImproved =
    uncalibratedHoldout !== null &&
    calibratedHoldout !== null &&
    calibratedHoldout.mae < uncalibratedHoldout.mae;

  if (model !== null && !holdoutImproved) {
    issues.push('calibrated holdout MAE did not improve');
  }

  return {
    schema: 'goose.calibration-report.v1',
    pass: issues.length === 0 && model !== null,
    metricFamily: options.metricFamily,
    algorithmId: options.algorithmId,
    algorithmVersion: options.algorithmVersion,
    splitAt: options.splitAt,
    trainCount: train.length,
    holdoutCount: holdout.length,
    model,
    uncalibratedHoldout,
    calibratedHoldout,
    holdoutImproved,
    leakageChecks: leakage,
    issues,
  };
}
