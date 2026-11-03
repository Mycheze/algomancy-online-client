/* 971 — THE DRAFT LOBBY AND THE TRIO REVEAL, DRAWN WITHOUT A PAGE (design-system round, 2026-11-03).
 *
 * The lobby left ui/lobby.ts for pages/lobby.ts as view → pure html; the
 * un-submitted choice now comes in through the view instead of being read off
 * the module. Driven here with made-up views, no DOM.
 *
 * §1 pick-one: the elements, the named one on, I'm ready only once named
 * §2 rank: the ranking in order, the rest, the two helper buttons
 * §3 locked in: everything disabled, Change my mind
 * §4 the opponent is away: the share bar and the friends slot; a league room says to use Discord
 * §5 the reveal: the trio, the working, Draft!
 * §6 names and the room are escaped
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lobbyHtml, revealHtml, type LobbyView } from '../pages/lobby.ts';

const METHODS = [
  { id: 'pick-one', label: 'One each', blurb: 'each names one' },
  { id: 'rank', label: 'Rank them', blurb: 'shared top picks win' },
  { id: 'fresh', label: 'Something new', blurb: 'never played' },
];
function view(over: Partial<LobbyView> = {}): LobbyView {
  return {
    lobby: { method: 'pick-one', methods: METHODS, locked: [false, false], mine: {} },
    seat: 0, names: ['Ann', 'Bo'], peers: [true, true], room: 'QXZZ', link: 'http://x/?room=QXZZ&seat=1',
    friends: '<!--SLOT:friends-->', pick: null, ranking: [], ready: false,
    ...over,
  };
}
const btns = (html: string): string[] => [...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!);

test('971 §0 positive control: there is no DOM here', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined');
  assert.match(lobbyHtml(view()), /^<div class="lobbypage">/);
});

test('971 §1 pick-one: the named element is on, and ready waits for it', () => {
  const none = lobbyHtml(view());
  assert.match(none, /Live draft — room <span class="roomcode">QXZZ<\/span>/);
  assert.match(none, /How should the trio be chosen\?/);
  assert.equal(btns(none).filter(b => b === 'lobby-method').length, 3, 'every method, each with its blurb');
  assert.match(none, /class="lobbymethod on"/);
  assert.match(none, /data-btn="lobby-lock" type="button" disabled>finish choosing first</);
  const named = lobbyHtml(view({ pick: 'fire', ready: true }));
  assert.match(named, /class="elchip fire on" data-btn="lobby-pick" data-el="fire"/);
  assert.match(named, /You named <b>fire<\/b>\./);
  assert.match(named, /data-btn="lobby-lock" type="button">I'm ready</);
  for (const b of ['gohome', 'lobby-method', 'lobby-pick', 'lobby-lock']) assert.ok(btns(named).includes(b), b);
});

test('971 §2 rank: numbered in order, the rest offered, the two helpers', () => {
  const html = lobbyHtml(view({ lobby: { ...view().lobby, method: 'rank' }, ranking: ['wood', 'fire'] }));
  assert.match(html, /Your ranking, best first/);
  assert.match(html, /<span class="ranknum">1<\/span>[^]*?wood[^]*?<span class="ranknum">2<\/span>[^]*?fire/);
  assert.ok(btns(html).includes('lobby-rank'), 'the unranked elements');
  assert.doesNotMatch(html, /data-btn="lobby-rank-clear"[^>]*disabled/, 'start over is live with a ranking');
  assert.match(html, /2\/\d+ ranked/);
  assert.match(lobbyHtml(view({ lobby: { ...view().lobby, method: 'rank' } })), /data-btn="lobby-rank-clear" type="button" disabled>start over/);
});

test('971 §3 locked in: the choice is frozen, and Change my mind is the way back', () => {
  const html = lobbyHtml(view({ lobby: { ...view().lobby, locked: [true, false] }, pick: 'fire', ready: true }));
  for (const m of html.matchAll(/<button class="(?:lobbymethod|elchip)[^>]*>/g)) assert.match(m[0], /disabled/);
  assert.match(html, /data-btn="lobby-unlock" type="button">Change my mind</);
  assert.doesNotMatch(html, /lobby-lock"/);
  assert.match(html, /Ann \(you\) — <b class="lockedin">ready<\/b>/);
});

test('971 §4 the opponent away: share the code (and invite a friend); a league room points at Discord', () => {
  const away = lobbyHtml(view({ peers: [true, false] }));
  assert.match(away, /Send your opponent the room code <b>QXZZ<\/b>/);
  assert.match(away, /<!--SLOT:friends-->/);
  assert.match(away, /<i class="seatdot away"><\/i>\s*<span>Bo — has not arrived yet/);
  assert.doesNotMatch(lobbyHtml(view()), /sharebar/, 'both here: nothing to share');
  const league = lobbyHtml(view({ peers: [true, false], lobby: { ...view().lobby, method: 'random' } }));
  assert.match(league, /League match — room/);
  assert.match(league, /tell them on Discord you are here/);
  assert.doesNotMatch(league, /sharebar|SLOT:friends/);
  const custom = lobbyHtml(view({ custom: { summary: ['Packs of 5'], excluded: 1 } }));
  assert.match(custom, /Custom live draft — room/);
  assert.match(custom, /1 card left out\./);
});

test('971 §5 the reveal: the trio, how, the working, Draft!', () => {
  const html = revealHtml({ els: ['fire', 'wood', 'water'], how: 'You both ranked fire first', detail: ['drawn <2>'] });
  assert.equal((html.match(/class="elchip \w+ on"/g) ?? []).length, 3);
  assert.match(html, /<div class="triohow">You both ranked fire first<\/div>/);
  assert.match(html, /<li>drawn &lt;2&gt;<\/li>/);
  assert.match(html, /class="ui-button ui-button--primary" data-btn="trio-ok" type="button">Draft!</);
});

test('971 §6 names and the room are escaped', () => {
  const html = lobbyHtml(view({ names: ['<A>', '<B>'], room: '<R>', peers: [true, false] }));
  assert.doesNotMatch(html, /<A>|<B>|<R>/);
  assert.match(html, /&lt;A&gt; \(you\)/);
});
