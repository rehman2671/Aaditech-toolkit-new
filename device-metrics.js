// Stage N25: Never turn missing or historic default utilization into a measurement.
export const TELEMETRY_FRESHNESS_MS = 15 * 60_000;
function finite(value, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
    value <= max ? value : null;
}
export function extractMeasurements(metrics, legacyDisk) {
  const m = metrics && typeof metrics === 'object' && !Array.isArray(metrics) ? metrics : {};
  return {
    cpu: finite(m.cpu?.utilization_pct ?? m.cpu_pct, 100),
    ram: finite(m.ram?.utilization_pct ?? m.ram_pct, 100),
    disk: finite(m.disk?.free_gb ?? m.disk_free_gb ?? legacyDisk, 1000000),
    latency: finite(m.network?.latency_ms ?? m.net_latency_ms, 3600000)
  };
}
function stored(raw, suffix, max) {
  if (typeof raw !== 'string') return null;
  const regex = suffix === '%' ? /^\d+(?:\.\d+)?%$/ : /^\d+(?:\.\d+)? GB$/i;
  const value = raw.trim();
  return regex.test(value) ? finite(Number.parseFloat(value), max) : null;
}
export function deviceMetricView(row, now = Date.now()) {
  const at = row?.telemetry_reported_at ? new Date(row.telemetry_reported_at).getTime() : NaN;
  const known = Number.isFinite(at);
  const fresh = known && at <= now && now - at <= TELEMETRY_FRESHNESS_MS;
  const cpu = fresh ? stored(row.cpu_usage, '%', 100) : null;
  const ram = fresh ? stored(row.memory_usage, '%', 100) : null;
  const disk = fresh ? stored(row.disk_free, 'GB', 1000000) : null;
  return {
    telemetry_status: !known ? 'UNVERIFIED' : fresh ? 'AGENT_REPORTED' : 'STALE',
    telemetry_source: fresh ? 'ENROLLED_AGENT' : null,
    telemetry_reported_at: known ? new Date(at).toISOString() : null,
    cpu_usage: cpu === null ? null : cpu.toFixed(1) + '%',
    memory_usage: ram === null ? null : ram.toFixed(1) + '%',
    disk_free: disk === null ? null : disk + ' GB',
    disk_free_gb: disk,
    battery: null // Battery state not collected; never use 100% (AC) fixture.
  };
}
export function analyzeMeasuredTelemetry(history, device, now = Date.now()) {
  const current = deviceMetricView(device, now);
  const cpu = current.cpu_usage === null ? null : Number.parseFloat(current.cpu_usage);
  const ram = current.memory_usage === null ? null : Number.parseFloat(current.memory_usage);
  const disk = current.disk_free_gb;
  const samples = (Array.isArray(history) ? history : []).map(h => ({
    time: h?.recorded_at ? new Date(h.recorded_at).getTime() : NaN,
    disk: finite(h?.disk_free_gb, 1000000)
  })).filter(h => Number.isFinite(h.time) && h.time <= now && now - h.time <= 7 * 86400000 &&
    h.disk !== null).sort((a, b) => a.time - b.time);
  const result = {
    hostname: device?.hostname || null,
    status: 'INSUFFICIENT_DATA', sample_count: samples.length, minimum_required_samples: 5,
    disk_free_gb: disk, daily_growth_gb: null, projected_days_until_full: null,
    memory_usage_pct: ram, cpu_usage_pct: cpu, anomaly_score: null, health_rating: 'Unrated',
    telemetry_status: current.telemetry_status,
    recommended_action: 'Insufficient fresh measured telemetry to compute statistical trend'
  };
  if (current.telemetry_status !== 'AGENT_REPORTED' || disk === null || samples.length < 5)
    return result;
  const first = samples[0], last = samples.at(-1);
  const days = (last.time - first.time) / 86400000;
  if (days < 1 / 24 || now - last.time > TELEMETRY_FRESHNESS_MS) return result;
  const consumption = first.disk - last.disk;
  const rate = consumption > 0 ? consumption / days : 0;
  const remaining = rate > 0 ? Math.ceil(disk / rate) : null;
  const score = (ram !== null && ram > 85 ? 40 : 0) +
    (cpu !== null && cpu > 80 ? 30 : 0) +
    (remaining !== null && remaining < 14 ? 30 : 0);
  return {
    ...result, status: remaining === null ? 'NO_DEPLETION_TREND' : 'ANALYZED',
    daily_growth_gb: rate > 0 ? -Number(rate.toFixed(3)) : 0,
    projected_days_until_full: remaining, anomaly_score: score,
    health_rating: score > 60 ? 'Critical' : score > 30 ? 'Warning' : 'Optimal',
    recommended_action: remaining !== null && remaining < 14 ?
      'Investigate measured disk depletion' :
      ram !== null && ram > 85 ? 'Investigate measured memory pressure' :
      'No measured disk depletion trend requiring a forecast'
  };
}

/** Only validated finite measurements may trigger a notification. */
export function evaluateMeasuredAlert(rule, measured) {
  const metric = rule?.metric;
  if (!['cpu', 'ram', 'disk'].includes(metric)) return null;
  const max = metric === 'disk' ? 1000000 : 100;
  const value = metric === 'cpu' ? measured?.cpu :
    metric === 'ram' ? measured?.ram : measured?.disk;
  const threshold = typeof rule?.threshold === 'number' ? rule.threshold :
    typeof rule?.threshold === 'string' && rule.threshold.trim() !== '' ?
      Number(rule.threshold) : NaN;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max ||
      !Number.isFinite(threshold) || threshold < 0 || threshold > max) return null;
  if (metric === 'cpu' && value >= threshold)
    return `CPU utilization ${value.toFixed(1)}% exceeds threshold ${threshold}%`;
  if (metric === 'ram' && value >= threshold)
    return `RAM load ${value.toFixed(1)}% exceeds threshold ${threshold}%`;
  if (metric === 'disk' && value <= threshold)
    return `Free disk space ${value} GB below threshold ${threshold} GB`;
  return null;
}
