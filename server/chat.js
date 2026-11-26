// Chat and nickname cleanup: length limits, no control characters, and slurs and
// strong profanity masked with asterisks. Chat is relayed live and never stored.
'use strict';

const MAX_CHAT = 200;
// Matched as the start of a word (so plurals and -ing forms are caught too).
const STEMS = ['fuck', 'shit', 'cunt', 'bitch', 'asshole', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut',
  'kike', 'tranny', 'wanker', 'twat', 'motherfuck', 'bullshit', 'dickhead', 'pussies', 'cocksuck'];
// Matched only as whole words, since they appear inside ordinary words.
const WORDS = ['fag', 'fags', 'dick', 'dicks', 'cock', 'cocks', 'pussy', 'spic', 'spics', 'chink', 'chinks', 'coon', 'coons', 'gook', 'gooks', 'kys'];

// Undo common letter swaps (f*ck, sh1t, $hit, a$$) before matching.
/** @type {Record<string, string>} */
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i', '*': 'u' };
// Character by character, so the result lines up with the original text position for position.
/** @param {string} s */
const normalize = (s) => [...s].map((ch) => { const l = ch.toLowerCase(); return l.length === ch.length ? (LEET[l] ?? l) : ch; }).join('');

const stemRe = new RegExp(`(^|[^a-z])(${STEMS.join('|')})`, 'g');
const wordRe = new RegExp(`(^|[^a-z])(${WORDS.join('|')})(?=$|[^a-z])`, 'g');

/** Mask slurs and strong profanity with asterisks. @param {string} text */
function mask(text) {
  const norm = normalize(text);
  const hits = [];
  for (const re of [stemRe, wordRe]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(norm))) {
      const start = m.index + m[1].length;
      let end = start + m[2].length;
      if (re === stemRe) while (end < norm.length && /[a-z]/.test(norm[end])) end++; // the rest of the word
      hits.push([start, end]);
      re.lastIndex = Math.max(re.lastIndex, end);
    }
  }
  if (!hits.length) return text;
  const chars = text.split('');
  for (const [a, b] of hits) for (let i = a; i < b; i++) if (chars[i] && /\S/.test(chars[i])) chars[i] = '*';
  return chars.join('');
}

/** @param {string} text */
const hasBadWord = (text) => mask(text) !== text;

// Trim, collapse whitespace, drop control and invisible characters, cap the length.
/** @param {unknown} text @param {number} [max] */
function clean(text, max = MAX_CHAT) {
  return String(text ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** A chat message ready to post, or null if it's empty. @param {unknown} text */
function chatText(text) {
  const t = clean(text);
  return t ? mask(t) : null;
}

// Guest nicknames: 2–20 letters, digits, spaces, dots, dashes or underscores.
/** @param {unknown} name @returns {{ name: string, error?: undefined } | { error: string, name?: undefined }} */
function nickname(name) {
  const n = clean(name, 40);
  if (n.length < 2 || n.length > 20) return { error: 'Pick a name of 2–20 characters.' };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(n)) return { error: 'Use letters, numbers, spaces, dots, dashes or underscores.' };
  if (hasBadWord(n)) return { error: 'Please pick a different name.' };
  if (/^(host|admin|system|truecountlab|dealer|moderator)$/i.test(n)) return { error: 'That name is reserved.' };
  return { name: n };
}

module.exports = { chatText, nickname, mask, clean, MAX_CHAT };
