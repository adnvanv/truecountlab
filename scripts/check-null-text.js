// Usage: node scripts/check-null-text.js
// Find DOM replaceChildren()/append() calls where a top-level argument can be null/false
// (the DOM prints those as the text "null"/"false"). h() itself skips them, so only
// arguments passed straight to the DOM method matter.
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'public', 'js');
const files = [];
(function walk(d) { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(dir);

function args(src, open) { // src[open] === '('; returns [args, end]
  let depth = 0; let i = open; let cur = ''; const out = []; let str = null;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (str) {
      cur += ch;
      if (ch === '\\') { cur += src[++i]; continue; }
      if (ch === str) str = null;
      else if (str === '`' && ch === '$' && src[i + 1] === '{') { /* template expr: keep simple */ }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { str = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) { depth++; if (depth > 1) cur += ch; continue; }
    if (')]}'.includes(ch)) { depth--; if (depth === 0) { out.push(cur.trim()); return [out, i]; } cur += ch; continue; }
    if (ch === ',' && depth === 1) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  return [out, i];
}
// Is there a ?: or && at the top level of this argument (outside parens/brackets/strings)?
function risky(a) {
  let depth = 0; let str = null;
  for (let i = 0; i < a.length; i++) {
    const ch = a[i];
    if (str) { if (ch === '\\') i++; else if (ch === str) str = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { str = ch; continue; }
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (depth === 0 && ((ch === '?' && a[i + 1] !== '.' && a[i + 1] !== '?') || (ch === '&' && a[i + 1] === '&'))) return true;
  }
  return false;
}
let found = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /\.(replaceChildren|append|prepend|after|before)\(/g;
  let m;
  while ((m = re.exec(src))) {
    const [list] = args(src, m.index + m[0].length - 1);
    for (const a of list) {
      const spread = a.startsWith('...');
      if (risky(spread ? a.slice(3) : a) && /null|false|&&/.test(a)) {
        const line = src.slice(0, m.index).split('\n').length;
        console.log(`${path.relative(dir, f)}:${line}  ${a.replace(/\s+/g, ' ').slice(0, 110)}`);
        found++;
      }
    }
  }
}
console.log(`${found} suspicious argument(s) in ${files.length} files`);
process.exitCode = found ? 1 : 0;
