/* 1356 — THE PICK SCREEN'S THREE SOUNDS (docs/25; owner 2026-11-14: "There should be some simple
 * sound effects for 'New pack arrived' and 'Pick made' and '10 seconds left'").
 *
 * §1 each cue has its sample on disk — ui/audio.ts swallows a missing file, so a cue without one
 *    is silent, silently (as 316 §7 says for the rest)
 * §2 each is in the mix (GAIN) under the interface: quieter than the phase cue, the pick the
 *    lowest row of all; and sfx/NOTICE.md keeps the commands that made them
 * §3 playCue plays them, by those names (ui/cubedraft.ts calls playCue('packnew') etc.), at their gain
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SFX_DIR } from '../../engine/scripts/paths.mjs';

const CUBE = ['packnew', 'pick', 'tensec'] as const;
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** the GAIN table's rows, as written in ui/audio.ts */
function gains(): Map<string, number> {
  const src = read('../audio.ts');
  const body = /const GAIN: Record<Cue, number> = \{([^]*?)\n\};/.exec(src)?.[1] ?? '';
  return new Map([...body.matchAll(/^\s*(\w+): ([\d.]+),/gm)].map(m => [m[1]!, Number(m[2])]));
}

test('1356 §1 a sample on disk for each, and the names are cues', () => {
  const files = new Set(readdirSync(SFX_DIR));
  for (const c of CUBE) assert.ok(files.has(`${c}.ogg`), `sfx/${c}.ogg is missing — that cue is silent, silently`);
  const type = /export type Cue =([^;]*);/.exec(read('../sfx.ts'))?.[1] ?? '';
  for (const c of CUBE) assert.match(type, new RegExp(`'${c}'`), `'${c}' is a Cue`);
});

test('1356 §2 in the mix, under the interface, and their recipe kept', () => {
  const g = gains();
  assert.ok(g.size >= 12, 'non-vacuous: the table was read');
  for (const c of CUBE) {
    const v = g.get(c);
    assert.ok(v !== undefined, `${c} has a GAIN row`);
    assert.ok(v < g.get('phase')!, `${c} (${v}) sits under the phase cue — it is not a notification`);
  }
  for (const c of ['packnew', 'tensec']) assert.ok(g.get('pick')! < g.get(c)!, 'the pick, every few seconds, is quieter than the other two');
  assert.equal(Math.min(...g.values()), g.get('pick'), 'the lowest row in the table: it is heard on every pick');
  const notice = read('../sfx/NOTICE.md');
  for (const c of CUBE) {
    assert.match(notice, new RegExp(`\`${c}\\.ogg\``), `NOTICE.md credits ${c}.ogg`);
    assert.match(notice, new RegExp(`sox [^\\n]*\\b${c}\\.wav`), `NOTICE.md keeps the command that made ${c}`);
  }
});

test('1356 §3 playCue plays each by name, at its gain', async t => {
  const played: { src: string; vol: number }[] = [];
  class FakeAudio {
    src: string; volume = 1; currentTime = 0; preload = '';
    constructor(src: string) { this.src = src; }
    load(): void {}
    play(): Promise<void> { played.push({ src: this.src, vol: this.volume }); return Promise.resolve(); }
  }
  const store = new Map<string, string>();
  const g = globalThis as Record<string, unknown>;
  g['Audio'] = FakeAudio;
  g['localStorage'] = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });   // playCue throttles on Date.now()
  const { playCue } = await import('../audio.ts');
  const gain = gains();
  for (const c of CUBE) {
    t.mock.timers.tick(1_000);
    playCue(c);
    assert.deepEqual(played.at(-1), { src: `sfx/${c}.ogg`, vol: gain.get(c) }, `${c} plays its own sample at its own gain`);
  }
  assert.equal(played.length, CUBE.length);
});
