// Home: where to start (a four-step path), practice versus the scored modes, and the
// ready-to-play checklist.
import { h, money, strategyTag } from '../ui.js';
import { RULES } from '../cards.js';
import { readiness } from '../readiness.js';
import { currentUser } from '../store.js';

const PRACTICE = [
  ['#training', 'Training Table', 'Full shoes with a cheat panel showing the count and the right play. Spend most of your time here.', true],
  ['#countdown', 'Countdown', 'Flash through cards, then name the running count.'],
  ['#basic', 'Basic Strategy', 'Random hands, instant feedback, a heatmap of your misses.'],
  ['#deviation', 'Deviations', 'Basic play or the index play, at a given count?'],
  ['/learn', 'Learn guides', 'How counting works, step by step, from Hi-Lo to index plays.'],
];
const TEST = [
  ['#table', 'Table', 'Buy in from your bankroll, stop-loss at the buy-in, every session on your record. No cheat panel.'],
  ['#play', 'Online', 'Count battles for a rating, and shared tables graded on your strategy. Leaderboards.'],
];
const TOOLS = [
  ['#chart', 'Strategy', 'Pick a premade strategy or build your own, and see its edge.'],
  ['#sessions', 'Sessions', 'Your table and casino results over time.'],
  ['#stats', 'Stats', 'All-time accuracy, speed and weak spots.'],
  ['#calculator', 'Bankroll Calculator', 'Hourly EV, standard deviation, risk of ruin.'],
];

const grid = (items) => h('div', { class: 'mode-grid' }, items.map(([href, name, desc, star]) => h('a', { class: `mode-card${star ? ' star' : ''}`, href },
  h('span', { class: 'mode-name' }, name, star ? h('span', { class: 'pill basic' }, 'Start here daily') : null), h('span', { class: 'mode-desc muted' }, desc))));

/** The beginner path: each step is done once there's a little evidence of it. @param {any} stats */
function path(stats) {
  const basic = stats.basic.runs;
  const basicAcc = basic.length ? basic.filter((r) => r.ok).length / basic.length : 0;
  const counted = stats.countdown.runs.filter((r) => r.ok).length;
  const steps = [
    { href: '/learn', title: 'Learn how counting works', desc: 'Five short guides: the Hi-Lo values, the true count, basic strategy, index plays.', done: basic.length > 0 || counted > 0, cta: 'Read the guides' },
    { href: '#basic', title: 'Learn basic strategy', desc: 'Counting only pays if every other decision is already right. Aim for 90%+.', done: basic.length >= 50 && basicAcc >= 0.9, cta: 'Practice basic strategy', progress: basic.length ? `${Math.round(basicAcc * 100)}% over ${basic.length} hands` : null },
    { href: '#countdown', title: 'Keep the running count', desc: 'Flash through cards and name the count. Accuracy first, then speed.', done: counted >= 5, cta: 'Start a countdown', progress: counted ? `${Math.min(counted, 5)} of 5 right` : null },
    { href: '#training', title: 'Put it together at the Training Table', desc: 'Play full shoes with the answers on screen, then turn them off.', done: stats.training.hands >= 100, cta: 'Open the Training Table', progress: stats.training.hands ? `${Math.min(stats.training.hands, 100)} of 100 hands` : null },
  ];
  const next = steps.findIndex((s) => !s.done);
  return h('ol', { class: 'path' }, steps.map((s, i) => h('li', { class: `path-step${s.done ? ' done' : ''}${i === next ? ' next' : ''}` },
    h('span', { class: 'path-num', 'aria-hidden': 'true' }, s.done ? '✓' : String(i + 1)),
    h('div', { class: 'path-body' },
      h('div', { class: 'path-title' }, s.title),
      h('div', { class: 'muted small' }, s.desc),
      s.progress && !s.done ? h('div', { class: 'path-progress' }, s.progress) : null),
    h('a', { class: `btn sm${i === next ? ' primary' : ''}`, href: s.href }, s.done ? 'Again' : s.cta))));
}

export function mount(root, ctx) {
  const r = readiness(ctx.stats);
  const G = ctx.state;
  root.append(h('section', { class: 'view home' },
    currentUser() ? null : h('div', { class: 'guest-banner' },
      h('span', {}, "You're playing as a guest, so nothing you do is kept after you close this tab. Create a free account to save your progress and track it over time."),
      h('a', { class: 'btn primary sm', href: '#account?mode=signup' }, 'Create account'),
      h('a', { class: 'link', href: '#account' }, 'Sign in')),
    h('header', { class: 'view-head' },
      h('h1', {}, 'Learn to count cards, then prove it'),
      h('p', { class: 'sub' }, 'Practice until you’re accurate, then test yourself at the Table and online, where every result goes on your record.')),
    h('h2', { class: 'home-h' }, 'Start here'),
    path(ctx.stats),
    h('h2', { class: 'home-h' }, 'Practice', h('span', { class: 'muted small' }, ' · accuracy shown for this session')),
    grid(PRACTICE),
    h('h2', { class: 'home-h' }, 'Test yourself', h('span', { class: 'muted small' }, ' · scored, all-time stats')),
    h('p', { class: 'muted small home-note' }, 'These are the ranked side: real buy-ins and a stop-loss at the Table, ratings and leaderboards online. Come here once the Training Table feels easy.'),
    grid(TEST),
    h('div', { class: `ready-card ${r.ready ? 'unlocked' : 'locked'}` },
      h('div', { class: 'ready-head' },
        h('div', { class: 'ready-icon', 'aria-hidden': 'true' }, r.ready ? '✓' : '🔒'),
        h('div', {},
          h('h2', {}, r.ready ? 'Ready for a real casino' : 'Ready for a real casino?'),
          h('p', { class: 'sub' }, r.ready
            ? 'You’ve cleared every gate. Keep these numbers up, and log your casino sessions in Sessions.'
            : `${r.done} of ${r.items.length} complete. All of them must be met at the same time.`))),
      h('ol', { class: 'gates' }, r.items.map((i) => h('li', { class: i.met ? 'met' : '' },
        h('span', { class: 'gate-check', 'aria-label': i.met ? 'complete' : 'incomplete' }, i.met ? '✓' : ''),
        h('div', { class: 'gate-body' },
          h('div', { class: 'gate-label' }, i.label),
          h('div', { class: 'gate-bar' }, h('i', { style: `width:${Math.round(i.frac * 100)}%` })),
          h('div', { class: 'gate-detail muted' }, i.detail)),
        h('a', { class: 'btn sm', href: i.link }, i.met ? 'Keep sharp' : 'Practice'))))),
    h('h2', { class: 'home-h' }, 'Tools'),
    grid(TOOLS),
    h('div', { class: 'home-meta muted' },
      `${RULES.text}. Simulator bankroll ${money(G.bankroll + (G.session?.stack || 0))}${G.session ? ' (session in progress)' : ''}. `, strategyTag(ctx.strategy))));
}
