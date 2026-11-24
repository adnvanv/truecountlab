// Home: the "ready to play" checklist and a map of every mode.
import { h, money } from '../ui.js';
import { RULES } from '../cards.js';
import { readiness } from '../readiness.js';

const MODES = [
  ['#countdown', '1', 'Countdown', 'One deck to 0 in under 30 seconds.'],
  ['#distraction', '2', 'Distraction', 'The same countdown inside a noisy casino.'],
  ['#truecount', '3', 'True Count', 'Running count ÷ decks from the tray.'],
  ['#basic', '4', 'Basic Strategy', 'Random hands, instant feedback, heatmap.'],
  ['#deviation', '5', 'Deviations', 'Basic play or the index play?'],
  ['#betting', '6', 'Bet Sizing', '$25 / $50 / $75 from the count.'],
  ['#table', '7', 'Table', 'Real sessions: $500 buy-in, stop-loss.'],
  ['#sessions', '8', 'Sessions', 'Simulator and casino results over time.'],
  ['#training', 'T', 'Training Table', 'Play with a cheat panel showing the answers.'],
  ['#calculator', '$', 'Bankroll Calculator', 'Hourly EV, standard deviation, risk of ruin.'],
];

export function mount(root, ctx) {
  const r = readiness(ctx.stats);
  const G = ctx.state;
  root.append(h('section', { class: 'view home' },
    h('div', { class: `ready-card ${r.ready ? 'unlocked' : 'locked'}` },
      h('div', { class: 'ready-head' },
        h('div', { class: 'ready-icon', 'aria-hidden': 'true' }, r.ready ? '✓' : '🔒'),
        h('div', {},
          h('h1', {}, r.ready ? 'Ready to play' : 'Ready-to-play checklist'),
          h('p', { class: 'sub' }, r.ready
            ? 'You’ve cleared every gate. Keep these numbers up, and log your casino sessions in Sessions.'
            : `Locked — ${r.done} of 4 complete. All four must be met at the same time.`))),
      h('ol', { class: 'gates' }, r.items.map((i) => h('li', { class: i.met ? 'met' : '' },
        h('span', { class: 'gate-check', 'aria-label': i.met ? 'complete' : 'incomplete' }, i.met ? '✓' : ''),
        h('div', { class: 'gate-body' },
          h('div', { class: 'gate-label' }, i.label),
          h('div', { class: 'gate-bar' }, h('i', { style: `width:${Math.round(i.frac * 100)}%` })),
          h('div', { class: 'gate-detail muted' }, i.detail)),
        h('a', { class: 'btn sm', href: i.link }, i.met ? 'Keep sharp' : 'Practice'))))),
    h('div', { class: 'home-meta muted' },
      `${RULES.text}. Simulator bankroll ${money(G.bankroll + (G.session?.stack || 0))}${G.session ? ' (session in progress)' : ''}.`),
    h('div', { class: 'mode-grid' }, MODES.map(([href, n, name, desc]) => h('a', { class: 'mode-card', href },
      h('span', { class: 'mode-num' }, n), h('span', { class: 'mode-name' }, name), h('span', { class: 'mode-desc muted' }, desc))))));
}
