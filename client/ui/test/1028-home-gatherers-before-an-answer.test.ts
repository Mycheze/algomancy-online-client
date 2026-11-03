/* 1028 — THE NEW HOME'S LEAGUE AND CHALLENGE GATHERERS, BEFORE THE SERVER HAS
 * ANSWERED (docs/24, 2026-11-03).
 *
 * The home calls ui/league.ts hasLeague / homeGlanceHtml / joinRowsHtml /
 * joinCount and ui/challenge.ts hasChallenge / homeGlanceHtml on every paint.
 * Each asks the server once (the banner's own askHint) and must answer
 * "nothing yet" — never throw — until that answer lands: no button live, no
 * glance, no rows, a count of 0. No DOM here; storage and the fetch are stubbed to never
 * answer, and it is asked exactly once per module however often the home paints.
 *
 * §1 the league: no season yet
 * §2 the challenge: no week yet
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const asked: string[] = [];
const store = new Map<string, string>();
(globalThis as Record<string, unknown>)['localStorage'] = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); },
};
(globalThis as Record<string, unknown>)['fetch'] = (url: string) => { asked.push(String(url)); return new Promise(() => {}); };

const lg = await import('../league.ts');
const chal = await import('../challenge.ts');

test('1028 §1 the league before its answer: nothing to show, asked once', () => {
  for (let i = 0; i < 3; i++) {
    assert.equal(lg.hasLeague(), false);
    assert.equal(lg.homeGlanceHtml(), '');
    assert.equal(lg.joinRowsHtml(), '');
    assert.equal(lg.joinCount(), 0);
  }
  assert.deepEqual(asked.filter(u => u.startsWith('/api/league')), ['/api/league'], 'one request, however often the home paints');
});

test('1028 §2 the challenge before its answer: nothing to show, asked once', () => {
  for (let i = 0; i < 3; i++) {
    assert.equal(chal.hasChallenge(), false);
    assert.equal(chal.homeGlanceHtml(), '');
  }
  assert.equal(asked.filter(u => u.startsWith('/api/challenge')).length, 1, 'one request, however often the home paints');
});
