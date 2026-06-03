/** Health tab — per-family metric surfaces from the day's computed metrics. */
import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { MetricReadout, SectionCard } from '@/features/components/section-card';
import { ScreenScaffold } from '@/features/components/screen-scaffold';
import { useDatabase } from '@/state/db-provider';
import { dateKeyOf, useHealthStore } from '@/state/health-store';

export default function HealthScreen() {
  const { db, ready } = useDatabase();
  const today = useHealthStore((s) => s.today);
  const load = useHealthStore((s) => s.load);

  // Re-load on focus so the day's metrics stay current across date rollover + recomputes.
  useFocusEffect(
    useCallback(() => {
      if (ready && db) void load(db, dateKeyOf(new Date()));
    }, [ready, db, load]),
  );

  const fmt = (v: number | null | undefined, digits = 0) =>
    v == null ? '—' : v.toFixed(digits);

  return (
    <ScreenScaffold title="Health">
      <ThemedText type="small">
        Computed on-device from your band data. Values appear after a sync.
      </ThemedText>

      <SectionCard title="Sleep" subtitle="Score 0–100">
        <MetricReadout value={fmt(today?.sleepScore0To100)} caption="Sleep score" />
      </SectionCard>

      <SectionCard title="Strain" subtitle="Score 0–21">
        <MetricReadout value={fmt(today?.strainScore0To21, 1)} caption="Day strain" />
      </SectionCard>

      <SectionCard title="Resting HR" subtitle="bpm">
        <MetricReadout value={fmt(today?.restingHrBpm)} caption="Lowest-quartile resting HR" />
      </SectionCard>

      <SectionCard title="Energy" subtitle="kcal">
        <MetricReadout value={fmt(today?.totalKcal)} caption="Total energy (estimate)" />
      </SectionCard>

      <SectionCard
        title="Recovery & HRV"
        subtitle={
          today?.recoveryStatus === 'available'
            ? 'Score 0–100'
            : today?.recoveryStatus === 'calibrating'
              ? 'Calibrating'
              : 'Unavailable'
        }>
        {today?.recoveryStatus === 'available' ? (
          <>
            <MetricReadout value={fmt(today?.recoveryScore0To100)} caption="Recovery score" />
            <MetricReadout value={fmt(today?.hrvRmssdMs)} caption="HRV (ms RMSSD)" />
            <ThemedText type="small" themeColor="textSecondary">
              HRV/RHR-driven vs your baseline; respiratory & skin temp use neutral placeholders.
            </ThemedText>
          </>
        ) : today?.recoveryStatus === 'calibrating' ? (
          <>
            <MetricReadout value={fmt(today?.hrvRmssdMs)} caption="HRV (ms RMSSD) — recording" />
            <ThemedText type="small" themeColor="textSecondary">
              Building your baseline. Recovery needs several nights worn overnight before the score
              is meaningful — a single day has nothing to compare against.
            </ThemedText>
          </>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Recovery & HRV need optical RR intervals. Wear the band and Start monitor to record HRV.
          </ThemedText>
        )}
      </SectionCard>
    </ScreenScaffold>
  );
}
