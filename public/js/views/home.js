// Home: the "ready to play" checklist and a map of every mode.
import { h, money } from '../ui.js';
import { RULES } from '../cards.js';
import { readiness } from '../readiness.js';
import { currentUser } from '../store.js';

const MODES = [
  ['/learn', 'Learn to Count', 'New to counting? Step-by-step guides, from Hi-Lo to index plays.'],
  ['#countdown', 'Countdown', '15–20 cards, then name the count.'],
  ['#basic', 'Basic Strategy', 'Random hands, instant feedback, heatmap.'],
  ['#deviation', 'Deviations', 'Basic play or the index play?'],
  ['#table', 'Table', 'Real sessions: $500 buy-in, stop-loss.'],
  ['#play', 'Play Online', 'Count battles and shared tables with other players.'],
  ['#sessions', 'Sessions', 'Simulator and casino results over time.'],
  ['#training', 'Training Table', 'Play with a cheat panel showing the answers.'],
  ['#calculator', 'Bankroll Calculator', 'Hourly EV, standard deviation, risk of ruin.'],
];

export function mount(root, ctx) {
  const r = readiness(ctx.stats);
  const G = ctx.state;
  root.append(h('section', { class: 'view home' },
    currentUser() ? null : h('div', { class: 'guest-banner' },
      h('span', {}, "You're playing as a guest, so nothing you do is kept after you close this tab. Create a free account to save your progress and track it over time."),
      h('a', { class: 'btn primary sm', href: '#account?mode=signup' }, 'Create account'),
      h('a', { class: 'link', href: '#account' }, 'Sign in')),
    h('div', { class: `ready-card ${r.ready ? 'unlocked' : 'locked'}` },
      h('div', { class: 'ready-head' },
        h('div', { class: 'ready-icon', 'aria-hidden': 'true' }, r.ready ? '✓' : '🔒'),
        h('div', {},
          h('h1', {}, r.ready ? 'Ready to play' : 'Ready-to-play checklist'),
          h('p', { class: 'sub' }, r.ready
            ? 'You’ve cleared every gate. Keep these numbers up, and log your casino sessions in Sessions.'
            : `Locked — ${r.done} of ${r.items.length} complete. All of them must be met at the same time.`))),
      h('ol', { class: 'gates' }, r.items.map((i) => h('li', { class: i.met ? 'met' : '' },
        h('span', { class: 'gate-check', 'aria-label': i.met ? 'complete' : 'incomplete' }, i.met ? '✓' : ''),
        h('div', { class: 'gate-body' },
          h('div', { class: 'gate-label' }, i.label),
          h('div', { class: 'gate-bar' }, h('i', { style: `width:${Math.round(i.frac * 100)}%` })),
          h('div', { class: 'gate-detail muted' }, i.detail)),
        h('a', { class: 'btn sm', href: i.link }, i.met ? 'Keep sharp' : 'Practice'))))),
    h('div', { class: 'home-meta muted' },
      `${RULES.text}. Simulator bankroll ${money(G.bankroll + (G.session?.stack || 0))}${G.session ? ' (session in progress)' : ''}.`),
    h('div', { class: 'mode-grid' }, MODES.map(([href, name, desc]) => h('a', { class: 'mode-card', href },
      h('span', { class: 'mode-name' }, name), h('span', { class: 'mode-desc muted' }, desc))))));
}
