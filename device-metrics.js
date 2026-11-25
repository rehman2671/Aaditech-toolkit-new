// Stage N25: Never turn missing or historic default utilization into a measurement.
export const TELEMETRY_FRESHNESS_MS = 15 * 60_000;
const MAX_FORECAST_GAP_MS = 60 * 60_000;
const MAX_SNAPSHOT_SKEW_MS = 5 * 60_000;
// SQL history is FLOAT while the current display uses decimal GB text.
const diskAgrees = (a,b) => Math.abs(a-b) <= Math.max(0.001, Math.max(a,b)*1e-7);
function observedTime(raw) {
  return raw instanceof Date ? raw.getTime() : typeof raw === 'string' && raw.length <= 128 ? Date.parse(raw) : NaN;
}
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
  const at = observedTime(row?.telemetry_reported_at);
  const known = Number.isFinite(at);
  const fresh = known && Number.isFinite(now) && at <= now && now - at <= TELEMETRY_FRESHNESS_MS;
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
  const candidates = (Array.isArray(history) ? history : []).map(h => ({
    time: observedTime(h?.recorded_at),
    disk: finite(h?.disk_free_gb, 1000000)
  })).filter(h => Number.isFinite(h.time) && h.time <= now && now - h.time <= 7 * 86400000 &&
    h.disk !== null).sort((a, b) => a.time - b.time);
  // Count distinct observation times, not duplicate rows; conflicting
  // measurements at one timestamp are unusable evidence.
  const byTime=new Map(),conflicts=new Set();
  for(const sample of candidates){
    if(byTime.has(sample.time)&&byTime.get(sample.time).disk!==sample.disk)conflicts.add(sample.time);
    else if(!byTime.has(sample.time))byTime.set(sample.time,sample);
  }
  const samples=[...byTime.values()].filter(x=>!conflicts.has(x.time));
  const result = {
    hostname: device?.hostname || null,
    status: 'INSUFFICIENT_DATA', sample_count: samples.length, minimum_required_samples: 5,
    disk_free_gb: disk, daily_growth_gb: null, projected_days_until_full: null,
    memory_usage_pct: ram, cpu_usage_pct: cpu, anomaly_score: null, health_rating: 'Unrated',
    telemetry_status: current.telemetry_status,
    conflicting_sample_times: conflicts.size,
    recommended_action: 'Insufficient fresh measured telemetry to compute statistical trend'
  };
  if (current.telemetry_status !== 'AGENT_REPORTED' || disk === null || samples.length < 5 || conflicts.size>0 ||
      [true,1,'1'].includes(device?.agent_token_revoked))
    return result;
  const first = samples[0], last = samples.at(-1);
  const days = (last.time - first.time) / 86400000;
  if (days < 1 / 24 || now - last.time > TELEMETRY_FRESHNESS_MS) return result;
  // Avoid a confident forecast across an observation outage, or between
  // incompatible current and historical snapshots. This is advisory only.
  if (samples.some((sample,i)=>i>0 && sample.time-samples[i-1].time>MAX_FORECAST_GAP_MS))
    return {...result, forecast_blocker:'OBSERVATION_GAP'};
  if (Math.abs(last.time-observedTime(device.telemetry_reported_at))>MAX_SNAPSHOT_SKEW_MS || !diskAgrees(last.disk,disk))
    return {...result, forecast_blocker:'SNAPSHOT_MISMATCH'};
  const consumption = first.disk - last.disk;
  const rate = consumption > 0 ? consumption / days : 0;
  const remaining = rate > 0 ? Math.ceil(disk / rate) : null;
  // A disk forecast may be valid even when CPU/RAM are absent. Do not
  // turn missing dimensions into a falsely healthy composite score.
  const score = ram === null || cpu === null ? null :
    (ram > 85 ? 40 : 0) + (cpu > 80 ? 30 : 0) +
    (remaining !== null && remaining < 14 ? 30 : 0);
  return {
    ...result, status: remaining === null ? 'NO_DEPLETION_TREND' : 'ANALYZED',
    daily_growth_gb: rate > 0 ? -Number(rate.toFixed(3)) : 0,
    projected_days_until_full: remaining, anomaly_score: score,
    health_rating: score === null ? 'Unrated' : score > 60 ? 'Critical' : score > 30 ? 'Warning' : 'Optimal',
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
    typeof rule?.threshold === 'string' && rule.threshold.length <= 32 &&
      rule.threshold === rule.threshold.trim() && /^\d+(?:\.\d+)?$/.test(rule.threshold) ?
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
