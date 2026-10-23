/* docs/21 Watch — the replay bar says what the server found, never a
 * hard-coded "as recorded" (report round 2026-10-23).
 *
 * Watch (`?challenge=watch&run=<id>`) used to open every run as
 * `verdict: 'as-recorded', partedAt: null, refusedAt: null`, whatever the
 * engine now made of it — so a run whose rules had changed since played a
 * different game under the green badge. The run route now carries the
 * verdict (server/challenge-resim.ts, test 597): this page must pass it on,
 * and a run with no verdict at all (no fingerprints, or a server older than
 * them) is UNVERIFIED, not as recorded.
 *
 * And the board (owner, 2026-10-23, "Flag it, still ranked"): a run the
 * rules moved under keeps its rank and score, and says so.
 *
 * Each case is its own page — one main.ts per process — so each runs in a
 * child, through the same ui-driver, differing only in what the server said.
 *
 *   §1 faithful: "as recorded"
 *   §2 parted: "reconstruction from action N", and the detail says so
 *   §3 refused: the detail names where this engine first refused
 *   §4 unconfirmed: no verdict on the wire reads "faithfulness unverified"
 *   §5 the board marks an older-rules run, with the reason on hover
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { getCard } from '../../engine/src/cards/dsl.ts';
import { newChallengeGame, type ChallengeDef } from '../../engine/src/challenge.ts';

const DEF: ChallengeDef = { id: 'w598', week: '2026-10-11', title: 'Watched', blurb: '', goal: { kind: 'unitsPlayed', n: 1 }, seed: 59800, par: 1 };
const UNIT = DECK_LIST.find(n => getCard(n).kind === 'unit')!;
const DECK = Array.from({ length: 12 }, () => UNIT);
const ACTIONS = newChallengeGame(DEF, DECK).actions;
const CAL = { now: 1, current: null, past: [{ ...DEF, opens: 0, closes: 1, closed: true, entrants: 2 }] };
const SCORE = { unique: 1, extra: 0, cards: 1, elements: 1, turns: 1, raw: 1, skill: 100 };

/** a page at `search`, whose server answers `answers[url]`; what it painted,
 * and (for a replay) what it says once the verdict chip is opened */
function page(search: string, answers: Record<string, unknown>): { html: string; detail: string } {
  const src = `
    import { readFileSync } from 'node:fs';
    const { search, answers } = JSON.parse(readFileSync(0, 'utf8'));
    globalThis.__UI_DRIVER_SEARCH = search;
    globalThis.__UI_DRIVER_FETCH = async url => {
      const hit = Object.keys(answers).find(k => url.startsWith(k));
      return hit ? { status: 200, ok: true, json: async () => answers[hit] } : new Promise(() => {});
    };
    const { home } = await import('./ui-driver.ts');
    for (let i = 0; i < 60; i++) await Promise.resolve();
    const ui = home();
    const html = ui.html();
    let detail = '';
    if (ui.has({ replay: 'detail' })) { ui.click({ replay: 'detail' }); detail = ui.html(); }
    process.stdout.write('###' + JSON.stringify({ html, detail }));
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', src], {
    cwd: import.meta.dirname, input: JSON.stringify({ search, answers }), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out.slice(out.indexOf('###') + 3)) as { html: string; detail: string };
}

const watch = (verdict: Record<string, unknown>): { html: string; detail: string } => page('?challenge=watch&run=run598', {
  '/api/challenge/run/': { runId: 'run598', challengeId: DEF.id, name: 'Ann', deck: DECK, actions: ACTIONS, score: SCORE, at: 1, ...verdict },
  '/api/challenge': CAL,
});
const chip = (html: string): string => /class="replaychip [^"]*"[^>]*>([^<]*)</.exec(html)?.[1] ?? '(no chip)';

test('docs/21 Watch / report round 2026-10-23 §1 a faithful run reads as recorded', () => {
  const p = watch({ verdict: 'as-recorded', partedAt: null, refusedAt: null });
  assert.match(p.html, /class="replayroom">Watched</, 'non-vacuous: the replay is open');
  assert.equal(chip(p.html), 'as recorded');
});

test('docs/21 Watch / report round 2026-10-23 §2 a run that parted reads as a reconstruction from that action', () => {
  const p = watch({ verdict: 'reconstruction', partedAt: 2, refusedAt: null });
  assert.equal(chip(p.html), 'reconstruction from action 2');
  assert.match(p.detail, /The rules have changed since this game was played\. Up to action 2/);
  assert.doesNotMatch(p.detail, /ILLEGAL/, 'nothing was refused');
});

test('docs/21 Watch / report round 2026-10-23 §3 a refused run says where this engine first refused', () => {
  const p = watch({ verdict: 'reconstruction', partedAt: 2, refusedAt: 5 });
  assert.equal(chip(p.html), 'reconstruction from action 2');
  assert.match(p.detail, /Nothing became ILLEGAL until action 5/);
});

test('docs/21 Watch / report round 2026-10-23 §4 a run with no verdict is unverified, never as recorded', () => {
  for (const v of [{}, { verdict: 'unverified', partedAt: null, refusedAt: null }]) {
    const p = watch(v);
    assert.match(p.html, /class="replayroom">Watched</, 'non-vacuous: the replay is open');
    assert.equal(chip(p.html), 'faithfulness unverified', JSON.stringify(v));
    assert.doesNotMatch(p.html, />as recorded</);
  }
});

test('docs/21 Watch / report round 2026-10-23 §5 the board marks a run played on older rules and keeps its rank', () => {
  const row = (rank: number, name: string, older: boolean): Record<string, unknown> =>
    ({ rank, name, score: { ...SCORE, skill: 300 - rank }, at: 1, runId: `run-${name}`, deck: DECK, ...(older ? { older: true } : {}) });
  const p = page(`?challenge=1&board=${DEF.id}`, {
    [`/api/challenge/${DEF.id}/board`]: {
      id: DEF.id, closed: true,
      boards: Object.fromEntries(['fastest', 'leanest', 'purest', 'overall'].map(k => [k, [row(1, 'Tom', true), row(2, 'Lee', false)]])),
      winners: { fastest: row(1, 'Tom', true), leanest: row(2, 'Lee', false) },
    },
    '/api/challenge': CAL,
  });
  const rows = [...p.html.matchAll(/<tr><td>(\d+)<\/td><td>(.*?)<\/td>/g)].map(m => [m[1], m[2]]);
  assert.equal(rows.length, 2, `non-vacuous: the board is drawn (${p.html.slice(0, 200)})`);
  assert.match(rows[0]![1]!, /^Tom <span[^>]*title="The rules have changed since this run was played[^"]*Its score stands\."[^>]*>played on older rules<\/span>$/,
    'first, and marked');
  assert.doesNotMatch(rows[1]![1]!, /older rules/, 'an unmarked run is not');
  assert.match(p.html, /Fastest: <b>Tom<\/b> <span[^>]*>played on older rules</, 'the winners line too');
  assert.match(p.html, /Leanest: <b>Lee<\/b>(?! <span)/, '…and only on the marked winner');
});
