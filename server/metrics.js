// In-process metrics in the Prometheus text format, served at /metrics to the server
// itself and the private network only (never through Cloudflare). No dependencies.
'use strict';
const { performance } = require('perf_hooks');

/** @type {Map<string, { help: string, type: 'counter' | 'gauge', values: Map<string, number>, read?: () => number }>} */
const families = new Map();
/** @type {Map<string, Histogram>} */
const histograms = new Map();

/** @param {Record<string, string | number>} [labels] */
const labelKey = (labels = {}) => {
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${String(v).replace(/["\\\n]/g, '_')}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
};

/** @param {string} name @param {string} help @param {'counter' | 'gauge'} type */
function family(name, help, type) {
  let f = families.get(name);
  if (!f) { f = { help, type, values: new Map() }; families.set(name, f); }
  return f;
}

/** A counter that only goes up. @param {string} name @param {string} help */
function counter(name, help) {
  const f = family(name, help, 'counter');
  return {
    /** @param {Record<string, string | number>} [labels] @param {number} [n] */
    inc(labels, n = 1) { const k = labelKey(labels); f.values.set(k, (f.values.get(k) || 0) + n); },
  };
}

/** A value read when /metrics is scraped. @param {string} name @param {string} help @param {() => number} read */
function gauge(name, help, read) {
  const f = family(name, help, 'gauge');
  f.read = read;
  return f;
}

class Histogram {
  /** @param {string} name @param {string} help @param {number[]} buckets upper bounds, in seconds */
  constructor(name, help, buckets) {
    this.name = name;
    this.help = help;
    this.buckets = buckets;
    /** @type {Map<string, { counts: number[], sum: number, n: number }>} */
    this.series = new Map();
  }

  /** @param {number} seconds @param {Record<string, string | number>} [labels] */
  observe(seconds, labels) {
    const k = labelKey(labels);
    let s = this.series.get(k);
    if (!s) { s = { counts: this.buckets.map(() => 0), sum: 0, n: 0 }; this.series.set(k, s); }
    for (let i = 0; i < this.buckets.length; i++) if (seconds <= this.buckets[i]) s.counts[i]++;
    s.sum += seconds;
    s.n++;
  }
}

/** @param {string} name @param {string} help @param {number[]} buckets */
function histogram(name, help, buckets) {
  const h = new Histogram(name, help, buckets);
  histograms.set(name, h);
  return h;
}

// Event-loop delay: how late a timer due every 20 ms actually runs. That's how long ready
// work waits for the single JS thread, the real limit on how many tables one process runs.
// (Measured directly: perf_hooks' monitor folds its own sampling interval into each reading.)
const TICK_MS = 20;
/** @type {number[]} lateness of each tick since the last scrape, ms */
let lags = [];
let expected = performance.now() + TICK_MS;
setInterval(() => {
  const now = performance.now();
  lags.push(Math.max(0, now - expected));
  if (lags.length > 20000) lags = lags.slice(-10000);
  expected = now + TICK_MS;
}, TICK_MS).unref();
/** @param {number} p 0–100 */
const lagPercentile = (p) => {
  if (!lags.length) return 0;
  const sorted = [...lags].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] / 1000;
};
gauge('nodejs_eventloop_delay_p50_seconds', 'Event-loop delay, median since the last scrape.', () => lagPercentile(50));
gauge('nodejs_eventloop_delay_p99_seconds', 'Event-loop delay, 99th percentile since the last scrape.', () => lagPercentile(99));
gauge('nodejs_eventloop_delay_max_seconds', 'Event-loop delay, worst since the last scrape.', () => lagPercentile(100));
gauge('process_resident_memory_bytes', 'Resident memory.', () => process.memoryUsage().rss);
gauge('nodejs_heap_used_bytes', 'V8 heap in use.', () => process.memoryUsage().heapUsed);
gauge('process_uptime_seconds', 'Seconds since the server started.', () => process.uptime());
gauge('process_cpu_seconds_total', 'CPU time used (user + system).', () => { const u = process.cpuUsage(); return (u.user + u.system) / 1e6; });

/** @param {Record<string, number>} [extra] gauges computed by the caller (connections, rooms, usage) */
function render(extra = {}) {
  const out = [];
  for (const [name, f] of families) {
    out.push(`# HELP ${name} ${f.help}`, `# TYPE ${name} ${f.type}`);
    if (f.read) out.push(`${name} ${f.read()}`);
    else for (const [k, v] of f.values) out.push(`${name}${k} ${v}`);
  }
  for (const h of histograms.values()) {
    out.push(`# HELP ${h.name} ${h.help}`, `# TYPE ${h.name} histogram`);
    for (const [k, s] of h.series) {
      const inner = k ? k.slice(1, -1) : '';
      h.buckets.forEach((b, i) => out.push(`${h.name}_bucket{${inner ? `${inner},` : ''}le="${b}"} ${s.counts[i]}`));
      out.push(`${h.name}_bucket{${inner ? `${inner},` : ''}le="+Inf"} ${s.n}`, `${h.name}_sum${k} ${s.sum}`, `${h.name}_count${k} ${s.n}`);
    }
  }
  for (const [name, v] of Object.entries(extra)) out.push(`# TYPE ${name} gauge`, `${name} ${v}`);
  lags = []; // the delay gauges cover the time since the last scrape
  return `${out.join('\n')}\n`;
}

module.exports = { counter, gauge, histogram, render };
