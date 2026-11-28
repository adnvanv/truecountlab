// Settings: the rules are fixed by design; table pacing, money, sound and data are yours.
// (Your strategy, including the bet ramp, is on the Strategy page.)
import { h, head, field, select, money } from '../ui.js';
import { RULES } from '../cards.js';
import { sfx, configure as configureSound, sampleStatus } from '../sfx.js';
import { syncing } from '../store.js';

export function mount(root, ctx) {
  const S = ctx.settings;
  const set = (k, v) => { S[k] = v; ctx.save(); draw(); };
  const M = S.money;
  const draw = () => {
    root.replaceChildren(h('section', { class: 'view settings' },
      head('Settings', `Rules are fixed: ${RULES.text}. Your strategy and bet ramp are on the `, h('a', { href: '#chart' }, 'Strategy page'), '.'),
      h('div', { class: 'panel form' },
        h('h2', {}, 'Table simulation'),
        field('Other players', select([0, 1, 2, 3, 4, 5].map((v) => [v, String(v)]), S.others, (v) => set('others', Number(v))), 'They play basic strategy, so there are more cards to count.'),
        field('Deal speed', select([150, 250, 380, 500, 700, 1000].map((v) => [v, `${v} ms per card`]), S.dealSpeed, (v) => set('dealSpeed', Number(v)))),
        field('Count checks', select([['random', 'Random (~30% of hands)'], ['every', 'Every hand'], ['shoe', 'End of each shoe'], ['off', 'Off']], S.countCheck, (v) => set('countCheck', v))),
        field('Late surrender', select([['0', 'Off (default)'], ['1', 'On — count-based surrender']], S.surrender ? '1' : '0', (v) => set('surrender', v === '1')), 'Adds the Surrender button at the table and four surrender deviations: 15v10 at 0+, 14v10 at +3+, 15v9 at +2+, 15vA at +1+.'),
        field('Count display', select([['0', 'Hidden (reveal with C)'], ['1', 'Visible']], S.showCount ? '1' : '0', (v) => set('showCount', v === '1')))),
      h('div', { class: 'panel form' },
        h('h2', {}, 'Money'),
        field('Table bankroll', select([1000, 3000, 5000, 10000, 25000, 100000].map((v) => [v, money(v)]), M.bankroll, (v) => { M.bankroll = Number(v); ctx.save(); draw(); }),
          'What your Table bankroll starts at, and what it resets to if you go broke. Changing it doesn’t touch your current bankroll.'),
        field('Table buy-in', select([100, 250, 500, 1000, 2500, 5000].map((v) => [v, money(v)]), M.buyIn, (v) => { M.buyIn = Number(v); ctx.save(); draw(); }),
          'Each Table session buys in for this much, and stops when it’s all lost.'),
        field('Training chips', select([1000, 5000, 10000, 50000].map((v) => [v, money(v)]), M.practice, (v) => { M.practice = Number(v); ctx.save(); draw(); }),
          'Practice chips at the Training Table. They top up by themselves, and nothing is risked.'),
        h('p', { class: 'muted' }, `Online, the host picks a shared table’s buy-in when they open it.`)),
      h('div', { class: 'panel form' },
        h('h2', {}, 'Sound'),
        field('Sound effects', select([['1', 'On'], ['0', 'Off']], S.sound.on ? '1' : '0', (v) => { S.sound.on = v === '1'; configureSound(S.sound); ctx.save(); if (S.sound.on) sfx.chip(2); draw(); }), `Dealing, shuffling, chips, results, and right/wrong chimes in the drills. The table also has a 🔊 button. Recorded sounds: ${sampleStatus().clips ? `${sampleStatus().clips} clips loaded (Kenney Casino Audio, CC0)` : 'load after your first tap'}.`),
        field('Volume', h('input', {
          type: 'range', min: 0.05, max: 1, step: 0.05, value: S.sound.volume,
          oninput: (e) => { S.sound.volume = Number(e.target.value); configureSound(S.sound); },
          onchange: () => { ctx.save(); sfx.deal(); },
        }))),
      h('div', { class: 'panel form' },
        h('h2', {}, 'Data'),
        h('p', { class: 'muted' }, syncing() ? 'Progress saves to your account, so it follows you to every device you sign in on. ' : 'As a guest, your progress lasts until you close this tab. ', h('a', { href: '#account' }, syncing() ? 'Manage your account' : 'Create a free account to keep it'), '.'),
        h('div', { class: 'row' },
          h('button', {
            class: 'btn',
            onclick: () => {
              if (ctx.state.session) { alert('Cash out of the current table session first.'); return; }
              if (!confirm(`Start your Table bankroll over at ${money(M.bankroll)}? Resets stay on your record (${ctx.state.busts || 0} so far).`)) return;
              ctx.state.bankroll = M.bankroll;
              ctx.state.busts = (ctx.state.busts || 0) + 1;
              ctx.save();
              draw();
            },
          }, `Reset Table bankroll (now ${money(ctx.state.bankroll)})`),
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
