/* 1338 — THE TOURNAMENT (docs/25 §7, §8, §10), DOM-free.
 *
 * §1 the tabs: Standings · Round · Matches · Players; Round robin's Round is its Schedule; Exhibition has none
 * §2 Your match: Play, a bye, a match done, the Deck button off while in a match
 * §3 every live match not mine has Watch (a spectator link that knows its event); mine has none
 * §4 the host: a Result button per match and its sheet; Drop / Put back on the Players tab
 * §5 the break: the countdown for all, the host's pairings sheet (tap two to swap, Post now)
 * §6 Exhibition: the big Ready switch
 * §7 the banner when a match is found
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubeHtml } from '../pages/cube.ts';
import { CONFIG, eventView, match, NOW, pageView, PLAYERS, tagOf } from './cube-fixture.ts';

const play = (over: Parameters<typeof eventView>[1] = {}, page: Parameters<typeof pageView>[0] = {}): string =>
  cubeHtml(pageView({ event: eventView('playing', over), ...page }));

const tabs = (html: string): string[] => [...html.matchAll(/data-btn="cube-tab"[^>]*data-v="([a-z]+)"[^>]*>([^<]+)</g)].map(m => `${m[1]}:${m[2]}`);

test('1338 §1 the tabs', () => {
  assert.deepEqual(tabs(play()), ['standings:Standings', 'round:Round', 'matches:Matches', 'players:Players']);
  assert.deepEqual(tabs(play({ config: { ...CONFIG, tournament: 'roundrobin' } })), ['standings:Standings', 'round:Schedule', 'matches:Matches', 'players:Players']);
  assert.deepEqual(tabs(play({ config: { ...CONFIG, tournament: 'exhibition' } })), ['standings:Standings', 'matches:Matches', 'players:Players']);
  const st = play();
  assert.match(st, /<th[^>]*>OMW<\/th>/);
  assert.match(st, /data-scroll="cube-tab-standings"/);
  const round = play({}, { tab: 'round' });
  assert.match(round, /Round 2 of 3/);
  assert.match(round, /data-scroll="cube-tab-round"/);
  assert.doesNotMatch(round, /r1p1/, 'only this round');
  const sched = play({ config: { ...CONFIG, tournament: 'roundrobin' } }, { tab: 'round' });
  assert.match(sched, /Round 1<\/h3>[^]*Round 2<\/h3>/, 'the whole schedule, by round');
  // a tab the format does not have falls back to Standings
  assert.match(play({ config: { ...CONFIG, tournament: 'exhibition' } }, { tab: 'round' }), /data-scroll="cube-tab-standings"/);
});

test('1338 §2 Your match', () => {
  const html = play();
  assert.match(html, /<p class="cubebig">vs Di<\/p>/);
  assert.match(html, /data-btn="cube-play"[^>]*data-pairing="r2p1"[^>]*>Play</);
  assert.doesNotMatch(tagOf(html, 'cube-build'), /disabled/, 'between matches the deck can change');
  const inMatch = play({ players: PLAYERS.map(p => (p.user === 'u1' ? { ...p, inMatch: true } : p)), myMatch: match('r2p1', 2, 0, 3, 'live', { room: 'RM' }) });
  assert.match(inMatch, /data-btn="cube-play"[^>]*>Back to your match</);
  assert.match(tagOf(inMatch, 'cube-build'), /disabled/, 'no deck changes during a match');
  const bye = play({ myMatch: match('r2p9', 2, 0, null, 'done', { score: 'Bye' }) });
  assert.match(bye, /A bye in round 2/);
  assert.equal(tagOf(bye, 'cube-play'), '');
  const done = play({ myMatch: match('r2p1', 2, 0, 3, 'done', { score: '2–1', winner: 'u1' }) });
  assert.match(done, /You won\. Waiting for the others to finish\./);
  const dropped = play({ players: PLAYERS.map(p => (p.user === 'u1' ? { ...p, dropped: true } : p)) });
  assert.match(dropped, /You have dropped out of this event\./);
});

test('1338 §3 Watch on every live match but mine', () => {
  const html = play({}, { tab: 'matches' });
  assert.match(html, /href="\/\?ws=1&amp;room=RR2P2&amp;watch=1&amp;cube=QZXV"|href="\/\?ws=1&room=RR2P2&watch=1&cube=QZXV"/, 'the live Bo–Cy match');
  assert.equal((html.match(/>Watch</g) ?? []).length, 1, 'one live match, one Watch');
  const mine = play({ matches: [match('r2p1', 2, 0, 3, 'live', { room: 'RM' })] }, { tab: 'matches' });
  assert.doesNotMatch(mine, />Watch</, 'not my own match');
  assert.match(html, /<b>1–0<\/b> <span class="dim">Ann<\/span>/, 'a decided match: its score and winner');
});

test('1338 §4 the host edits results and drops players', () => {
  const html = play({}, { tab: 'matches' });
  assert.ok(tagOf(html, 'cube-result-open', 'data-pairing="r1p1"'), 'a Result button per match');
  assert.equal(tagOf(play({ me: 'u2' }, { tab: 'matches' }), 'cube-result-open'), '', 'a player has none');
  const sheet = play({}, { sheet: { kind: 'result', pairing: 'r1p1' } });
  // a win is the winner's account id, as the server takes it
  for (const o of ['u1', 'u2', 'draw', 'clear']) assert.ok(tagOf(sheet, 'cube-result', `data-outcome="${o}"`), `outcome ${o}`);
  assert.match(tagOf(sheet, 'cube-result', 'data-outcome="u1"'), /aria-pressed="true"|class="[^"]* on/, 'Ann won it');
  const live = play({}, { sheet: { kind: 'result', pairing: 'r2p2' } });
  assert.match(live, /This match is being played\. Setting a result ends it\./);
  const players = play({}, { tab: 'players' });
  assert.match(tagOf(players, 'cube-drop', 'data-user="u2"'), /data-on="1"/);
  assert.equal(tagOf(players, 'cube-drop', 'data-user="u1"'), '', 'not the host');
  assert.match(players, /No deck/, 'Cy has no deck in');
  const back = play({ players: PLAYERS.map(p => (p.user === 'u3' ? { ...p, dropped: true } : p)) }, { tab: 'players' });
  assert.match(back, /data-btn="cube-drop"[^>]*data-user="u3"[^>]*data-on="0"[^>]*>Put back</);
  assert.ok(tagOf(play(), 'cube-end'), 'End the event');
});

test('1338 §5 the break and the host\'s pairings', () => {
  const pending = [match('r3p1', 3, 0, 1, 'waiting'), match('r3p2', 3, 2, 3, 'waiting')];
  const host = play({ breakUntil: NOW + 72_000, pending, myMatch: null });
  assert.match(host, /Round 3 in <span class="cubeclock" data-cube-until="\d+">1:12<\/span>/);
  assert.ok(tagOf(host, 'cube-pairings'));
  const player = play({ me: 'u2', breakUntil: NOW + 72_000, pending: null, myMatch: null });
  assert.match(player, /Round 3 in/);
  assert.equal(tagOf(player, 'cube-pairings'), '');
  const sheet = play({ breakUntil: NOW + 72_000, pending }, { sheet: { kind: 'pairings' } });
  for (const u of ['u1', 'u2', 'u3', 'u4']) assert.ok(tagOf(sheet, 'cube-swap', `data-user="${u}"`), `${u} can be swapped`);
  assert.ok(tagOf(sheet, 'cube-post'), 'Post now');
  assert.match(sheet, /Tap two players to swap them\./);
  const picked = play({ breakUntil: NOW + 72_000, pending }, { sheet: { kind: 'pairings' }, swapPick: 'u2' });
  assert.match(tagOf(picked, 'cube-swap', 'data-user="u2"'), /aria-pressed="true"/);
  assert.match(picked, /Now tap who Bo swaps with\./);
});

test('1338 §6 Exhibition: the Ready switch', () => {
  const ex = { ...CONFIG, tournament: 'exhibition' as const };
  const ready = play({ config: ex, myMatch: null });
  assert.match(tagOf(ready, 'cube-ready'), /aria-pressed="true"[^>]*data-on="0"|data-on="0"[^>]*aria-pressed="true"/);
  assert.match(ready, /Looking for someone you have not played\./);
  const off = play({ config: ex, myMatch: null, players: PLAYERS.map(p => (p.user === 'u1' ? { ...p, ready: false } : p)) });
  assert.match(tagOf(off, 'cube-ready'), /data-on="1"/);
  assert.match(off, /Taking a break/);
  const busy = play({ config: ex, players: PLAYERS.map(p => (p.user === 'u1' ? { ...p, inMatch: true } : p)) });
  assert.equal(tagOf(busy, 'cube-ready'), '', 'no switch during a match');
});

test('1338 §7 the banner', () => {
  const html = play({}, { banner: match('r2p1', 2, 0, 3, 'waiting') });
  assert.match(html, /Your match is ready: <b>vs Di<\/b>/);
  assert.ok(tagOf(html, 'cube-banner-close'));
  assert.equal((html.match(/data-btn="cube-play"/g) ?? []).length, 2, 'Play on the banner and on Your match');
});
