/* 972 — THE POST-GAME SCREEN, DRAWN WITHOUT A PAGE (design-system round, 2026-11-03).
 *
 * The screen left ui/postgame.ts for pages/postgame.ts as view → pure html;
 * what the account says (a guest, the sign-up offer) and the markup other
 * modules draw (the elements line, a match result) come in through the view.
 * Driven here with made-up views, no DOM and no account.
 *
 * §1 a win, a loss, a draw: the title, the box's colour, the stat table
 * §2 the rematch button's four states, and Dispute
 * §3 a Competitive match: Continue in place of Rematch, and the result once it is over
 * §4 the keep-it offers: the guest's, the signed-out seat's form, and the outcome's note slot
 * §5 the three ways out are always there, and Join matchmaking queue is live
 * §6 names are escaped
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postGameHtml, type PostGameView } from '../pages/postgame.ts';
import type { GameOver } from '../postgame.ts';

const seat = (name: string, over: Partial<GameOver['seats'][0]> = {}): GameOver['seats'][0] => ({
  name, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0,
  cardElements: {}, recycled: {}, resourcesActivated: 0, abilitiesActivated: 0,
  attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, cardsDrafted: 0, lifeLeft: 0, ...over,
});
const OVER: GameOver = {
  seat: 0, winner: 0, names: ['Ann', 'Bo'], mode: 'draft', els: ['fire', 'wood', 'water'], turns: 7,
  seats: [seat('Ann', { lifeLeft: 12, unitsPlayed: 5, cards: { 'Ignis Sprite': 3 }, cardElements: { fire: 4 } }), seat('Bo', { unitsPlayed: 7 })],
  rematch: [false, false], rematchRoom: null, recorded: true,
};
function view(over: Partial<GameOver> = {}, v: Partial<PostGameView> = {}): PostGameView {
  return {
    over: { ...OVER, ...over }, modeLabel: 'live draft', elements: '<!--SLOT:elements-->',
    guest: false, signup: null, matchResult: '', ...v,
  };
}
/** the row of buttons, as their data-btn (or their text when there is none) */
function buttons(html: string): string[] {
  const row = /<div class="pgbtns">([\s\S]*?)<\/div>/.exec(html);
  assert.ok(row, 'the button row is drawn');
  return [...row[1]!.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)]
    .map(m => /data-btn="([^"]+)"/.exec(m[1]!)?.[1] ?? m[2]!.trim());
}

test('972 §0 positive control: there is no DOM here', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined');
  assert.match(postGameHtml(view()), /^<div class="overlay pgover">/);
});

test('972 §1 a win, a loss, a draw', () => {
  const won = postGameHtml(view());
  assert.match(won, /<div class="pgbox won">/);
  assert.match(won, /<h2 class="pgtitle">You win!<\/h2>/);
  assert.match(won, /live draft · 7 turns · <!--SLOT:elements-->/);
  assert.match(won, /<td class="pgnum lead">12<\/td>\s*<th scope="row" class="pglabel">life left<\/th>/);
  assert.match(won, /<td class="pgnum lead">7<\/td>/, 'Bo played more units');
  assert.doesNotMatch(won, /spells played/, 'a 0–0 row is dropped');
  assert.match(won, /<span class="acctel fire">fire<\/span>/);
  assert.match(won, /Ignis Sprite ×3/);
  assert.match(won, /Recorded to your profile\./);
  assert.match(postGameHtml(view({ winner: 1 })), /<div class="pgbox lost">[\s\S]*Bo wins/);
  assert.match(postGameHtml(view({ winner: null })), /<div class="pgbox ">[\s\S]*Game over/);
  assert.doesNotMatch(postGameHtml(view({}, { elements: null })), / · <!--SLOT/, 'no elements: no separator');
});

test('972 §2 rematch: ask, wait, accept theirs, starting; and Dispute beside it', () => {
  assert.equal(buttons(postGameHtml(view()))[0], 'pg-rematch');
  const waiting = buttons(postGameHtml(view({ rematch: [true, false] })));
  assert.deepEqual(waiting.slice(0, 2), ['Waiting for Bo…', 'pg-rematch-cancel']);
  assert.match(postGameHtml(view({ rematch: [false, true] })), /class="[^"]*pgwants" data-btn="pg-rematch" type="button">Bo wants a rematch — accept</);
  assert.match(postGameHtml(view({ rematchRoom: 'NEXT' })), /data-btn="pg-goto-rematch" type="button" data-room="NEXT">Starting the rematch…</);
  const dispute = buttons(postGameHtml(view({ disputable: true, disputed: [false, false] })));
  assert.deepEqual(dispute.slice(0, 2), ['pg-rematch', 'pg-dispute']);
  assert.match(postGameHtml(view({ disputable: true, disputed: [true, false] })), /<button[^>]* disabled>Disputed<\/button>/);
  assert.match(postGameHtml(view({ disputable: true, disputed: [false, true] })), /Bo disputed this result\./);
});

test('972 §3 a Competitive match: Continue, then the result and New match', () => {
  const match = { id: 'M', bestOf: 3 as const, score: [1, 0] as [number, number], game: 2, phase: 'between' as const, room: 'NEXT' };
  const going = postGameHtml(view({ match }));
  assert.equal(buttons(going)[0], 'pg-continue');
  assert.ok(!buttons(going).includes('pg-rematch'), 'no Rematch in a match');
  assert.match(going, /data-room="NEXT">Continue to game 2</);
  assert.match(going, /Best of 3 · you lead 1–0 after 1 game\./);
  const done = postGameHtml(view({ match: { ...match, phase: 'over' } }, { matchResult: '<!--SLOT:result-->' }));
  assert.match(done, /<div class="pgnote pgmatch"><!--SLOT:result--><\/div>/);
  assert.match(done, /data-btn="pg-newmatch" type="button" data-bo="3">New match</);
});

test('972 §4 keep it: the guest form, the signed-out form, the outcome note', () => {
  const guest = postGameHtml(view({}, { guest: true }));
  assert.match(guest, /<form class="pgclaim" data-form="pg-claim">/);
  assert.match(guest, /data-btn="pg-claim" type="button">Keep it</, 'type="button": a submit would GET the password into the address');
  const form = postGameHtml(view({}, { signup: { form: true } }));
  assert.match(form, /id="pg-su-form" data-form="pg-signup"/);
  assert.match(form, /DO NOT FORGET YOUR PASSWORD\. THERE IS NO PASSWORD RESET\./);
  assert.match(form, /data-btn="pg-signup" type="button">Sign up and keep it</);
  const note = postGameHtml(view({}, { signup: { note: '<!--SLOT:signupNote-->' } }));
  assert.match(note, /<!--SLOT:signupNote-->/);
  assert.doesNotMatch(note, /pg-su-form/);
  assert.doesNotMatch(postGameHtml(view()), /pgclaim/, 'nothing to keep: no form');
});

test('972 §5 the ways out: home, the queue (live), and a look at the final board', () => {
  const html = postGameHtml(view());
  assert.deepEqual(buttons(html).slice(-2), ['pg-home', 'pg-queue']);
  assert.doesNotMatch(html, /data-btn="pg-queue"[^>]*disabled/, 'Join matchmaking queue was a disabled placeholder once; it is live');
  assert.match(html, /<button class="pgpeek" data-btn="pg-close">View the final board<\/button>/);
});

test('972 §6 names are escaped', () => {
  const html = postGameHtml(view({ winner: 1, names: ['<A>', '<B>'], rematch: [false, true] }));
  assert.doesNotMatch(html, /<A>|<B>/);
  assert.match(html, /&lt;B&gt; wins/);
  assert.match(html, /&lt;B&gt; wants a rematch/);
});
