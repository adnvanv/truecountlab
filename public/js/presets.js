// Count systems and the index plays the premade strategies use. Shared by the browser,
// the server and scripts/compute-indexes.mjs (which derives the indexes for every count).

/**
 * @typedef {object} CountSystem
 * @property {string} name
 * @property {Record<string, number>} values tag per rank key: '2'…'9', 'T' (any ten), 'A'
 * @property {'true' | 'running'} kind balanced counts convert to a true count; unbalanced
 *   ones (KO) bet and deviate on the running count itself
 * @property {number} [irc] running count at the start of a shoe (unbalanced counts)
 */

/** @type {Record<string, CountSystem>} */
export const COUNTS = {
  hilo: { name: 'Hi-Lo', kind: 'true', values: { 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 0, 8: 0, 9: 0, T: -1, A: -1 } },
  ko: { name: 'KO (Knock-Out)', kind: 'running', irc: -20, values: { 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 0, 9: 0, T: -1, A: -1 } },
  hiopt2: { name: 'Hi-Opt II', kind: 'true', values: { 2: 1, 3: 1, 4: 2, 5: 2, 6: 1, 7: 1, 8: 0, 9: 0, T: -2, A: 0 } },
  omega2: { name: 'Omega II', kind: 'true', values: { 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 1, 8: 0, 9: -1, T: -2, A: 0 } },
};

/**
 * The index plays the premade strategies are built from: Schlesinger's Illustrious 18,
 * the Fab 4 surrenders, and the extra doubles the default strategy uses. `cards` is the
 * two-card hand the index is computed for; `at` is the play at or above the index.
 * @type {{ id: string, kind: 'ins' | 'play' | 'surrender', cards: string[], up: number, at: string, below: string }[]}
 */
export const INDEX_PLAYS = [
  { id: 'ins', kind: 'ins', cards: ['T', '9'], up: 11, at: 'Y', below: 'N' },
  { id: '16v10', kind: 'play', cards: ['T', '6'], up: 10, at: 'S', below: 'H' },
  { id: '15v10', kind: 'play', cards: ['T', '5'], up: 10, at: 'S', below: 'H' },
  { id: 'TTv5', kind: 'play', cards: ['T', 'T'], up: 5, at: 'P', below: 'S' },
  { id: 'TTv6', kind: 'play', cards: ['T', 'T'], up: 6, at: 'P', below: 'S' },
  { id: '10v10', kind: 'play', cards: ['6', '4'], up: 10, at: 'D', below: 'H' },
  { id: '12v3', kind: 'play', cards: ['T', '2'], up: 3, at: 'S', below: 'H' },
  { id: '12v2', kind: 'play', cards: ['T', '2'], up: 2, at: 'S', below: 'H' },
  { id: '11vA', kind: 'play', cards: ['6', '5'], up: 11, at: 'D', below: 'H' },
  { id: '9v2', kind: 'play', cards: ['5', '4'], up: 2, at: 'D', below: 'H' },
  { id: '10vA', kind: 'play', cards: ['6', '4'], up: 11, at: 'D', below: 'H' },
  { id: '9v7', kind: 'play', cards: ['5', '4'], up: 7, at: 'D', below: 'H' },
  { id: '16v9', kind: 'play', cards: ['T', '6'], up: 9, at: 'S', below: 'H' },
  { id: '13v2', kind: 'play', cards: ['T', '3'], up: 2, at: 'S', below: 'H' },
  { id: '12v4', kind: 'play', cards: ['T', '2'], up: 4, at: 'S', below: 'H' },
  { id: '12v5', kind: 'play', cards: ['T', '2'], up: 5, at: 'S', below: 'H' },
  { id: '12v6', kind: 'play', cards: ['T', '2'], up: 6, at: 'S', below: 'H' },
  { id: '13v3', kind: 'play', cards: ['T', '3'], up: 3, at: 'S', below: 'H' },
  { id: '8v6', kind: 'play', cards: ['5', '3'], up: 6, at: 'D', below: 'H' },
  { id: '8v5', kind: 'play', cards: ['5', '3'], up: 5, at: 'D', below: 'H' },
  { id: 'R14v10', kind: 'surrender', cards: ['T', '4'], up: 10, at: 'R', below: 'H' },
  { id: 'R15v10', kind: 'surrender', cards: ['T', '5'], up: 10, at: 'R', below: 'H' },
  { id: 'R15v9', kind: 'surrender', cards: ['T', '5'], up: 9, at: 'R', below: 'H' },
  { id: 'R15vA', kind: 'surrender', cards: ['T', '5'], up: 11, at: 'R', below: 'H' },
];
