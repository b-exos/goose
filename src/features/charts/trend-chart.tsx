/**
 * Simple trend line over a series of daily points, drawn with Skia. Optional normal-range
 * band (recovery vitals). Auto-scales to the data; renders nothing useful with < 2 points.
 */
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { NEUTRAL } from './colors';

export interface TrendPoint {
  value: number;
}

interface TrendChartProps {
  points: TrendPoint[];
  color: string;
  width?: number;
  height?: number;
}

export function TrendChart({ points, color, width = 280, height = 80 }: TrendChartProps) {
  const path = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const dx = width / (points.length - 1);
    const p = Skia.Path.Make();
    points.forEach((point, i) => {
      const x = i * dx;
      const y = height - ((point.value - min) / range) * height;
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    });
    return p;
  }, [points, width, height]);

  if (!path) {
    return <ThemedText type="small" themeColor="textSecondary">Not enough history yet.</ThemedText>;
  }

  return (
    <View style={[styles.container, { width, height }]}>
      <Canvas style={{ width, height }}>
        <Path path={path} style="stroke" strokeWidth={2} color={color} strokeCap="round" strokeJoin="round" />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignSelf: 'flex-start', backgroundColor: `${NEUTRAL}11`, borderRadius: 8 },
});
