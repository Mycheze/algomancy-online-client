/* 1025 — THE WEEKLY CHALLENGE ON THE NEW HOME: THE CARD'S GLANCE (docs/24,
 * 2026-11-03).
 *
 * pages/challenge.ts challengeGlanceHtml draws the Challenge card's body from
 * challengeHomeView: this week's title and goal, the time left, and your
 * best. The whole card is the home's `nav-challenge` button, so the glance
 * has NO buttons (the old home card's Play is gone from it). No DOM here.
 *
 * §1 a current week, with and without your best
 * §2 no current week → '' (the card says "No challenge this week"); a past week still counts for `any`
 * §3 no buttons; the title is escaped
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RunScore } from '../../engine/src/challenge.ts';
import { challengeGlanceHtml, challengeHomeView, type ChallengeReply, type ChallengeView } from '../pages/challenge.ts';

const NOW = Date.UTC(2026, 10, 10, 18);
const DAY = 86_400_000;
const sc = (turns: number): RunScore => ({ unique: 9, extra: 0, cards: 9, elements: 2, turns, raw: 0, skill: 0 });
const week = (id: string, over: Partial<ChallengeView> = {}): ChallengeView => ({
  id, week: '2026-11-08', title: 'Full House', blurb: '', goal: { kind: 'unitsInPlay', n: 5 },
  seed: 1, par: 24, opens: NOW - 2 * DAY, closes: NOW + 3 * DAY + 5 * 3_600_000, closed: false, entrants: 7, ...over,
});
const reply = (over: Partial<ChallengeReply> = {}): ChallengeReply => ({ now: NOW, current: week('cur'), past: [], ...over });

test('1025 §1 this week: the goal, the time left, your best', () => {
  const plain = challengeGlanceHtml(challengeHomeView(reply(), NOW));
  assert.match(plain, /^<div class="chglance">/);
  assert.match(plain, /<div class="chgltitle">Full House<\/div>/);
  assert.match(plain, /<div class="chglgoal">Have 5 units in play at once<\/div>/);
  assert.match(plain, /<div class="chglmeta">3d 5h left<\/div>/, 'no run yet: no best');
  const best = challengeGlanceHtml(challengeHomeView(reply({
    mine: { cur: { fastest: { score: sc(4), rank: 2 }, leanest: { score: sc(4), rank: 1 }, purest: { score: sc(4), rank: 3 }, overall: { score: sc(4), rank: 2 } } },
  }), NOW));
  assert.match(best, /3d 5h left · your best: 4 turns \(#2 fastest\)/);
});

test('1025 §2 no current week: nothing (the card says so)', () => {
  const v = challengeHomeView(reply({ current: null, past: [week('old', { closed: true })] }), NOW);
  assert.equal(challengeGlanceHtml(v), '');
  assert.equal(v.any, true, 'a past week still opens the page');
  assert.equal(challengeHomeView(reply({ current: null }), NOW).any, false);
  assert.equal(challengeGlanceHtml(challengeHomeView(null, NOW)), '');
});

test('1025 §3 no buttons; the title is escaped', () => {
  const html = challengeGlanceHtml(challengeHomeView(reply({ current: week('cur', { title: 'Full <i>House</i>' }) }), NOW));
  assert.doesNotMatch(html, /<button|data-btn=/, 'the whole card is the button');
  assert.match(html, /Full &lt;i&gt;House&lt;\/i&gt;/);
});
