// Writes the strategy and index tables in the Learn guides from the trainer's own code
// (public/js/strategy.js), so the guides can never disagree with what the drills grade.
//
//   node scripts/learn-tables.mjs           rewrite the <!-- gen:NAME --> regions
//   node scripts/learn-tables.mjs --check   exit 1 if any region is out of date (CI)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HARD, SOFT, PAIRS, DEVS, DEV_GROUPS, ACTIONS, UPCARDS, upLabel } from '../public/js/strategy.js';

const dir = fileURLToPath(new URL('../public/learn/', import.meta.url));
const check = process.argv.includes('--check');
const signed = (/** @type {number} */ n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
const NAME = { H: 'Hit', S: 'Stand', D: 'Double, or hit if you can’t', Ds: 'Double, or stand if you can’t', P: 'Split' };

/** @param {string} caption @param {[string, string[]][]} rows label → codes for upcards 2..A */
function chart(caption, rows) {
  const head = UPCARDS.map((u) => `<th scope="col">${upLabel(u)}</th>`).join('');
  const body = rows.map(([label, codes]) => `          <tr><th scope="row">${label}</th>${codes
    .map((c, i) => `<td class="${c}" title="${label} vs ${upLabel(UPCARDS[i])}: ${NAME[c]}">${c}</td>`).join('')}</tr>`).join('\n');
  return `<div class="table-wrap">
        <table class="chart">
          <caption class="sr-only">${caption}</caption>
          <thead><tr><th scope="col">You</th>${head}</tr></thead>
          <tbody>
${body}
          </tbody>
        </table>
      </div>`;
}

const hard = chart('Hard totals: your total down the side, dealer upcard across the top',
  Object.entries(HARD).map(([t, r]) => [t === '8' ? '8 or less' : t === '17' ? '17+' : t, r]));
const soft = chart('Soft totals: your hand down the side, dealer upcard across the top',
  Object.entries(SOFT).filter(([t]) => t !== '12').map(([t, r]) => [`A,${Number(t) - 11} (soft ${t})`, r]));
const pairOrder = ['A', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const pairs = chart('Pairs: your pair down the side, dealer upcard across the top',
  pairOrder.map((p) => [p === 'T' ? '10,10' : `${p},${p}`, PAIRS[p]]));

/** @param {(typeof DEVS)[number]} d */
function devRow(d) {
  const vs = d.up === 11 ? 'A' : String(d.up);
  if (d.kind === 'ins') return ['Insurance (dealer shows A)', `Take insurance at ${signed(d.tc)} or higher`, 'Decline'];
  if (d.kind === 'surrender') return [`${d.total} vs ${vs}`, `Surrender at ${signed(d.tc)} or higher`, 'Play the hand normally'];
  if (d.group === 'low') return [`${d.total} vs ${vs}`, `Stand at ${signed(d.tc)} or higher`, `Hit below ${signed(d.tc)}`];
  return [`${d.total} vs ${vs}`, `${ACTIONS[d.at]} at ${signed(d.tc)} or higher`, ACTIONS[d.below]];
}
const devs = Object.entries(DEV_GROUPS).map(([g, title]) => {
  const rows = DEVS.filter((d) => d.group === g).map((d) => {
    const [hand, play, otherwise] = devRow(d);
    return `            <tr><td>${hand}</td><td><strong>${signed(d.tc)}</strong></td><td>${play}</td><td>${otherwise}</td></tr>`;
  }).join('\n');
  return `<h3>${title}</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Hand</th><th>Index</th><th>Index play</th><th>Below the index</th></tr></thead>
          <tbody>
${rows}
          </tbody>
        </table>
      </div>`;
}).join('\n      ');

const REGIONS = {
  'basic-strategy.html': { hard, soft, pairs },
  'deviations.html': { devs },
};

let stale = 0;
for (const [file, regions] of Object.entries(REGIONS)) {
  const path = dir + file;
  const before = readFileSync(path, 'utf8');
  let html = before;
  for (const [name, content] of Object.entries(regions)) {
    const re = new RegExp(`(<!-- gen:${name} -->)[\\s\\S]*?(<!-- /gen:${name} -->)`);
    if (!re.test(html)) throw new Error(`${file}: no <!-- gen:${name} --> region`);
    html = html.replace(re, (_, open, close) => `${open}\n      ${content}\n      ${close}`);
  }
  if (html === before) continue;
  if (check) { console.error(`${file}: tables are out of date. Run: node scripts/learn-tables.mjs`); stale++; }
  else { writeFileSync(path, html); console.log(`${file}: tables written`); }
}
if (stale) process.exit(1);
if (check) console.log('Learn tables match strategy.js');
