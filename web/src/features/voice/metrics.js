const samples = new Map();
export function observeVoice(stage, ms) {
  if (!Number.isFinite(ms) || ms < 0) return;
  const values = samples.get(stage) || [];
  values.push(ms); if (values.length > 512) values.shift(); samples.set(stage, values);
}
export function voiceLatencySummary() {
  return Object.fromEntries([...samples].map(([stage, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return [stage, { count: sorted.length, median_ms: sorted[Math.ceil(sorted.length * .5) - 1], p95_ms: sorted[Math.ceil(sorted.length * .95) - 1] }];
  }));
}
