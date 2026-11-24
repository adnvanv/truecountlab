// Reference charts: basic strategy for the current rules, index plays, count tags.
import { h, signed, head } from '../ui.js';
import { SYSTEMS, KEYS } from '../cards.js';
import { tablesFor, applicableDevs, devIndex, UPCARDS, upLabel, ACTIONS } from '../strategy.js';

function cellText(code, rules) {
  switch (code) {
    case 'Dh': return 'D';
    case 'Ph': return rules.das ? 'P' : 'H';
    case 'Rh': return rules.surrender ? 'Rh' : 'H';
    case 'Rs': return rules.surrender ? 'Rs' : 'S';
    case 'Rp': return rules.surrender ? 'Rp' : 'P';
    default: return code;
  }
}

function grid(title, rows, rules) {
  return h('div', { class: 'chart-block' },
    h('h2', {}, title),
    h('div', { class: 'chart-scroll' },
      h('table', { class: 'chart' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), UPCARDS.map((u) => h('th', {}, upLabel(u))))),
        h('tbody', {}, rows.map(([label, codes]) => h('tr', {},
          h('th', {}, label),
          codes.map((c) => { const t = cellText(c, rules); return h('td', { class: `c-${t[0]}` }, t); })))))));
}

export function mount(root, ctx) {
  const S = ctx.settings;
  const rules = { h17: S.h17, das: S.das, surrender: S.surrender };
  const tb = tablesFor(rules);

  const hard = [['5–8', tb.hard[8]], ...[9, 10, 11, 12, 13, 14, 15, 16, 17].map((n) => [String(n), tb.hard[n]])];
  const soft = [13, 14, 15, 16, 17, 18, 19, 20].map((n) => [`A,${n - 11}`, tb.soft[n]]);
  const pairs = ['A', 'T', '9', '8', '7', '6', '4', '3', '2'].map((k) => [k === 'T' ? '10,10' : `${k},${k}`, tb.pair[k]]);
  pairs.splice(6, 0, ['5,5', tb.hard[10]]);

  const devs = applicableDevs(rules);
  const sys = SYSTEMS[S.system];

  root.append(h('section', { class: 'view' },
    head('Charts', `Basic strategy for ${S.decks} decks, ${S.h17 ? 'dealer hits soft 17' : 'dealer stands on soft 17'}, ${S.das ? 'double after split' : 'no double after split'}${S.surrender ? ', late surrender' : ''}.`),
    h('div', { class: 'legend' },
      [['H', 'Hit'], ['S', 'Stand'], ['D', 'Double, else hit'], ['Ds', 'Double, else stand'], ['P', 'Split'], ['Rh', 'Surrender, else hit']]
        .map(([c, t]) => h('span', {}, h('i', { class: `c-${c[0]}` }, c), t))),
    h('div', { class: 'charts' }, grid('Hard totals', hard, rules), grid('Soft totals', soft, rules), grid('Pairs', pairs, rules)),
    h('div', { class: 'chart-block' },
      h('h2', {}, 'Index plays (Hi-Lo)'),
      h('p', { class: 'muted' }, 'Make the "at" play when the true count is at or above the index; otherwise play basic strategy. Ordered by value — learn from the top.'),
      h('div', { class: 'chart-scroll' }, h('table', { class: 'devs' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Hand'), h('th', {}, 'Index'), h('th', {}, 'At or above'), h('th', {}, 'Below'))),
        h('tbody', {}, devs.map((d) => h('tr', {},
          h('td', {}, d.name),
          h('td', { class: 'mono' }, signed(devIndex(d, rules))),
          h('td', {}, d.kind === 'ins' ? 'Take insurance' : ACTIONS[d.at]),
          h('td', {}, d.kind === 'ins' ? 'Decline' : d.below === 'basic' ? 'Basic strategy' : ACTIONS[d.below]))))))),
    h('div', { class: 'chart-block' },
      h('h2', {}, 'Count systems'),
      h('div', { class: 'chart-scroll' }, h('table', { class: 'tags' },
        h('thead', {}, h('tr', {}, h('th', {}, 'System'), KEYS.map((k) => h('th', {}, k === 'T' ? '10' : k)))),
        h('tbody', {}, Object.entries(SYSTEMS).map(([id, s]) => h('tr', { class: id === S.system ? 'current' : '' },
          h('th', {}, s.name),
          KEYS.map((k) => h('td', { class: `mono ${s.tags[k] > 0 ? 'pos' : s.tags[k] < 0 ? 'neg' : ''}` }, signed(s.tags[k])))))))),
      h('p', { class: 'muted' }, sys.desc))));
}
