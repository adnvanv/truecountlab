import * as store from './store.js';
import * as countdown from './views/countdown.js';
import * as basic from './views/basic.js';
import * as deviation from './views/deviation.js';
import * as table from './views/table.js';
import * as sessions from './views/sessions.js';
import * as stats from './views/stats.js';
import * as chart from './views/chart.js';
import * as settings from './views/settings.js';
import * as home from './views/home.js';
import * as calculator from './views/calculator.js';
import * as accountView from './views/account.js';
import * as play from './views/play.js';
import { h } from './ui.js';
import { configure as configureSound, loadSamples } from './sfx.js';
import { init as initNudge } from './nudge.js';

// Practice first (where new players should spend their time), then the scored modes,
// then the strategy; everything else lives under More.
const VIEWS = [
  { id: 'home', label: 'Home', mount: home.mount },
  { id: 'training', label: 'Training', mount: (r, c) => table.mount(r, c, { training: true }) },
  { id: 'countdown', label: 'Countdown', mount: countdown.mount },
  { id: 'basic', label: 'Basic Strategy', mount: basic.mount },
  { id: 'deviation', label: 'Deviations', mount: deviation.mount },
  { id: 'table', label: 'Table', mount: table.mount },
  { id: 'play', label: 'Online', mount: play.mount },
  { id: 'chart', label: 'Strategy', mount: chart.mount },
  { id: 'sessions', label: 'Sessions', mount: sessions.mount, more: true },
  { id: 'stats', label: 'Stats', mount: stats.mount, more: true },
  { id: 'calculator', label: 'Bankroll Calc', mount: calculator.mount, more: true },
  { id: 'settings', label: 'Settings', mount: settings.mount, more: true },
  { id: 'account', label: 'Account', mount: accountView.mount, hidden: true },
  { id: 'reset', label: 'Reset password', mount: accountView.mount, hidden: true },
];

// One line the first time someone opens a mode: what it's for and how to drive it.
const TIPS = {
  training: 'Spend most of your time here. The cheat panel (X) shows the running count, the true count, the bet and the right play; turn it off once you’re keeping up. Keys: Space deals, H S D P play. Accuracy here is for this session only.',
  countdown: 'Cards flash one at a time. Add up their count values (Hi-Lo: 2–6 are +1, tens and aces −1, 7–9 zero) and type the total at the end. Start slow; the goal is a whole deck in 30 seconds.',
  basic: 'Pick the right play for each hand: buttons or keys H, S, D, P. Get one wrong and you’ll see the right play. The heatmap shows which hands you miss.',
  deviation: 'Each hand comes with a count. Decide whether to stick with basic strategy or make the index play. Learn basic strategy first; this builds on it.',
  table: 'This is the test, not practice: real buy-ins from your bankroll, a stop-loss, no cheat panel, and every session goes on your record. Practice at the Training table until you’re accurate.',
  play: 'The competitive side: race other players in count battles for a rating, or sit at a shared table and get graded on your own strategy. Your all-time online stats and leaderboard spot need an account.',
  chart: 'Every mode grades you against the strategy you use. Copy any strategy to change a play, a count value, an index or the bet ramp, and see what it does to your edge.',
};

const state = await store.init();
initNudge();
configureSound(state.settings.sound);
loadSamples();
const ctx = {
  get settings() { return state.settings; },
  get stats() { return state.stats; },
  get state() { return state; },
  get strategy() { return store.activeStrategy(); },
  save: store.save,
  resetStats: store.resetStats,
};

const nav = document.getElementById('nav');
const view = document.getElementById('view');
const navLink = (v) => h('a', { href: `#${v.id}`, 'data-id': v.id }, v.label);
const navMore = /** @type {HTMLDetailsElement} */ (h('details', { class: 'nav-more' },
  h('summary', {}, 'More'),
  h('div', { class: 'nav-more-menu' }, h('a', { href: '/learn' }, 'Learn guides'), ...VIEWS.filter((v) => v.more).map(navLink))));
nav.append(...VIEWS.filter((v) => !v.hidden && !v.more).map(navLink), navMore);
addEventListener('click', (e) => { if (navMore.open && !navMore.contains(/** @type {Node} */ (e.target))) navMore.open = false; });

// ---- phone navigation: bottom tab bar + bottom sheets ---------------------
const DRILLS = [
  ['countdown', '1', 'Countdown', '15–20 cards, then the count'],
  ['basic', '2', 'Basic Strategy', 'Hands vs upcards + heatmap'],
  ['deviation', '3', 'Deviations', 'Basic or the index play?'],
  ['/learn', '?', 'Learn guides', 'How counting works, step by step'],
];
const MORE = [
  ['sessions', '▦', 'Sessions', 'Log and charts'],
  ['stats', '▤', 'Stats', 'Accuracy, speed, errors'],
  ['calculator', '$', 'Bankroll Calc', 'EV, SD, risk of ruin'],
  ['chart', '♠', 'Strategy', 'Charts and deviations'],
  ['settings', '⚙', 'Settings', 'Table, sound, data'],
  ['account', '👤', 'Account', 'Sign in and sync your progress'],
];
const TABS = [
  { id: 'home', icon: '⌂', label: 'Home', views: ['home'] },
  { id: 'training', icon: '👁', label: 'Training', views: ['training'] },
  { id: 'drills', icon: '◎', label: 'Drills', views: DRILLS.map((d) => d[0]), sheet: DRILLS },
  { id: 'table', icon: '♠', label: 'Table', views: ['table'] },
  { id: 'play', icon: '⚔', label: 'Online', views: ['play'] },
  { id: 'more', icon: '☰', label: 'More', views: MORE.map((d) => d[0]), sheet: MORE },
];
const sheet = h('div', { class: 'sheet', 'aria-hidden': 'true', onclick: (e) => { if (e.target === sheet) closeSheet(); } }, h('div', { class: 'sheet-panel', role: 'dialog' }));
function openSheet(title, items) {
  sheet.firstChild.replaceChildren(
    h('div', { class: 'sheet-grab', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-title' }, title),
    h('div', { class: 'sheet-list' }, items.map(([id, n, label, desc]) => h('a', { href: id.startsWith('/') ? id : `#${id}`, class: 'sheet-item', onclick: closeSheet },
      h('span', { class: 'mode-num' }, n), h('span', { class: 'sheet-text' }, h('span', { class: 'mode-name' }, label), h('span', { class: 'mode-desc muted' }, desc))))));
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
}
function closeSheet() { sheet.classList.remove('open'); sheet.setAttribute('aria-hidden', 'true'); }
const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Sections' }, TABS.map((t) => t.sheet
  ? h('button', { class: 'tab', 'data-tab': t.id, onclick: () => openSheet(t.label, t.sheet) }, h('span', { class: 'tab-icon' }, t.icon), h('span', {}, t.label))
  : h('a', { class: 'tab', 'data-tab': t.id, href: `#${t.id}` }, h('span', { class: 'tab-icon' }, t.icon), h('span', {}, t.label))));
document.body.append(tabbar, sheet);
const pageTitle = h('div', { class: 'page-title' });
const topbar = /** @type {HTMLElement} */ (document.querySelector('.topbar'));
// Account button: "Sign in" for guests, your initial and name when signed in.
const acct = h('a', { class: 'acct-chip', href: '#account' });
function drawAcct() {
  const u = store.currentUser();
  acct.classList.toggle('signed-in', Boolean(u));
  acct.title = u ? `Signed in as ${u.displayName}` : 'Sign in to save your progress to an account';
  acct.replaceChildren(...(u
    ? [h('span', { class: 'avatar', 'aria-hidden': 'true' }, u.displayName.slice(0, 1).toUpperCase()), h('span', { class: 'acct-name' }, u.displayName)]
    : [h('span', { class: 'acct-name' }, 'Sign in')]));
}
drawAcct();
topbar.append(pageTitle, acct);
// The table fills exactly the window under the top bar, so it needs the bar's real height.
const syncTopbar = () => document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`);
new ResizeObserver(syncTopbar).observe(topbar);
syncTopbar();

let unmount = null;
const HOME_TITLE = document.title;
function route() {
  const id = location.hash.slice(1).split('?')[0];
  const v = VIEWS.find((x) => x.id === id) || VIEWS[0];
  if (typeof unmount === 'function') unmount();
  closeSheet();
  view.replaceChildren();
  document.body.dataset.view = v.id;
  pageTitle.textContent = v.label;
  for (const t of tabbar.children) t.classList.toggle('active', TABS.find((x) => x.id === t.dataset.tab).views.includes(v.id));
  for (const a of /** @type {NodeListOf<HTMLElement>} */ (nav.querySelectorAll('a[data-id]'))) a.classList.toggle('active', a.dataset.id === v.id);
  navMore.classList.toggle('active', Boolean(v.more));
  navMore.open = false;
  // Home keeps the page's own title (the one search results show); other views name themselves.
  document.title = v.id === 'home' ? HOME_TITLE : `${v.label} · TrueCountLab`;
  unmount = v.mount(view, ctx);
  showTip(v.id);
  window.scrollTo(0, 0);
}

function showTip(id) {
  const text = TIPS[id];
  const seen = state.settings.tips;
  if (!text || seen[id]) return;
  const tip = h('div', { class: 'tip', role: 'note' },
    h('span', { class: 'tip-icon', 'aria-hidden': 'true' }, '💡'), h('span', { class: 'tip-text' }, text),
    h('button', { class: 'btn sm', onclick: () => { seen[id] = true; ctx.save(); tip.remove(); } }, 'Got it'));
  // The tables are a fixed grid: their tip goes at the top of the side column.
  const host = view.querySelector('.table-view .side') || view.querySelector('section') || view;
  host.prepend(tip);
}
addEventListener('hashchange', route);

// Signing in or out swaps in a different saved-progress document, so remount the page.
let lastUserId = store.currentUser()?.id ?? null;
store.onChange((u) => {
  drawAcct();
  configureSound(state.settings.sound);
  const id = u?.id ?? null;
  if (id !== lastUserId) { lastUserId = id; route(); }
});
route();
