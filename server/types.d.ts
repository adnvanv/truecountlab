// Shared types for the server, used from JSDoc (`@typedef {import('./types').X} X`).
// Type-only: nothing here runs. Checked by `tsc -p tsconfig.server.json` in CI.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WebSocket as ServerSocket } from './ws.js';

export type Req = IncomingMessage;
export type Res = ServerResponse;

/** A row of the users table (plus the session's expiry when read through a session). */
export interface UserRow {
  id: number;
  email: string | null;
  email_verified: number;
  display_name: string;
  password_hash: string | null;
  created_at: number;
  session_expires?: number;
}

/** What the browser is told about the signed-in account. */
export interface PublicUser {
  id: number;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  providers: string[];
  createdAt: number;
}

/** A request handler: returns true when it answered the request. */
export type Handler = (req: Req, res: Res, url: URL) => Promise<boolean> | boolean;

// ---- cards and the shared game code (public/js/cards.js, strategy.js) --------------
export interface Card {
  rank: string;
  suit: string;
  id?: number;
  down?: boolean;
}
export interface Options { canDouble: boolean; canSplit: boolean; canSurrender?: boolean }
export type Action = 'H' | 'S' | 'D' | 'P' | 'R';
export interface Deviation {
  id: string; group: string; kind: string; name: string; tc: number; up: number;
  total?: number; pair?: string; at: string; below: string;
}
/** A strategy (public/js/strategy.js): count, chart, index plays and bet ramp. */
export interface Strat {
  id: string; name: string; preset?: boolean;
  count: { name: string; kind: 'true' | 'running'; irc?: number; values: Record<string, number> };
  chart: unknown; devs: Deviation[]; ramp: { at: number; units: number }[];
}
export interface Shoe {
  cards: Card[];
  dealt: number;
  cutIndex: number;
  readonly remaining: number;
  readonly pastCut: boolean;
  shuffle(): void;
  draw(): Card;
}
export interface CardsLib {
  RULES: { decks: number; penetration: number; minBet: number; bankroll: number; buyIn: number; text: string };
  Shoe: new () => Shoe;
  hiLo(card: Card): number;
  rankKey(rank: string): string;
  betFor(tc: number): number;
  decksEstimate(cardsRemaining: number): number;
  trueCount(rc: number, decks: number): number;
  tcFromCards(rc: number, cardsRemaining: number): number;
  tcCandidates(rc: number, cardsRemaining: number): number[];
  randInt(n: number): number;
  pick<T>(arr: T[]): T;
  chance(p: number): boolean;
  shuffleInPlace<T>(a: T[]): T[];
  makeDecks(n?: number): Card[];
  cardForValue(v: number): Card;
}
export interface StrategyLib {
  DEVS: Deviation[];
  handTotal(cards: Card[]): { total: number; soft: boolean };
  isPair(cards: Card[]): boolean;
  isBlackjack(cards: Card[]): boolean;
  upValue(card: Card): number;
  handLabel(cards: Card[]): string;
  upLabel(v: number): string;
  insuranceCorrect(tc: number, strat?: Strat): boolean;
  devNote(d: Deviation, strat?: Strat): string;
  correctAction(cards: Card[], up: number, o: Options, tc?: number | null, strat?: Strat): { action: Action; basic: Action; dev: Deviation | null; note: string | null };
  tagOf(card: Card, strat?: Strat): number;
  startCount(strat?: Strat): number;
  countIndex(rc: number, cardsRemaining: number, strat?: Strat): number;
  indexCandidates(rc: number, cardsRemaining: number, strat?: Strat): number[];
  betAt(idx: number, strat?: Strat): number;
  rampText(strat?: Strat): string;
  indexName(strat?: Strat): 'TC' | 'RC';
  DEFAULT_STRATEGY: Strat;
}
export interface StrategiesLib {
  PRESETS: Strat[];
  DEFAULT_ID: string;
  strategyById(id: string | undefined, mine?: Strat[]): Strat;
  cleanStrategy(x: unknown): Strat | null;
}
export interface GameLibs { cards: CardsLib; strategy: StrategyLib; strategies: StrategiesLib }

// ---- live play ------------------------------------------------------------------------
/** One WebSocket connection. */
export interface Conn {
  ws: ServerSocket;
  ip: string;
  user: UserRow | null;
  id: string | null;
  name: string | null;
  guest: boolean;
  room: RoomLike | null;
  times: number[];
  /** The strategy this player is graded on (a preset, or their own if signed in). */
  strategy: Strat | null;
}

/** Someone in a room (kept for a while if their connection drops). */
export interface Member {
  id: string;
  name: string;
  guest: boolean;
  userId: number | null;
  conn: Conn | null;
  connected: boolean;
  timer: NodeJS.Timeout | null;
  chatTimes: number[];
}

/** What a game sees of its room. */
export interface RoomLike {
  code: string;
  kind: string;
  visibility: 'public' | 'private';
  members: Map<string, Member>;
  connectedMembers(): Member[];
  isHost(id: string): boolean;
  changed(): void;
  lobbyChanged(): void;
  system(text: string): void;
  tell(id: string, text: string): void;
}

/** A message from a browser to a game ({ t: 'game', a: ..., ... }). */
export interface GameMessage {
  a?: string;
  [key: string]: unknown;
}

/** What every game type provides to its room. */
export interface Game {
  readonly capacity: number;
  /** A battle is under way (always false for tables). */
  readonly playing: boolean;
  /** Battles: the premade strategy everyone in the room plays. */
  readonly strategyId?: string;
  /** Players seated (tables) or playing (battles). */
  seatCount(): number;
  /** Someone else could still take part. */
  hasRoom(): boolean;
  status(): 'playing' | 'waiting';
  summary(): string;
  view(id: string): object;
  action(m: Member, msg: GameMessage): string | null;
  onJoin(m: Member): void;
  onLeave(m: Member): void;
  onDisconnect(m: Member): void;
  onReconnect(m: Member): void;
  destroy(): void;
}

/** Results storage the games write to (server/records.js). */
export interface Records {
  bump(key: 'hands_dealt' | 'plays_graded' | 'battles_played' | 'battle_answers' | 'rooms_opened' | 'solo_hands' | 'solo_plays' | 'drills', n?: number): void;
  saveBattle(players: { userId: number | null; score: number; rounds: number; correct: number }[]): Map<number, { before: number; after: number }>;
  addTableStats(userId: number, d: TableCounters): void;
}
export interface TableCounters {
  hands?: number; decisions?: number; correct?: number; bets?: number; betsCorrect?: number; checks?: number; checksCorrect?: number;
}
