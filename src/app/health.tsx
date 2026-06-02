/** Health tab — per-family metric surfaces from the day's computed metrics. */
import { useEffect } from 'react';

import { ThemedText } from '@/components/themed-text';
import { MetricReadout, SectionCard } from '@/features/components/section-card';
import { ScreenScaffold } from '@/features/components/screen-scaffold';
import { useDatabase } from '@/state/db-provider';
import { dateKeyOf, useHealthStore } from '@/state/health-store';

export default function HealthScreen() {
  const { db, ready } = useDatabase();
  const today = useHealthStore((s) => s.today);
  const load = useHealthStore((s) => s.load);

  useEffect(() => {
    if (ready && db) void load(db, dateKeyOf(new Date()));
  }, [ready, db, load]);

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

      <SectionCard title="Recovery & HRV" subtitle="Unavailable">
        <ThemedText type="small" themeColor="textSecondary">
          Recovery and HRV need RR-interval (optical) decoding, which isn't implemented yet —
          shown as unavailable rather than estimated.
        </ThemedText>
      </SectionCard>
    </ScreenScaffold>
  );
}
