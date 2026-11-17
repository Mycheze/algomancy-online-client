/* 1493 — A BOX FOR A USERNAME TAKES NO MORE THAN THE SERVER ACCEPTS.
 *
 * The server refuses a username over USERNAME_MAX (client/shared/username.ts;
 * server/test/1494 pins that side). A box that lets a player type past it only
 * says so after they press the button, so every such box stops at the limit.
 *
 *   §1 the post-game keep-it forms, the guest's and the signed-out seat's, drawn
 *   §2 the sign-in and create-account form, drawn
 *   §3 a census: every <input> in ui/ that takes a username caps it at USERNAME_MAX
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { USERNAME_MAX } from '../../shared/username.ts';
import { postGameHtml, type PostGameView } from '../pages/postgame.ts';
import { signinHtml, signinView } from '../pages/signin.ts';
import type { GameOver } from '../postgame.ts';

const seat = (name: string): GameOver['seats'][0] => ({
  name, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0,
  cardElements: {}, recycled: {}, resourcesActivated: 0, abilitiesActivated: 0,
  attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, cardsDrafted: 0, lifeLeft: 0,
});
const OVER: GameOver = {
  seat: 0, winner: 0, names: ['Ann', 'Bo'], mode: 'draft', els: ['fire', 'wood', 'water'], turns: 7,
  seats: [seat('Ann'), seat('Bo')], rematch: [false, false], rematchRoom: null, recorded: true,
};
const view = (v: Partial<PostGameView>): PostGameView => ({
  over: OVER, modeLabel: 'live draft', elements: '', guest: false, signup: null, matchResult: '', ...v,
});

/** the maxlength of the one <input> in `html` whose tag matches `which` */
function maxOf(html: string, which: RegExp): number | null {
  const tags = [...html.matchAll(/<input\b[^>]*>/g)].map(m => m[0]).filter(t => which.test(t));
  assert.equal(tags.length, 1, `one input matches ${which}`);
  const m = /maxlength="(\d+)"/.exec(tags[0]!);
  return m ? Number(m[1]) : null;
}

test('BL-10 1493 §1 the post-game keep-it forms stop a username at the server\'s limit', () => {
  assert.equal(USERNAME_MAX, 20, 'positive control: the limit the server enforces today');
  const guest = postGameHtml(view({ guest: true }));
  assert.match(guest, /data-form="pg-claim"/, 'the guest\'s form is drawn');
  assert.equal(maxOf(guest, /name="username"/), USERNAME_MAX, 'Keep it: the guest\'s username box');
  const signup = postGameHtml(view({ signup: { form: true } }));
  assert.match(signup, /data-form="pg-signup"/, 'the signed-out seat\'s form is drawn');
  assert.equal(maxOf(signup, /id="pg-su-user"/), USERNAME_MAX, 'Sign up and keep it: the username box');
});

test('BL-10 1493 §2 sign in and create an account stop a username at the server\'s limit', () => {
  for (const mode of ['login', 'register'] as const) {
    const html = signinHtml(signinView({ mode, me: null, msg: '', busy: false }));
    assert.equal(maxOf(html, /id="a-user"/), USERNAME_MAX, `${mode}: the username box`);
  }
});

test('BL-10 1493 §3 census: every username box in ui/ is capped at USERNAME_MAX', () => {
  const root = new URL('../', import.meta.url);
  const files = [
    ...readdirSync(root).filter(f => f.endsWith('.ts')),
    ...readdirSync(new URL('pages/', root)).filter(f => f.endsWith('.ts')).map(f => `pages/${f}`),
    ...readdirSync(new URL('components/', root)).filter(f => f.endsWith('.ts')).map(f => `components/${f}`),
  ];
  let seen = 0;
  const bad: string[] = [];
  for (const f of files) {
    const src = readFileSync(new URL(f, root), 'utf8');
    for (const m of src.matchAll(/<input\b[^>]*>/g)) {
      const tag = m[0];
      if (/\bhidden\b|type="(?:password|hidden)"/.test(tag)) continue;
      if (!/username|player name|"a name"/i.test(tag)) continue;
      seen++;
      if (!tag.includes('maxlength="${USERNAME_MAX}"')) bad.push(`${f}: ${tag.replace(/\s+/g, ' ')}`);
    }
  }
  assert.ok(seen >= 6, `non-vacuous: ${seen} username boxes found`);
  assert.deepEqual(bad, [], 'each takes maxlength="${USERNAME_MAX}" from client/shared/username.ts');
});
