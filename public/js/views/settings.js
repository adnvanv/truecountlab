// Settings: counting system, table rules, table behaviour.
import { h, head, field, select, money } from '../ui.js';
import { SYSTEMS, TC_MODES } from '../cards.js';

export function mount(root, ctx) {
  const S = ctx.settings;
  const set = (k, v) => { S[k] = v; ctx.save(); draw(); };
  const bool = (k, yes, no) => select([['1', yes], ['0', no]], S[k] ? '1' : '0', (v) => set(k, v === '1'));
  const num = (k, opts, fmt = String) => select(opts.map((v) => [v, fmt(v)]), S[k], (v) => set(k, Number(v)));

  const draw = () => {
    const sys = SYSTEMS[S.system];
    root.replaceChildren(h('section', { class: 'view settings' },
      head('Settings', 'Changes apply the next time you open a mode. Table changes start a fresh shoe.'),
      h('div', { class: 'panel form' },
        h('h2', {}, 'Counting'),
        field('System', select(Object.entries(SYSTEMS).map(([id, s]) => [id, s.name]), S.system, (v) => set('system', v)), sys.desc),
        field('True count rounding', select(Object.entries(TC_MODES), S.tcMode, (v) => set('tcMode', v))),
        field('Index plays', bool('deviations', 'On (Illustrious 18 + Fab 4)', 'Off — basic strategy only'), S.system === 'hilo' ? null : 'Index plays only apply with Hi-Lo.')),
      h('div', { class: 'panel form' },
        h('h2', {}, 'Table rules'),
        field('Decks', num('decks', [1, 2, 4, 6, 8])),
        field('Penetration', num('penetration', [50, 60, 65, 70, 75, 80, 85, 90], (v) => `${v}% dealt before shuffle`)),
        field('Soft 17', bool('h17', 'Dealer hits soft 17 (H17)', 'Dealer stands on soft 17 (S17)')),
        field('Double after split', bool('das', 'Allowed', 'Not allowed')),
        field('Late surrender', bool('surrender', 'Allowed', 'Not allowed'))),
      h('div', { class: 'panel form' },
        h('h2', {}, 'At the table'),
        field('Other players', num('others', [0, 1, 2, 3, 4, 5]), 'They play basic strategy — more cards to count.'),
        field('Deal speed', num('dealSpeed', [150, 250, 380, 500, 700, 1000], (v) => `${v} ms per card`)),
        field('Count checks', select([['random', 'Random (~30% of hands)'], ['every', 'Every hand'], ['shoe', 'End of each shoe'], ['off', 'Off']], S.countCheck, (v) => set('countCheck', v))),
        field('Show count', bool('showCount', 'Always visible (learning)', 'Hidden — use Peek')),
        field('Bet ramp feedback', bool('betHints', 'On', 'Off'), 'Ramp: 1 unit up to TC +1, then (TC − 1) units, capped at the spread.'),
        field('Betting unit', num('unit', [5, 10, 25, 50, 100], money)),
        field('Max spread', num('spread', [4, 6, 8, 10, 12, 16], (v) => `1–${v} units`)),
        field('Starting bankroll', num('bankroll', [500, 1000, 2000, 5000, 10000], money)),
        h('div', { class: 'row' }, h('button', {
          class: 'btn',
          onclick: () => { ctx.stats.table.bankroll = S.bankroll; ctx.save(); draw(); },
        }, `Reset bankroll to ${money(S.bankroll)}`),
        h('span', { class: 'muted' }, `Current: ${money(ctx.stats.table.bankroll ?? S.bankroll)}`)))));
  };
  draw();
}
