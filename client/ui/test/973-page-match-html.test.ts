/* 973 — THE COMPETITIVE MATCH SCREENS, DRAWN WITHOUT A PAGE (design-system round, 2026-11-03).
 *
 * The home card, "Your matches" and the match room left ui/match.ts for
 * pages/match.ts as view → pure html; the module's state (the Best of, the
 * draft, Concede's question) and the clock come in through the view. Driven
 * here with made-up views, no DOM. The driver tests 834–839 cover the same
 * screens through the client.
 *
 * §1 the Competitive card: signed out, signed in with a legal and an illegal deck, no legal deck
 * §2 Your matches: nothing without a match, a row and its button with one
 * §3 game 1: register a deck; the deck is in
 * §4 between games: score, clocks, countdown, presets, the boards, the legality line, Ready
 * §5 paused, and a match that ended while the page waited
 * §6 names, rooms and card names are escaped
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import type { CardName } from '../../engine/src/types.ts';
import {
  ccDeckSelectHtml, competitiveCardHtml, matchResultHtml, matchRoomHtml, yourMatchesHtml, type MatchRoomView,
} from '../pages/match.ts';
import type { MatchLobbyInfo } from '../match.ts';

const card = (n: string): CardName => n as CardName;
// real cards (a preset is checked against the pool): fifteen, two copies each, and two more on the side
const MAIN = Array.from({ length: 30 }, (_, i) => DECK_LIST[i % 15]!);
const SIDE = [DECK_LIST[20]!, DECK_LIST[21]!];
const CFG = { main: MAIN, side: SIDE };

function lobby(over: Partial<MatchLobbyInfo> = {}): MatchLobbyInfo {
  return {
    id: 'M1', bestOf: 3, game: 2, score: [1, 0], names: ['Ann', 'Bo'],
    banks: [38 * 60_000, 41 * 60_000 + 5_000], clockStart: 45 * 60_000,
    phase: 'between', chooser: null, initiative: null, until: 1_000_000 + 90_000, locked: false,
    ready: [false, false],
    mine: { registered: CFG, current: CFG, presets: [{ id: 'p1', name: 'vs control', out: [MAIN[0]!], in: [SIDE[0]!] }] },
    ...over,
  };
}
function room(over: Partial<MatchRoomView> = {}): MatchRoomView {
  const w = over.w ?? lobby();
  return {
    room: 'CCRM', seat: 0, names: ['Ann', 'Bo'], peers: [true, true], ended: null,
    w, decks: null, pick: null, error: '', now: 1_000_000,
    link: 'http://x/?ws=1&room=CCRM&seat=1&mode=constructed&cc=1', friends: '<!--SLOT:friends-->',
    shown: w.mine?.current ?? null, concedeAsk: false,
    ...over,
  };
}
const btns = (html: string): string[] => [...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!);

test('973 §0 positive control: there is no DOM here', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined');
  assert.match(matchRoomHtml(room()), /^<div class="lobbypage ccpage">/);
});

test('973 §1 the Competitive card', () => {
  const out = competitiveCardHtml({ signedIn: false, decks: null, bestOf: 3, pick: null });
  assert.match(out, /Sign in to play a Competitive match\./);
  assert.deepEqual(btns(out), ['acct-open-auth']);
  const decks = [{ id: 'dOK', name: 'Legal', error: null }, { id: 'dBAD', name: 'Big side', error: 'too many' }];
  const html = competitiveCardHtml({ signedIn: true, decks, bestOf: 1, pick: decks[0]! });
  assert.match(html, /<button class="[^"]*ui-toggle--strong" data-btn="cc-bo" type="button" aria-pressed="false" data-bo="3">Best of 3<\/button>/);
  assert.match(html, /<button class="[^"]*\bon" data-btn="cc-bo" type="button" aria-pressed="true" data-bo="1">Best of 1<\/button>/);
  assert.match(html, /<option value="dOK" selected>Legal<\/option>/);
  assert.match(html, /<option value="dBAD" disabled>Big side — too many<\/option>/);
  assert.match(html, /data-btn="cc-new" >New match<\/button>/);
  const none = competitiveCardHtml({ signedIn: true, decks: [decks[1]!], bestOf: 3, pick: null });
  assert.match(none, /no deck is Competitive legal yet/);
  assert.match(none, /data-btn="cc-new" disabled>New match — pick a deck first/);
  assert.match(competitiveCardHtml({ signedIn: true, decks: null, bestOf: 3, pick: null }), /loading your decks…/);
});

test('973 §1b the CC deck picker alone: the home Play card draws it in its Deck row', () => {
  // new home layout, docs/24, 2026-11-03: Competitive is a format on the Play card, which draws this piece
  const decks = [{ id: 'dOK', name: 'Legal', error: null }, { id: 'dBAD', name: 'Big <side>', error: 'too many' }];
  const html = ccDeckSelectHtml(decks, decks[0]!);
  assert.match(html, /^<select id="cc-deck" class="deckselect">/);
  assert.match(html, /<option value="dOK" selected>Legal<\/option>/);
  assert.match(html, /<option value="dBAD" disabled>Big &lt;side&gt; — too many<\/option>/);
  assert.match(ccDeckSelectHtml([decks[1]!], null), /no deck is Competitive legal yet/);
  assert.match(ccDeckSelectHtml(null, null), /loading your decks…/);
  assert.match(ccDeckSelectHtml([], null), /No decks yet/);
  assert.equal(competitiveCardHtml({ signedIn: true, decks, bestOf: 3, pick: decks[0]! }).includes(html), true,
    'the card and the Play card draw the same picker');
});

test('973 §2 Your matches', () => {
  assert.equal(yourMatchesHtml({ rows: [] }), '', 'no open match: nothing at all');
  const html = yourMatchesHtml({ rows: [{ room: 'PAUS', seat: 1, text: 'vs <b>Rashi</b> · paused today', button: 'Resume' }] });
  assert.match(html, /<div class="ccmine"><div class="zonelabel">Your matches<\/div>/);
  assert.match(html, /data-btn="cc-open" data-room="PAUS" data-seat="1">Resume</);
});

test('973 §3 game 1: register a deck, then it is in', () => {
  const w = lobby({ game: 1, phase: 'game', mine: null, score: [0, 0] });
  const decks = [{ id: 'dOK', name: 'Legal', error: null }];
  const html = matchRoomHtml(room({ w, decks, pick: decks[0]!, peers: [true, false] }));
  assert.match(html, /Competitive — Best of 3 — room <span class="roomcode">CCRM<\/span>/);
  assert.match(html, /Send your opponent the room code <b>CCRM<\/b>/);
  assert.match(html, /<!--SLOT:friends-->/);
  assert.match(html, /data-btn="cc-register" >Play this deck/);
  assert.match(html, /Bo — <span class="dim">not here yet<\/span>/);
  for (const b of ['gohome', 'copylink', 'cc-register']) assert.ok(btns(html).includes(b), b);
  const inn = matchRoomHtml(room({ w: { ...w, mine: lobby().mine, ready: [true, false] } }));
  assert.doesNotMatch(inn, /cc-register/, 'registered: no picker');
  assert.match(inn, /Ann \(you\) — <b class="lockedin">deck is in<\/b>/);
});

test('973 §4 between games: score, clocks, countdown, presets, boards, legality, Ready', () => {
  const html = matchRoomHtml(room());
  assert.match(html, /Game 2 of 3 — you lead 1–0 · <span class="cccount" data-cc-until="1090000">1:30<\/span> to sideboard/);
  assert.match(html, /Your clock <b>38:00<\/b> · Bo <b>41:05<\/b>/);
  assert.match(html, /<button class="on" data-btn="cc-preset" data-preset="registered" >Registered deck<\/button>/);
  assert.match(html, /data-btn="cc-preset" data-preset="p1" >vs control/);
  assert.match(html, /Main <span class="acctcount">30<\/span>/);
  assert.match(html, new RegExp(`data-btn="cc-move" data-from="main" data-card="${MAIN[0]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.doesNotMatch(html, /cclegal/, 'a legal deck: no legality line');
  assert.match(html, /<button data-btn="cc-ready" >Ready<\/button>/);
  for (const b of ['cc-pause', 'cc-concede']) assert.ok(btns(html).includes(b), b);

  const short = { main: MAIN.slice(1), side: [...SIDE, MAIN[0]!] };
  const bad = matchRoomHtml(room({ shown: short }));
  assert.match(bad, /<p class="ui-status ui-status--note deckmsg cclegal" role="status">Main deck needs 30 — you have 29\.<\/p>/);
  assert.match(bad, /data-btn="cc-ready" disabled>Ready<\/button> <span class="dim">Fix the deck to ready up\./);

  const loser = matchRoomHtml(room({ w: lobby({ chooser: 0 }) }));
  assert.match(loser, /data-init="0" >Ready — I take the initiative</);
  assert.match(loser, /data-init="1" >Ready — they take it</);
  const asked = matchRoomHtml(room({ concedeAsk: true }));
  assert.match(asked, /Concede the match\? You lose it\./);
  for (const b of ['cc-concede-yes', 'cc-concede-no']) assert.ok(btns(asked).includes(b), b);
});

test('973 §5 paused; and a match that ended while the page waited', () => {
  const paused = matchRoomHtml(room({ w: lobby({ phase: 'paused', pause: { offeredBy: null, pausedAt: 0, resume: [false, true], voidAt: null } }) }));
  assert.match(paused, /<div class="zonelabel">Paused<\/div>/);
  assert.match(paused, /data-btn="cc-resume" >Resume<\/button>/);
  assert.match(paused, /Bo wants to resume\./);
  assert.doesNotMatch(paused, /ccboard|data-cc-until/, 'no sideboarding, no countdown');
  const away = matchRoomHtml(room({ peers: [true, false], w: lobby({ phase: 'paused', pause: { offeredBy: null, pausedAt: 0, resume: [false, false] } }) }));
  assert.match(away, /data-btn="cc-resume" disabled>Resume/);
  const ended = { id: 'M1', bestOf: 3 as const, score: [2, 1] as [number, number], game: 3, phase: 'over' as const, room: '', result: { winner: 0 as const, how: 'games' as const, at: 1 } };
  const html = matchRoomHtml(room({ ended }));
  assert.match(html, /<div class="ccresult won"><b>You win the match 2–1\.<\/b>/);
  assert.match(html, /data-btn="gohome">Return to home/);
  assert.match(matchResultHtml({ ...ended, phase: 'void' }, 0, ['Ann', 'Bo']), /closed with no result/);
});

test('973 §6 names, rooms and cards are escaped', () => {
  const w = lobby({ names: ['<A>', '<B>'], mine: { registered: { main: [card('<x>'), ...MAIN.slice(1)], side: SIDE }, current: { main: [card('<x>'), ...MAIN.slice(1)], side: SIDE }, presets: [] } });
  const html = matchRoomHtml(room({ w, shown: w.mine!.current, room: '<R>', error: '<e>' }));
  assert.doesNotMatch(html, /<B>|<R>|<e>|<x>/);
  assert.match(html, /&lt;e&gt;/);
});
