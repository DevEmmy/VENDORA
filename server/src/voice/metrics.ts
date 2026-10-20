// Bounded process-local telemetry; no transcripts, product names or credentials.
const samples = new Map<string, number[]>();
export function observe(stage: string, milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
  const values = samples.get(stage) ?? [];
  values.push(milliseconds);
  if (values.length > 512) values.shift();
  samples.set(stage, values);
}
export function latencySummary() {
  return Object.fromEntries([...samples].map(([stage, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return [stage, { count: sorted.length, median_ms: sorted[Math.ceil(sorted.length * .5) - 1], p95_ms: sorted[Math.ceil(sorted.length * .95) - 1] }];
  }));
}
