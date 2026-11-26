// Online: the lobby (quick play, private rooms, open rooms, leaderboards) and the room
// screen (a count battle or a shared table, the players and the chat).
import { h, head, toast } from '../ui.js';
import { currentUser } from '../store.js';
import * as online from '../online.js';
import { battleUI } from './battle.js';
import { tableUI } from './sharedtable.js';

const KIND = { battle: 'Count battle', table: 'Shared table' };
const BOARDS = [
  ['rating', 'Battle rating', (v) => String(v), (n) => `${n} rated`],
  ['wins', 'Battle wins', (v) => String(v), (n) => `${n} rated`],
  ['battleAccuracy', 'Battle accuracy', (v) => `${v}%`, (n) => `${n} rounds`],
  ['tablePlay', 'Table plays', (v) => `${v}%`, (n) => `${n} plays`],
  ['tableChecks', 'Count checks', (v) => `${v}%`, (n) => `${n} checks`],
];
const muted = new Set(); // players you've muted, for this visit

const roomFromHash = () => (new URLSearchParams(location.hash.split('?')[1] || '').get('room') || '').toUpperCase();
const setHash = (code) => history.replaceState(null, '', code ? `#play?room=${code}` : '#play');
const inviteLink = (code) => `${location.origin}/#play?room=${code}`;

export function mount(root) {
  let alive = true;
  let room = null; // latest room state
  let lobby = { rooms: [], online: 0 };
  let boards = null;
  let board = 'rating';
  let gameUI = null;
  let gameKind = null;
  let notice = null;
  let chatLog = [];
  let roomCode = null;

  const lobbyEl = h('div', { class: 'online-lobby' });
  const roomEl = h('div', { class: 'online-room' });
  const view = h('section', { class: 'view online' }, lobbyEl, roomEl);
  root.append(view);

  // ---- lobby -------------------------------------------------------------------
  function drawLobby() {
    const u = currentUser();
    const st = online.getStatus();
    const you = online.me();
    const nameInput = h('input', { class: 'text-input', value: online.guestName(), maxlength: 20, 'aria-label': 'Your name online' });
    const who = u
      ? h('div', { class: 'ol-who' }, h('span', {}, 'Playing as ', h('strong', {}, u.displayName), '. Your battles count toward your rating and the leaderboards.'))
      : h('form', {
        class: 'ol-who',
        onsubmit: (e) => { e.preventDefault(); online.setGuestName(nameInput.value.trim()); },
      },
      h('span', {}, 'Your name: '), nameInput, h('button', { class: 'btn sm', type: 'submit' }, 'Save'),
      h('span', { class: 'muted' }, ' Guests can play everything. ', h('a', { href: '#account' }, 'Sign in'), ' to get a rating and show on the leaderboards.'));
    const statusText = st === 'ready' ? `${lobby.online} online now` : st === 'needName' ? online.error() : st === 'connecting' ? 'Connecting…' : 'Offline. Reconnecting…';
    const codeInput = h('input', { class: 'text-input code', placeholder: 'ABC123', maxlength: 6, autocomplete: 'off', 'aria-label': 'Room code' });
    const ready = st === 'ready';
    const settingsFor = () => ({ rounds: 9, types: ['rc', 'tc', 'play'] });
    const card = (kind, title, desc) => h('div', { class: 'panel ol-card' },
      h('h2', {}, title), h('p', { class: 'muted' }, desc),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', disabled: !ready, onclick: () => online.send({ t: 'quick', kind }) }, kind === 'battle' ? 'Quick battle' : 'Join a table'),
        h('button', { class: 'btn', disabled: !ready, onclick: () => online.send({ t: 'create', kind, visibility: 'private', settings: settingsFor() }) }, 'Private room'),
        h('button', { class: 'btn ghost', disabled: !ready, onclick: () => online.send({ t: 'create', kind, visibility: 'public', settings: settingsFor() }) }, 'New public room')));

    const list = lobby.rooms.length
      ? h('table', { class: 'ol-rooms' }, h('tbody', {}, lobby.rooms.map((r) => h('tr', {},
        h('td', {}, h('strong', {}, KIND[r.kind]), h('div', { class: 'muted small' }, r.detail)),
        h('td', {}, `${r.host}'s room`),
        h('td', { class: 'mono' }, `${r.players}/${r.max}${r.watching ? ` +${r.watching} watching` : ''}`),
        h('td', {}, h('span', { class: `pill ${r.status === 'playing' ? 'deviation' : 'basic'}` }, r.status === 'playing' ? (r.kind === 'table' ? 'Dealing' : 'In a battle') : 'Waiting')),
        h('td', {}, h('button', { class: 'btn sm', disabled: !ready, onclick: () => online.join(r.code) }, r.kind === 'battle' && r.status === 'playing' ? 'Watch' : 'Join'))))))
      : h('p', { class: 'muted' }, 'No public rooms open right now. Start one, or make a private room and send friends the link.');

    lobbyEl.replaceChildren(...[
      head('Play online', 'Race other players in count battles, or sit at a shared table and play the same shoe together. The count is never shown: you keep it yourself.'),
      notice ? h('div', { class: `notice ${notice.kind}` }, notice.text) : null,
      h('div', { class: 'panel ol-status' }, who, h('div', { class: `ol-online ${st === 'ready' ? 'good' : st === 'needName' ? 'bad' : 'muted'}` }, statusText)),
      h('div', { class: 'ol-cards' },
        card('battle', 'Count battle', 'Up to 8 players get the same question at the same time: running counts, true counts and hands to play. Right and fast wins.'),
        card('table', 'Shared table', 'Up to 5 players at one 6-deck shoe with $500 in table chips. Your bets, plays and count checks are graded privately.')),
      h('form', {
        class: 'panel ol-code',
        onsubmit: (e) => { e.preventDefault(); const c = codeInput.value.trim().toUpperCase(); if (c) online.join(c); },
      }, h('span', {}, 'Have a code?'), codeInput, h('button', { class: 'btn', type: 'submit', disabled: !ready }, 'Join room')),
      h('h2', {}, 'Open rooms'),
      list,
      leaderboards()].filter(Boolean));
  }

  function leaderboards() {
    if (!boards) return h('div', { class: 'panel ol-boards' }, h('h2', {}, 'Leaderboards'), h('p', { class: 'muted' }, 'Loading…'));
    const [id, label, fmt, sub] = BOARDS.find((b) => b[0] === board);
    const rows = boards[id] || [];
    const min = boards.minimums;
    const rule = {
      rating: `Signed-in players with at least ${min.rated} rated battles (two or more signed-in players).`,
      wins: 'Rated battles won.',
      battleAccuracy: `Right answers in battles, at least ${min.rounds} rounds.`,
      tablePlay: `Correct plays at shared tables, at least ${min.decisions} decisions.`,
      tableChecks: `Correct count checks at shared tables, at least ${min.checks} checks.`,
    }[id];
    const y = boards.you;
    return h('div', { class: 'panel ol-boards' },
      h('h2', {}, 'Leaderboards'),
      h('div', { class: 'seg' }, BOARDS.map(([bid, blabel]) => h('button', { class: `btn sm${bid === board ? ' on' : ''}`, onclick: () => { board = bid; drawLobby(); } }, blabel))),
      h('p', { class: 'muted small' }, rule),
      rows.length
        ? h('ol', { class: 'ol-board' }, rows.map((r) => h('li', { class: y && r.name === y.name ? 'me' : '' },
          h('span', { class: 'who' }, r.name), h('span', { class: 'muted small' }, sub(r.games)), h('span', { class: 'pts mono' }, fmt(r.value)))))
        : h('p', { class: 'muted' }, `Nobody on the ${label.toLowerCase()} board yet.`),
      y?.battle ? h('p', { class: 'muted small' }, `You: rating ${y.battle.rating} after ${y.battle.ratedGames} rated battles, ${y.battle.wins} wins.`) : null);
  }

  async function loadBoards() {
    try {
      const r = await fetch('/api/leaderboards', { cache: 'no-store' });
      if (r.ok) boards = await r.json();
    } catch { /* offline */ }
    if (alive && !room) drawLobby();
  }

  // ---- room --------------------------------------------------------------------
  function drawRoom() {
    if (!room) return;
    if (gameKind !== room.kind) {
      gameUI?.destroy();
      gameUI = room.kind === 'battle' ? battleUI() : tableUI();
      gameKind = room.kind;
      roomEl.replaceChildren(roomHeader, h('div', { class: 'room-body' }, h('div', { class: 'room-game' }, gameUI.el), side));
    }
    drawHeader();
    drawMembers();
    gameUI.update(room);
  }

  const roomHeader = h('div', { class: 'room-head' });
  const membersEl = h('ul', { class: 'room-members' });
  const chatList = h('div', { class: 'chat-list', 'aria-live': 'polite' });
  const chatInput = h('input', { class: 'text-input', maxlength: 200, placeholder: 'Say something…', 'aria-label': 'Chat message', autocomplete: 'off' });
  const chatForm = h('form', {
    class: 'chat-form',
    onsubmit: (e) => {
      e.preventDefault();
      const text = chatInput.value.trim();
      if (!text) return;
      if (online.send({ t: 'chat', text })) chatInput.value = '';
    },
  }, chatInput, h('button', { class: 'btn sm', type: 'submit' }, 'Send'));
  const side = h('aside', { class: 'room-side' },
    h('div', { class: 'panel' }, h('h3', {}, 'Players'), membersEl),
    h('div', { class: 'panel room-chat' }, h('h3', {}, 'Chat'), chatList, chatForm,
      h('p', { class: 'muted small' }, 'Be kind. Chat isn’t saved. Click a name to mute it.')));

  function drawHeader() {
    const link = inviteLink(room.code);
    roomHeader.replaceChildren(
      h('div', {},
        h('h1', {}, KIND[room.kind]),
        h('div', { class: 'muted' }, room.visibility === 'private' ? 'Private room: only people with the link or code can join.' : 'Public room: listed in the lobby.')),
      h('div', { class: 'room-code' },
        h('span', { class: 'muted' }, 'Code '), h('strong', { class: 'mono' }, room.code),
        h('button', {
          class: 'btn sm', onclick: async () => {
            try { await navigator.clipboard.writeText(link); toast('Invite link copied.'); } catch { prompt('Copy this invite link:', link); }
          },
        }, 'Copy invite link'),
        h('button', { class: 'btn sm ghost', onclick: leaveRoom }, 'Leave')));
  }

  function drawMembers() {
    const host = room.hostId === room.youId;
    membersEl.replaceChildren(...room.members.map((m) => h('li', { class: m.id === room.youId ? 'me' : '' },
      h('button', {
        class: `link who${muted.has(m.id) ? ' muted-name' : ''}`, disabled: m.id === room.youId,
        title: m.id === room.youId ? 'You' : muted.has(m.id) ? 'Unmute' : 'Mute',
        onclick: () => { if (muted.has(m.id)) muted.delete(m.id); else muted.add(m.id); drawMembers(); drawChat(); },
      }, m.name),
      m.id === room.hostId ? h('span', { class: 'tag host' }, 'host') : null,
      m.guest ? h('span', { class: 'tag' }, 'guest') : null,
      m.connected ? null : h('span', { class: 'tag off' }, 'offline'),
      muted.has(m.id) ? h('span', { class: 'tag' }, 'muted') : null,
      host && m.id !== room.youId ? h('button', {
        class: 'btn sm ghost kick', title: `Remove ${m.name}`,
        onclick: () => { if (confirm(`Remove ${m.name} from this room? They won't be able to rejoin it.`)) online.send({ t: 'kick', id: m.id }); },
      }, 'Remove') : null)));
  }

  function drawChat() {
    const atBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 40;
    chatList.replaceChildren(...chatLog.filter((m) => m.system || !muted.has(m.id)).map((m) => (m.system
      ? h('div', { class: 'chat-msg system' }, m.text)
      : h('div', { class: `chat-msg${m.id === room?.youId ? ' me' : ''}` }, h('strong', {}, m.name), m.guest ? h('span', { class: 'tag' }, 'guest') : null, ' ', m.text))));
    if (atBottom) chatList.scrollTop = chatList.scrollHeight;
  }

  function enterRoom(r) {
    const fresh = !room || room.code !== r.code;
    room = r;
    roomCode = r.code;
    notice = null;
    if (fresh) {
      setHash(r.code);
      lobbyEl.hidden = true;
      roomEl.hidden = false;
      online.send({ t: 'lobby', watch: false });
      window.scrollTo(0, 0);
    }
    drawRoom();
  }

  function exitRoom(reason) {
    room = null;
    roomCode = null;
    gameUI?.destroy();
    gameUI = null;
    gameKind = null;
    chatLog = [];
    roomEl.replaceChildren();
    roomEl.hidden = true;
    lobbyEl.hidden = false;
    setHash(null);
    notice = reason ? { kind: 'bad', text: reason } : null;
    online.send({ t: 'lobby', watch: true });
    loadBoards();
    drawLobby();
  }

  function leaveRoom() { online.leave(); exitRoom(null); }

  // ---- wiring --------------------------------------------------------------------
  const offs = [
    online.on('status', () => { if (!room) drawLobby(); }),
    online.on('welcome', () => {
      online.send({ t: 'lobby', watch: !room && !roomFromHash() });
      const code = roomCode || roomFromHash();
      if (code && online.currentRoom() !== code) online.join(code);
      if (!room) drawLobby();
    }),
    online.on('lobby', (m) => { lobby = m; if (!room) drawLobby(); }),
    online.on('room', (m) => enterRoom(m.room)),
    online.on('chatHistory', (m) => { chatLog = m.msgs; drawChat(); }),
    online.on('chat', (m) => {
      chatLog.push(m.msg);
      if (chatLog.length > 100) chatLog.shift();
      drawChat();
    }),
    online.on('left', (m) => { if (room && (!m.code || m.code === room.code)) exitRoom(m.reason); }),
    online.on('noRoom', (m) => exitRoom(m.error)),
    online.on('error', (m) => toast(m.error)),
  ];

  roomEl.hidden = true;
  drawLobby();
  loadBoards();
  online.connect();
  if (online.getStatus() === 'ready') {
    const code = roomFromHash();
    if (code) online.join(code); else online.send({ t: 'lobby', watch: true });
  }

  return () => {
    alive = false;
    offs.forEach((off) => off());
    gameUI?.destroy();
    if (room) online.leave();
    online.send({ t: 'lobby', watch: false });
  };
}
