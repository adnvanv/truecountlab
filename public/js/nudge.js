// The sign-up nudge: once a guest has finished their first real piece of practice, show
// them their result and offer a free account to keep it. Shown once per browser.
import { h } from './ui.js';
import * as store from './store.js';

const SEEN_KEY = 'tcl.nudged';

// What counts as "finished a first drill" in each mode, and how to describe the result.
/** @type {{ bucket: string, min: number, what: string, hands?: boolean }[]} */
const FIRSTS = [
  { bucket: 'countdown', min: 1, what: 'countdown' },
  { bucket: 'basic', min: 20, what: 'basic strategy hands' },
  { bucket: 'deviation', min: 10, what: 'deviation hands' },
  { bucket: 'training', min: 10, what: 'hands at the training table', hands: true },
  { bucket: 'table', min: 10, what: 'hands at the table', hands: true },
];

function seen() {
  try { return Boolean(localStorage.getItem(SEEN_KEY)); } catch { return true; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* storage unavailable */ }
}

/** @param {Record<string, any>} stats @returns {{ text: string, good: boolean } | null} */
function firstResult(stats) {
  for (const f of FIRSTS) {
    const b = stats[f.bucket];
    if (!b) continue;
    if (f.hands) {
      if ((b.hands || 0) < f.min) continue;
      const p = b.decisions ? Math.round((100 * b.correct) / b.decisions) : null;
      return { text: p == null ? `You played ${b.hands} ${f.what}.` : `You played ${b.hands} ${f.what} and made ${p}% of your decisions right.`, good: p == null || p >= 80 };
    }
    const runs = b.runs || [];
    if (runs.length < f.min) continue;
    const ok = runs.filter((r) => r.ok).length;
    if (f.bucket === 'countdown') {
      const right = runs[runs.length - 1].ok;
      return { text: `You finished your first countdown${right ? ' with the right count' : ''}.`, good: right };
    }
    return { text: `You got ${ok} of ${runs.length} ${f.what} right.`, good: ok / runs.length >= 0.8 };
  }
  return null;
}

let open = false;
export function init() {
  store.onSave(() => {
    if (open || store.currentUser() || seen()) return;
    const result = firstResult(store.activityStats());
    if (!result) return;
    markSeen();
    show(result);
  });
}

/** @param {{ text: string, good: boolean }} result */
function show(result) {
  open = true;
  // While the dialog is up, keys go to it, not to the drill or table behind it.
  const block = (/** @type {KeyboardEvent} */ e) => e.stopPropagation();
  const close = () => { dlg.close(); };
  const dlg = /** @type {HTMLDialogElement} */ (h('dialog', { class: 'nudge', 'aria-labelledby': 'nudge-title' }, h('div', { class: 'nudge-body' },
    h('div', { class: 'nudge-badge', 'aria-hidden': 'true' }, '♠'),
    h('h2', { id: 'nudge-title' }, result.good ? 'Nice work. Want to keep it?' : 'Want to see yourself improve?'),
    h('p', { class: 'nudge-result' }, result.text),
    h('p', { class: 'muted' }, 'As a guest, your progress is gone when you close this tab. A free account keeps it on every device: your accuracy over time, your weak spots, your table sessions and your online rating. You can also build your own strategy.'),
    h('div', { class: 'nudge-actions' },
      h('a', { class: 'btn primary', href: '#account?mode=signup', onclick: close }, 'Create a free account'),
      h('a', { class: 'btn', href: '#account', onclick: close }, 'Sign in'),
      h('button', { class: 'link', type: 'button', onclick: close }, 'Not now')),
    h('p', { class: 'nudge-fine muted' }, 'What you just did comes with you when you sign up.'))));
  dlg.addEventListener('close', () => { open = false; removeEventListener('keydown', block, true); dlg.remove(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); }); // the backdrop (the body fills the box)
  addEventListener('keydown', block, true);
  document.body.append(dlg);
  dlg.showModal();
}
