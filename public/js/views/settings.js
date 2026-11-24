// Settings: the rules are fixed by design; only table pacing and data are adjustable.
import { h, head, field, select, money } from '../ui.js';
import { RULES } from '../cards.js';

export function mount(root, ctx) {
  const S = ctx.settings;
  const set = (k, v) => { S[k] = v; ctx.save(); draw(); };
  const draw = () => {
    root.replaceChildren(h('section', { class: 'view settings' },
      head('Settings', `Rules are fixed: ${RULES.text}.`),
      h('div', { class: 'panel form' },
        h('h2', {}, 'Table simulation'),
        field('Other players', select([0, 1, 2, 3, 4, 5].map((v) => [v, String(v)]), S.others, (v) => set('others', Number(v))), 'They play basic strategy, so there are more cards to count.'),
        field('Deal speed', select([150, 250, 380, 500, 700, 1000].map((v) => [v, `${v} ms per card`]), S.dealSpeed, (v) => set('dealSpeed', Number(v)))),
        field('Count checks', select([['random', 'Random (~30% of hands)'], ['every', 'Every hand'], ['shoe', 'End of each shoe'], ['off', 'Off']], S.countCheck, (v) => set('countCheck', v))),
        field('Late surrender', select([['0', 'Off (default)'], ['1', 'On — count-based surrender']], S.surrender ? '1' : '0', (v) => set('surrender', v === '1')), 'Adds the Surrender button at the table and four surrender deviations: 15v10 at 0+, 14v10 at +3+, 15v9 at +2+, 15vA at +1+.'),
        field('Count display', select([['0', 'Hidden (reveal with C)'], ['1', 'Visible']], S.showCount ? '1' : '0', (v) => set('showCount', v === '1')))),
      h('div', { class: 'panel form' },
        h('h2', {}, 'Data'),
        h('p', { class: 'muted' }, 'Progress is saved in this browser and synced to the Optiplex, so your phone and PC share it.'),
        h('div', { class: 'row' },
          h('button', {
            class: 'btn',
            onclick: () => {
              if (ctx.state.session) { alert('Cash out of the current table session first.'); return; }
              if (!confirm(`Reset the simulator bankroll to ${money(RULES.bankroll)}?`)) return;
              ctx.state.bankroll = RULES.bankroll;
              ctx.save();
              draw();
            },
          }, `Reset simulator bankroll (now ${money(ctx.state.bankroll)})`),
          h('button', {
            class: 'btn',
            onclick: () => {
              const blob = new Blob([JSON.stringify(ctx.state, null, 2)], { type: 'application/json' });
              const a = h('a', { href: URL.createObjectURL(blob), download: `count-trainer-${new Date().toISOString().slice(0, 10)}.json` });
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            },
          }, 'Export data (JSON)')))));
  };
  draw();
}
