// Synthesized table sounds — cards, shuffles, chips, results. No audio files.
// Browsers only allow audio after a user gesture; every sound here is triggered by one
// (or by game flow that a gesture started), and the context is resumed on demand.

let ac = null;
let master = null;
let noiseBuf = null;
let cfg = { on: true, volume: 0.6 };

export function configure(c) {
  cfg = c;
  if (master) master.gain.value = c.on ? c.volume : 0;
}

function ctx() {
  if (!cfg.on) return null;
  if (!ac) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ac = new C();
    master = ac.createGain();
    master.gain.value = cfg.volume;
    master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

const rand = (a, b) => a + Math.random() * (b - a);

function env(g, t0, attack, dur, peak) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

function noise(a, { t = 0, dur = 0.08, type = 'bandpass', f = 3000, f2 = null, q = 1, gain = 0.4, attack = 0.003 }) {
  const t0 = a.currentTime + t;
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const flt = a.createBiquadFilter();
  flt.type = type;
  flt.Q.value = q;
  flt.frequency.setValueAtTime(f, t0);
  if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  const g = a.createGain();
  env(g, t0, attack, dur, gain);
  src.connect(flt).connect(g).connect(master);
  src.start(t0, rand(0, 0.8), dur + 0.05);
}

function tone(a, { t = 0, f = 440, f2 = null, dur = 0.15, type = 'sine', gain = 0.15, attack = 0.005 }) {
  const t0 = a.currentTime + t;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  const g = a.createGain();
  env(g, t0, attack, dur, gain);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function chips(a, n, t = 0) {
  for (let i = 0; i < n; i++) {
    const ti = t + i * rand(0.045, 0.07);
    tone(a, { t: ti, f: rand(2500, 3400), dur: 0.07, type: 'triangle', gain: 0.07 });
    tone(a, { t: ti, f: rand(5200, 6400), dur: 0.035, type: 'sine', gain: 0.04 });
    noise(a, { t: ti, dur: 0.03, type: 'bandpass', f: rand(3800, 5200), q: 4, gain: 0.45, attack: 0.001 });
  }
}

// ---- recorded samples ------------------------------------------------------
// public/sounds/manifest.json maps a sound name to clips listed without an
// extension, e.g. { "deal": ["sounds/card-slide-1", ...] }. Each clip exists as
// .ogg and .m4a; the browser gets the one it can play (Safari/iPhone: .m4a).
// A random clip plays each time; names with no clips use the synth version.
const samples = {}; // name -> [AudioBuffer]
let manifest = null;
let loading = null;
let decoding = null;

const prefersOgg = (() => {
  try { return !!new Audio().canPlayType('audio/ogg; codecs="vorbis"'); } catch { return false; }
})();

export function loadSamples(url = 'sounds/manifest.json') {
  if (!loading) {
    loading = fetch(url, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => { manifest = m; })
      .catch(() => { manifest = null; });
    // Browsers only allow audio after a gesture, so decode on the first tap or key.
    const prime = () => {
      removeEventListener('pointerdown', prime, true);
      removeEventListener('keydown', prime, true);
      const a = ctx();
      if (a) loading.then(() => decodeAll(a));
    };
    addEventListener('pointerdown', prime, true);
    addEventListener('keydown', prime, true);
  }
  return loading;
}

async function decodeClip(a, base) {
  const order = prefersOgg ? ['.ogg', '.m4a'] : ['.m4a', '.ogg'];
  for (const ext of order) {
    try {
      const r = await fetch(base + ext);
      if (!r.ok) continue;
      return await a.decodeAudioData(await r.arrayBuffer());
    } catch { /* try the other format */ }
  }
  return null;
}

function decodeAll(a) {
  if (decoding || !manifest) return decoding;
  decoding = Promise.all(Object.entries(manifest)
    .filter(([name, files]) => !name.startsWith('_') && Array.isArray(files))
    .map(async ([name, files]) => {
      const bufs = (await Promise.all(files.map((f) => decodeClip(a, f)))).filter(Boolean);
      if (bufs.length) samples[name] = bufs;
    }));
  return decoding;
}

function playSample(a, name, { t = 0, gain = 1, rate = 1 } = {}) {
  const list = samples[name];
  if (!list) return false;
  const src = a.createBufferSource();
  src.buffer = list[Math.floor(Math.random() * list.length)];
  src.playbackRate.value = rate * rand(0.95, 1.05);
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(g).connect(master);
  src.start(a.currentTime + t);
  return true;
}

const play = (fn, name, gain = 1) => (...args) => {
  const a = ctx();
  if (!a) return;
  decodeAll(a);
  if (name && playSample(a, name, { gain })) return;
  fn(a, ...args);
};

// Chips: one recorded chip for a single chip, a stack sound for several.
function chipSound(a, n, t = 0) {
  if (n > 1 && playSample(a, 'chips', { t, gain: 0.9 })) return;
  if (playSample(a, 'chip', { t, gain: 0.9 })) return;
  chips(a, n, t);
}

// Which recorded sounds are ready: { names: [...], clips: n }.
export const sampleStatus = () => ({ names: Object.keys(samples), clips: Object.values(samples).reduce((n, l) => n + l.length, 0) });

// How long the shuffle lasts, so the dealer waits for it before dealing.
export const shuffleMs = () => (samples.shuffle ? Math.round(samples.shuffle[0].duration * 1000) + 250 : 550);

const chime = (a, notes, step, gain = 0.07) => notes.forEach((f, i) => tone(a, { t: i * step, f, dur: 0.3, type: 'triangle', gain }));

export const sfx = {
  // Card slides out of the shoe.
  deal: play((a) => {
    noise(a, { dur: 0.12, type: 'bandpass', f: 1600, f2: 5200, q: 0.7, gain: 0.32 });
    noise(a, { t: 0.1, dur: 0.035, type: 'highpass', f: 3000, gain: 0.25, attack: 0.001 });
  }, 'deal', 0.85),
  // Hole card turned over.
  flip: play((a) => {
    noise(a, { dur: 0.06, type: 'highpass', f: 2200, gain: 0.35, attack: 0.001 });
    noise(a, { t: 0.05, dur: 0.04, type: 'bandpass', f: 1100, q: 1.5, gain: 0.25 });
  }, 'flip'),
  // Quieter card used by the countdown drills.
  tick: play((a) => noise(a, { dur: 0.035, type: 'highpass', f: 3500, gain: 0.18, attack: 0.001 }), 'tick', 0.55),
  // Dealer sweeps the last round's cards into the discard tray.
  collect: play(() => {}, 'collect', 0.7),
  // One quick riffle.
  shuffle: play((a) => {
    for (let i = 0; i < 18; i++) {
      const t = i * (0.017 - i * 0.0003) + rand(0, 0.004);
      noise(a, { t, dur: 0.016, type: 'bandpass', f: rand(2200, 4800), q: 2.2, gain: 0.12 + i * 0.012, attack: 0.001 });
    }
  }, 'shuffle'),
  chip: play((a, n = 2) => chipSound(a, n)),
  // Dealer pays you: chips pushed over, with a soft rising chime.
  win: play((a) => {
    chime(a, [523.25, 659.25, 783.99], 0.08, 0.05);
    if (!playSample(a, 'payout', { t: 0.05 })) chips(a, 3, 0.18);
  }),
  blackjack: play((a) => {
    chime(a, [523.25, 659.25, 783.99, 1046.5, 1318.5], 0.07, 0.07);
    if (!playSample(a, 'payout', { t: 0.1 })) chips(a, 4, 0.3);
    playSample(a, 'chips', { t: 0.45, gain: 0.8 });
  }),
  push: play((a) => tone(a, { f: 523.25, dur: 0.16, type: 'sine', gain: 0.05 })),
  // Dealer takes your chips.
  lose: play((a) => {
    if (!playSample(a, 'take', { gain: 0.9 })) noise(a, { dur: 0.06, type: 'lowpass', f: 600, gain: 0.25 });
    tone(a, { t: 0.05, f: 247, f2: 165, dur: 0.3, type: 'sine', gain: 0.06 });
  }),
  bust: play((a) => {
    playSample(a, 'take', { t: 0.15, gain: 0.9 });
    tone(a, { f: 330, dur: 0.12, type: 'square', gain: 0.03 });
    tone(a, { t: 0.13, f: 220, f2: 180, dur: 0.22, type: 'square', gain: 0.03 });
  }),
  right: play((a) => { tone(a, { f: 880, dur: 0.09, gain: 0.05 }); tone(a, { t: 0.07, f: 1318.5, dur: 0.14, gain: 0.05 }); }),
  wrong: play((a) => tone(a, { f: 196, f2: 165, dur: 0.18, type: 'sawtooth', gain: 0.03 })),
  click: play((a) => noise(a, { dur: 0.02, type: 'highpass', f: 4000, gain: 0.12, attack: 0.001 })),
};
