// Reference: the full strategy you're training.
import { h, signed, head, money } from '../ui.js';
import { RULES } from '../cards.js';
import { HARD, SOFT, PAIRS, DEVS, UPCARDS, upLabel, ACTIONS } from '../strategy.js';

function grid(title, rows) {
  return h('div', { class: 'chart-block' },
    h('h2', {}, title),
    h('div', { class: 'chart-scroll' }, h('table', { class: 'chart' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), UPCARDS.map((u) => h('th', {}, upLabel(u))))),
      h('tbody', {}, rows.map(([label, codes]) => h('tr', {}, h('th', {}, label), codes.map((c) => h('td', { class: `c-${c[0]}` }, c))))))));
}

export function mount(root) {
  const hard = [['5–8', HARD[8]], ...[9, 10, 11, 12, 13, 14, 15, 16].map((n) => [String(n), HARD[n]]), ['17+', HARD[17]]];
  const soft = [13, 14, 15, 16, 17, 18, 19, 20].map((n) => [`A,${n - 11}`, SOFT[n]]);
  const pairs = ['A', 'T', '9', '8', '7', '6', '5', '4', '3', '2'].map((k) => [k === 'T' ? '10,10' : `${k},${k}`, PAIRS[k]]);

  root.append(h('section', { class: 'view' },
    head('The Strategy', RULES.text),
    h('div', { class: 'tiles' },
      h('div', { class: 'tile' }, h('h2', {}, 'Count: Hi-Lo'),
        h('table', { class: 'tags' }, h('tbody', {},
          h('tr', {}, h('th', {}, '2 3 4 5 6'), h('td', { class: 'mono pos' }, '+1')),
          h('tr', {}, h('th', {}, '7 8 9'), h('td', { class: 'mono' }, '0')),
          h('tr', {}, h('th', {}, '10 J Q K A'), h('td', { class: 'mono neg' }, '−1'))))),
      h('div', { class: 'tile' }, h('h2', {}, 'True count'),
        h('ol', { class: 'steps' },
          h('li', {}, 'Estimate decks remaining from the discard tray (6 − decks in the tray).'),
          h('li', {}, 'Round that to the nearest half deck.'),
          h('li', {}, 'Divide the running count by it and round down (+2.8 → +2, −0.4 → −1).'))),
      h('div', { class: 'tile' }, h('h2', {}, 'Bet ramp'),
        h('table', { class: 'tags' }, h('tbody', {},
          h('tr', {}, h('th', {}, 'TC +1 or lower'), h('td', { class: 'mono' }, money(25))),
          h('tr', {}, h('th', {}, 'TC +2 to +3'), h('td', { class: 'mono' }, money(50))),
          h('tr', {}, h('th', {}, 'TC +4 or higher'), h('td', { class: 'mono' }, money(75))))),
        h('p', { class: 'muted' }, `Bankroll ${money(RULES.bankroll)} · ${money(RULES.buyIn)} session buy-in · stop-loss at the buy-in.`))),
    h('div', { class: 'legend' },
      [['H', 'Hit'], ['S', 'Stand'], ['D', 'Double, else hit'], ['Ds', 'Double, else stand'], ['P', 'Split']]
        .map(([c, t]) => h('span', {}, h('i', { class: `c-${c[0]}` }, c), t))),
    h('div', { class: 'charts' }, grid('Hard totals', hard), grid('Soft totals', soft), grid('Pairs', pairs)),
    h('div', { class: 'chart-block' },
      h('h2', {}, 'Count deviations'),
      h('p', { class: 'muted' }, 'At or above the index, make the deviation play. Below it, use basic strategy.'),
      h('div', { class: 'chart-scroll' }, h('table', { class: 'devs' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Hand'), h('th', {}, 'Index'), h('th', {}, 'At or above'), h('th', {}, 'Below'))),
        h('tbody', {}, DEVS.map((d) => h('tr', {},
          h('td', {}, d.name), h('td', { class: 'mono' }, signed(d.tc)),
          h('td', {}, d.id === 'ins' ? 'Take insurance' : ACTIONS[d.at]),
          h('td', {}, d.id === 'ins' ? 'Decline' : ACTIONS[d.below])))))))));
}
