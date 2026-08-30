/* ui/decks.ts — the collection loader's RE-ENTRANCY CONTRACT.
 *
 * This file exists because of a bug that shipped, and the shape of it is worth
 * stating: `ensureCollection(then)` used to call `then()` on the
 * nothing-to-do path — the reading that looks obviously correct, because "make
 * sure it is loaded, then do this" wants the callback either way.
 *
 * On the home screen `then` IS `renderHome`, because main.ts's
 * `wireDeckPicker(renderHome)` passes it in, and `renderHome` ends by calling
 * `wireDeckPicker` again. So once the collection was loaded, every home render
 * re-entered itself: ONE CLICK REPAINTED THE HOME SCREEN 2,696 TIMES and took
 * 2.3 seconds, measured in a real browser. `ensureDefaultDecks` in main.ts had
 * always returned bare on that path; the new loader did not match it.
 *
 * ⚠ WHY THE BROWSER TEST DID NOT CATCH IT. There was one, and it passed: it
 * asserted that the picker ENDED UP listing the right decks, which it did —
 * after 2,696 renders. **Asserting the end state cannot see the cost of
 * reaching it.** That is what this file is for, and why every assertion below
 * counts calls rather than inspecting a result.
 *
 * The module is driven with `fetch` and `localStorage` stubs rather than a
 * browser: the contract is about how many times things are called, which is
 * exactly what a stub can see and a screenshot cannot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** the two globals ui/decks.ts reaches for, before it is imported */
let token: string | null = 'a-token';
let fetches = 0;
/** resolve the in-flight fetch by hand, so "while loading" is a real state */
let release: (() => void) | null = null;

const g = globalThis as unknown as { localStorage: unknown; fetch: unknown };
g.localStorage = {
  getItem: (k: string) => (k === 'algoToken' ? token : null),
  setItem: () => {}, removeItem: () => {},
};
g.fetch = (url: string) => {
  fetches++;
  return new Promise(resolve => {
    release = () => resolve({
      status: 200,
      json: () => Promise.resolve({
        ok: true,
        decks: [{
          id: 'd1', name: 'a deck', cards: [], maybe: [], cover: null,
          author: 'you', createdAt: '', updatedAt: '', problems: [], record: {
            games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null,
          },
        }],
      }),
    } as unknown as Response);
  });
};

const dk = await import('../../ui/decks.ts');

/** run one ensureCollection and report what it cost */
async function call(): Promise<{ callbacks: number; fetched: number }> {
  const before = fetches;
  let callbacks = 0;
  dk.ensureCollection(() => { callbacks++; });
  // let the fetch settle if one was started
  if (release) { release(); release = null; await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)); }
  return { callbacks, fetched: fetches - before };
}

test('§1 signed out: no fetch, and NO CALLBACK — the caller must not be re-entered', async () => {
  token = null;
  dk.resetCollection();
  const r = await call();
  assert.equal(r.fetched, 0, 'a logged-out browser has no collection to ask for');
  assert.equal(r.callbacks, 0,
    'the callback is the home render; firing it here re-enters the render that called us');
  token = 'a-token';
});

test('§2 the first call fetches once and calls back once', async () => {
  dk.resetCollection();
  const r = await call();
  assert.equal(r.fetched, 1);
  assert.equal(r.callbacks, 1, 'a load that really happened must repaint whoever asked');
});

test('§3 ⭐ once loaded, calling again does NOTHING — this is the 2,696-render bug', async () => {
  dk.resetCollection();
  await call();                     // load it
  const again = await call();
  assert.equal(again.fetched, 0, 'the collection is already here');
  assert.equal(again.callbacks, 0,
    'THE REGRESSION: `then()` here is renderHome, which calls ensureCollection again — '
    + 'one click repainted the home screen 2,696 times and took 2.3s');

  // and it stays inert however many times the render loop comes round
  let extra = 0;
  for (let i = 0; i < 50; i++) dk.ensureCollection(() => { extra++; });
  assert.equal(extra, 0, 'fifty home renders must cost zero callbacks, not fifty');
  assert.equal(fetches > 0, true, 'positive control: the stub fetch is reachable at all');
});

test('§4 concurrent calls while a load is in flight fetch once and call back once', async () => {
  dk.resetCollection();
  let callbacks = 0;
  const before = fetches;
  // three renders in the same tick, which is what a burst of clicks looks like
  for (let i = 0; i < 3; i++) dk.ensureCollection(() => { callbacks++; });
  assert.equal(fetches - before, 1, 'the `loading` latch collapses the burst to one request');
  release!(); release = null;
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  assert.equal(callbacks, 1, 'and only the call that owns the fetch repaints');
});

test('§5 resetCollection makes it loadable again (logging out and back in)', async () => {
  dk.resetCollection();
  await call();
  assert.equal((await call()).fetched, 0, 'loaded');
  dk.resetCollection();
  assert.equal((await call()).fetched, 1, 'and forgetting it lets the next login load afresh');
});
