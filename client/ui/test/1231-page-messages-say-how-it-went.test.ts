/* 1231 · THE LEAGUE, CHALLENGE, METAGAME AND CARD STATS PAGES SAY HOW IT WENT
 * (BL-10, the visual polish pass, 2026-11-12).
 *
 * Four pages wrote their message line as `<div class="acctmsg">`, and
 * `.acctmsg` has no CSS at all (inventory 02 §8.1 item 2: "Action results and
 * errors on two pages are bare text"; 03 §0.3 for the metagame and card stats;
 * 02 §8.5 item 28: "looks the same for success and failure"). So the League
 * page's "Saved." and its "could not reach the server" were the same plain
 * text, as were the metagame's "Copied into your collection" and "could not
 * copy that deck", and none of them was read out (02 §8.6 item 37).
 *
 * Each controller (ui/league.ts, challenge.ts, meta.ts, cardstats.ts) now
 * sets its line through one `say(text, tone)`, and the page draws it with the
 * status component in that tone: a refusal red and `role="alert"`, a result
 * green and `role="status"`, a step on its way ("copying…") or card stats'
 * "only N games match these filters" in the note gold.
 *
 *   §1 the pages, rendered from their stories: each tone draws as itself
 *   §2 the census: no page writes `acctmsg`, every page draws its line with
 *      the view's tone, and no controller sets `msg` except through say()
 *   §3 the tones: in the controllers, a "could not…" or a server's r.error
 *      is said as an error, and a result the player asked for as ok
 *
 * No browser runs here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STORYBOOK_STORIES_DIR, UI_DIR, UI_PAGES_DIR } from '../../engine/scripts/paths.mjs';

interface StoryMod { default: { render: (a: unknown) => unknown; args?: unknown }; [k: string]: unknown }
async function story(file: string, name: string): Promise<string> {
  const mod = await import(join(STORYBOOK_STORIES_DIR, 'pages', file)) as StoryMod;
  const s = mod[name] as { args?: unknown } | undefined;
  assert.ok(s, `${file} has a story ${name}`);
  return String(mod.default.render(s.args ?? mod.default.args));
}

const CONTROLLERS = ['league.ts', 'challenge.ts', 'meta.ts', 'cardstats.ts'] as const;
const ctl = (f: string): string => readFileSync(join(UI_DIR, f), 'utf8');
const pageSrc = (f: string): string => readFileSync(join(UI_PAGES_DIR, f), 'utf8');

test('1231 §1 each page draws its line in the tone it was said in', async () => {
  const cases: [file: string, name: string, text: string, cls: string, role: string][] = [
    ['league.stories.ts', 'Failed', 'could not reach the server', 'ui-status--error', 'alert'],
    ['league.stories.ts', 'Saved', 'Saved.', 'ui-status--ok', 'status'],
    ['challenge.stories.ts', 'Failed', 'could not reach the server', 'ui-status--error', 'alert'],
    ['meta.stories.ts', 'LoadError', 'could not reach the server', 'ui-status--error', 'alert'],
    ['cardstats.stories.ts', 'NotEnoughGames', 'Only 2 games match these filters.', 'ui-status--note', 'status'],
  ];
  for (const [file, name, text, cls, role] of cases) {
    const html = await story(file, name);
    const m = html.match(new RegExp(`<div class="ui-status ([^"]*)" role="([a-z]+)">${text.replace(/\./g, '\\.')}`));
    assert.ok(m, `${file} ${name}: the line "${text}" is a status message`);
    assert.equal(m[1], cls, `${file} ${name}: drawn as ${cls}`);
    assert.equal(m[2], role, `${file} ${name}: role="${role}"`);
    assert.doesNotMatch(html, /acctmsg/, `${file} ${name}: no bare .acctmsg line`);
  }
  // and the default (no message) draws no line at all
  assert.doesNotMatch(await story('league.stories.ts', 'Finished'), /ui-status--(error|ok)/);
});

test('1231 §2 census: the line is drawn in the view\'s tone, and set only through say()', () => {
  const DRAWS: [file: string, count: number][] = [['league.ts', 1], ['challenge.ts', 1], ['meta.ts', 3], ['cardstats.ts', 1]];
  for (const [f, n] of DRAWS) {
    const src = pageSrc(f);
    assert.doesNotMatch(src, /acctmsg/, `pages/${f} writes no .acctmsg`);
    const draws = src.match(/statusMessage\(\{ tone: v\.msgTone, text: (v\.)?msg \}\)/g) ?? [];
    assert.equal(draws.length, n, `pages/${f} draws its message line ${n}× in the view's tone`);
  }
  for (const f of CONTROLLERS) {
    const src = ctl(f);
    // (1240: a page whose loads can fail also marks the line as not a load's miss)
    assert.match(src, /const say = \(text: string, tone: StatusTone\): void => \{ msg = text; msgTone = tone;( loadMissed = false;)? \};/, `${f} has say()`);
    // every other assignment to msg clears it
    const sets = [...src.matchAll(/\bmsg = ([^;]+);/g)].map(m => m[1]!.trim()).filter(v => v !== "''" && v !== 'text');
    assert.deepEqual(sets, [], `${f}: msg is set to something only through say()`);
    assert.match(src, /\bmsg, msgTone\b/, `${f}: the page's state carries msgTone beside msg`);
  }
});

test('1231 §3 a failure is said as an error, a result the player asked for as ok', () => {
  let n = 0;
  for (const f of CONTROLLERS) {
    for (const m of ctl(f).matchAll(/\bsay\((.+?), '([a-z]+)'\)/g)) {
      const [, text, tone] = m as unknown as [string, string, string];
      n++;
      if (/^'could not|^'pick a|r\.error|^why$/.test(text)) assert.equal(tone, 'error', `${f}: say(${text}) is an error`);
      if (/^'(Saved|Copied|Season created)|^`Copied|^done/.test(text)) assert.equal(tone, 'ok', `${f}: say(${text}) is a result`);
    }
  }
  assert.ok(n >= 20, `the census reached the say() calls (${n})`);
});
