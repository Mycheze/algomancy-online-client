/* BL-03 — A PRACTICE GAME: your constructed deck against a scripted opponent.
 *
 * `?practice=play` runs the game this browser saved last; the home screen's
 * "Practise against a bot" sheet deals a fresh one (`begin`) and goes there.
 * Like Learn to Play (ui/learn.ts) the whole game runs in the page — the
 * SoloServer (ui/solo.ts) behind an ordinary NetBackend, the opponent's hand
 * hidden — and it is saved after every change as its deal plus its action
 * log, so a reload continues it. Nothing reaches the server: a practice game
 * counts toward no record, stat, achievement or rating (the owner, 2026-08-25:
 * "Excluded as well").
 */
import type { CardName } from '../engine/src/types.ts';
import { opponentById, planBot, practiceDeal, type Opponent } from './opponents.ts';
import { SoloServer, type SoloSave } from './solo.ts';

const KEY = 'algoPractice';

export interface PracticeSave {
  v: 1;
  opponent: string;
  /** the deck's name, for the board's title */
  deckName: string;
  game: SoloSave;
}

export function loadPractice(): PracticeSave | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PracticeSave;
    return p && p.v === 1 && opponentById(p.opponent) && p.game?.v === 1 ? p : null;
  } catch { return null; }
}

function savePractice(p: PracticeSave | null): void {
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify(p));
    else localStorage.removeItem(KEY);
  } catch { /* private window: the game lasts as long as the page */ }
}

function playerName(): string {
  try { return (localStorage.getItem('algoName') ?? '').trim() || 'You'; } catch { return 'You'; }
}

/** Deal a new game against `oppId` with `deck`, replacing any saved one.
 * False when there is no such opponent or no deck. */
export function begin(oppId: string | undefined, deck: { name: string; cards: readonly string[] } | null,
  name: string = playerName(), seed: number = Math.floor(Math.random() * 1e6)): boolean {
  const opp = opponentById(oppId);
  if (!opp || !deck?.cards.length) return false;
  const deal = practiceDeal(opp, deck.cards as CardName[], name, seed);
  savePractice({ v: 1, opponent: opp.id, deckName: deck.name, game: { v: 1, deal, actions: [], by: [] } });
  return true;
}

/** the practice game this page is running, if any */
let current: { server: SoloServer; opponent: Opponent; save: PracticeSave } | null = null;
export const currentPractice = (): typeof current => current;

/** The room for `?practice=play`: the saved game, or null when there is none
 * (the caller goes home). Every change is saved; a finished game stays saved
 * so a reload still shows how it ended. */
export function startPractice(opts: { onBotStuck?: (why: string) => void } = {}): typeof current {
  const save = loadPractice();
  const opponent = save && opponentById(save.opponent);
  if (!save || !opponent) return null;
  const server = new SoloServer(save.game.deal, planBot(opponent), save.game, {
    onChange: s => { save.game = s.save; savePractice(save); },
    ...(opts.onBotStuck ? { onBotStuck: opts.onBotStuck } : {}),
  });
  save.game = server.save;
  savePractice(save);
  current = { server, opponent, save };
  return current;
}
