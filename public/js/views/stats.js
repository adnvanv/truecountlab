// Stats per mode: accuracy, speed, error types, progress over time.
import { h, head, pct, secs, lineChart, dailyAccuracy, money } from '../ui.js';
import { DEV_ERRORS } from './deviation.js';
import { heatmapEl } from './basic.js';
import { ACTIONS, DEVS } from '../strategy.js';
import { currentUser } from '../store.js';

const MODES = [
  { id: 'countdown', label: 'Countdown', link: '#countdown' },
  { id: 'basic', label: 'Basic Strategy', link: '#basic' },
  { id: 'deviation', label: 'Deviations', link: '#deviation' },
  { id: 'table', label: 'Table', link: '#table' },
  { id: 'training', label: 'Training', link: '#training' },
];

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const diffBucket = (d) => (Math.abs(d) === 1 ? 'Off by 1' : Math.abs(d) === 2 ? 'Off by 2' : 'Off by 3 or more');

function errorBars(counts) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return h('p', { class: 'muted' }, 'No errors recorded.');
  const max = entries[0][1];
  return h('div', { class: 'bars' }, entries.map(([k, v]) => h('div', { class: 'bar-row' },
    h('span', { class: 'bar-label' }, k),
    h('span', { class: 'bar' }, h('i', { style: `width:${(100 * v) / max}%` })),
    h('span', { class: 'bar-v' }, v))));
}

function tally(runs, keyFn) {
  const out = {};
  for (const r of runs) if (!r.ok) { const k = keyFn(r); if (k) out[k] = (out[k] || 0) + 1; }
  return out;
}

function progress(runs, { speed = true } = {}) {
  const days = dailyAccuracy(runs);
  return h('div', { class: 'charts two' },
    h('div', {}, h('h3', {}, 'Accuracy by day'), lineChart([{ name: 'Accuracy', color: '#6ad99a', points: days.map((d) => ({ x: d.x, y: Math.round(d.acc) })) }], { yFmt: (v) => `${v}%`, yMin: 0, yMax: 100, height: 140 })),
    speed ? h('div', {}, h('h3', {}, 'Average time by day'), lineChart([{ name: 'Time', color: '#e3bc5f', points: days.filter((d) => d.ms).map((d) => ({ x: d.x, y: d.ms / 1000 })) }], { yFmt: (v) => `${v}s`, height: 140 })) : null);
}

function detail(id, s, G) {
  const st = s[id];
  const runs = st.runs || [];
  const ok = runs.filter((r) => r.ok);
  const last50 = runs.slice(-50);
  const numbers = (pairs) => h('div', { class: 'kpis' }, pairs.map(([k, v]) => h('div', { class: 'kpi' }, h('div', { class: 'v' }, v), h('div', { class: 'k' }, k))));
  const base = [
    ['Attempts', runs.length],
    ['Accuracy', pct(ok.length, runs.length)],
    ['Last 50', pct(last50.filter((r) => r.ok).length, last50.length)],
    ['Avg time', runs.length ? secs(avg(runs.map((r) => r.ms))) : '—'],
  ];

  if (id === 'countdown') {
    const best = ok.length ? Math.min(...ok.map((r) => r.ms)) : null;
    const extra = [['Best correct', best ? secs(best) : '—'], ['Correct at deck pace', runs.filter((r) => r.goal).length]];
    return [numbers([...base, ...extra]), h('h3', {}, 'Error types'), errorBars(tally(runs, (r) => diffBucket(r.diff))), progress(runs)];
  }
  if (id === 'basic') {
    return [numbers(base), h('h3', {}, 'Error types'), errorBars(tally(runs, (r) => `Should ${ACTIONS[r.want]?.toLowerCase()}, chose ${ACTIONS[r.chose]?.toLowerCase()}`)),
      progress(runs), h('h3', {}, 'Mistake heatmap'), heatmapEl(st.cells)];
  }
  if (id === 'deviation') {
    const byDev = Object.fromEntries(DEVS.map((d) => [d.id, d.name]));
    const picks = { basic: 'Basic strategy', deviation: 'The deviation', wrong: 'A wrong play' };
    const pickCounts = {};
    for (const r of runs) if (r.picked) pickCounts[picks[r.picked]] = (pickCounts[picks[r.picked]] || 0) + 1;
    return [numbers(base), h('h3', {}, 'What you picked'), h('div', { class: 'muted' }, Object.entries(pickCounts).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'),
      h('h3', {}, 'Error types'), errorBars(tally(runs, (r) => DEV_ERRORS[r.err])),
      h('h3', {}, 'Misses by deviation'), errorBars(tally(runs, (r) => byDev[r.dev])), progress(runs)];
  }

  // table / training
  const T = st;
  if (id === 'training') {
    return [numbers([
      ['Hands', T.hands], ['Decisions', pct(T.correct, T.decisions)], ['Deviations', pct(T.devsCorrect, T.devs)],
      ['Count checks', pct(T.checksCorrect, T.checks)], ['Bets on ramp', pct(T.betsCorrect, T.bets)],
    ]), h('h3', {}, 'Most-missed hands'), errorBars(Object.fromEntries(Object.entries(T.misses).sort((a, b) => b[1] - a[1]).slice(0, 10))),
    h('p', { class: 'muted' }, 'Training-table play is kept separate from the real table and doesn’t count toward the ready-to-play checklist.')];
  }
  const sims = G.sessions.filter((x) => x.kind === 'sim').sort((a, b) => a.t - b.t);
  return [
    numbers([
      ['Hands', T.hands], ['Decisions', pct(T.correct, T.decisions)], ['Deviations', pct(T.devsCorrect, T.devs)],
      ['Count checks', pct(T.checksCorrect, T.checks)], ['Bets on ramp', pct(T.betsCorrect, T.bets)], ['Count reveals', T.peeks],
    ]),
    h('h3', {}, 'Most-missed hands'),
    errorBars(Object.fromEntries(Object.entries(T.misses).sort((a, b) => b[1] - a[1]).slice(0, 10))),
    h('div', { class: 'charts two' },
      h('div', {}, h('h3', {}, 'Accuracy by session'), lineChart([
        { name: 'Play', color: '#6ad99a', points: sims.filter((x) => x.decisionAcc != null).map((x) => ({ x: x.end, y: x.decisionAcc })) },
        { name: 'Count checks', color: '#84c8ff', points: sims.filter((x) => x.countAcc != null).map((x) => ({ x: x.end, y: x.countAcc })) },
        { name: 'Bets', color: '#e3bc5f', points: sims.filter((x) => x.betAcc != null).map((x) => ({ x: x.end, y: x.betAcc })) },
      ], { yFmt: (v) => `${v}%`, yMin: 0, yMax: 100, height: 140 })),
      h('div', {}, h('h3', {}, 'Session results'), lineChart([{ name: 'Net', color: '#e3bc5f', points: sims.map((x) => ({ x: x.end, y: x.cashOut - x.buyIn })) }], { yFmt: (v) => money(v), zero: true, height: 140 }))),
  ];
}

// Guests: progress over time is what an account is for.
function locked() {
  return h('section', { class: 'view' },
    head('Stats', 'Your accuracy, speed, weak spots and progress over time, for every mode.'),
    h('div', { class: 'panel lock-card' },
      h('div', { class: 'lock-icon', 'aria-hidden': 'true' }, '🔒'),
      h('h2', {}, 'Track your progress with a free account'),
      h('p', { class: 'muted' }, 'Guests can use every mode, but nothing is kept after the tab closes. With an account you get:'),
      h('ul', { class: 'lock-list' },
        h('li', {}, 'Accuracy and speed over time for every drill'),
        h('li', {}, 'A heatmap of the hands you miss most'),
        h('li', {}, 'Your table sessions, bankroll and results'),
        h('li', {}, 'An online rating and a spot on the leaderboards'),
        h('li', {}, 'Your own custom strategies')),
      h('div', { class: 'row' },
        h('a', { class: 'btn primary', href: '#account?mode=signup' }, 'Create a free account'),
        h('a', { class: 'btn', href: '#account' }, 'Sign in')),
      h('p', { class: 'muted small' }, 'Anything you’ve done this visit comes with you when you sign up.')));
}

export function mount(root, ctx) {
  if (!currentUser()) { root.append(locked()); return; }
  let current = 'countdown';
  const draw = () => {
    const s = ctx.stats;
    const overview = MODES.map((m) => {
      if (m.id === 'table' || m.id === 'training') {
        const T = s[m.id];
        return h('button', { class: `tile mini${current === m.id ? ' on' : ''}`, onclick: () => { current = m.id; draw(); } },
          h('div', { class: 'k' }, m.label), h('div', { class: 'v' }, pct(T.correct, T.decisions)), h('div', { class: 'muted' }, `${T.hands} hands`));
      }
      const runs = s[m.id].runs;
      return h('button', { class: `tile mini${current === m.id ? ' on' : ''}`, onclick: () => { current = m.id; draw(); } },
        h('div', { class: 'k' }, m.label),
        h('div', { class: 'v' }, pct(runs.filter((r) => r.ok).length, runs.length)),
        h('div', { class: 'muted' }, runs.length ? `${runs.length} · avg ${secs(avg(runs.map((r) => r.ms)))}` : 'not started'));
    });
    const mode = MODES.find((m) => m.id === current);
    root.replaceChildren(h('section', { class: 'view' },
      head('Stats', 'Pick a mode for its accuracy, speed, error types, and progress over time.'),
      h('div', { class: 'overview' }, overview),
      h('div', { class: 'chart-block' },
        h('div', { class: 'row spread' }, h('h2', {}, mode.label), h('a', { href: mode.link, class: 'btn sm' }, 'Practice →')),
        detail(current, s, ctx.state)),
      h('div', { class: 'row' }, h('button', {
        class: 'btn danger',
        onclick: () => {
          if (!confirm('Reset all drill and table stats? Sessions and bankroll are kept.')) return;
          ctx.resetStats();
          draw();
        },
      }, 'Reset stats'))));
  };
  draw();
}
