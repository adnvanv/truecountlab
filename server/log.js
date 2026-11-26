// Structured logs: one JSON object per line, so journald (and anything reading it) can
// filter by level, event or field. LOG_LEVEL=debug|info|warn|error (default info).
// Example: {"t":"2026-11-26T05:00:00.000Z","level":"info","msg":"http","method":"GET","path":"/api/me","status":200,"ms":1.2}
'use strict';

/** @typedef {'debug' | 'info' | 'warn' | 'error'} Level */
/** @type {Record<Level, number>} */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const configured = /** @type {Level} */ (String(process.env.LOG_LEVEL || 'info').toLowerCase());
const min = LEVELS[configured] ?? LEVELS.info;

/** Errors become { message, stack } (first few frames), everything else is kept as is. @param {unknown} v */
function plain(v) {
  if (v instanceof Error) return { message: v.message, ...(v.stack ? { stack: v.stack.split('\n').slice(0, 6).join('\n') } : {}) };
  return v;
}

/**
 * @param {Level} level
 * @param {string} msg
 * @param {Record<string, unknown>} [fields]
 */
function write(level, msg, fields = {}) {
  if (LEVELS[level] < min) return;
  /** @type {Record<string, unknown>} */
  const out = { t: new Date().toISOString(), level, msg };
  for (const [k, v] of Object.entries(fields)) out[k] = plain(v);
  const line = `${JSON.stringify(out)}\n`;
  if (level === 'error' || level === 'warn') process.stderr.write(line);
  else process.stdout.write(line);
}

module.exports = {
  /** @param {string} msg @param {Record<string, unknown>} [fields] */
  debug: (msg, fields) => write('debug', msg, fields),
  /** @param {string} msg @param {Record<string, unknown>} [fields] */
  info: (msg, fields) => write('info', msg, fields),
  /** @param {string} msg @param {Record<string, unknown>} [fields] */
  warn: (msg, fields) => write('warn', msg, fields),
  /** @param {string} msg @param {Record<string, unknown>} [fields] */
  error: (msg, fields) => write('error', msg, fields),
  enabled: /** @param {Level} level */ (level) => LEVELS[level] >= min,
};
