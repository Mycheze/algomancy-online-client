/*
 * 316 · THE LIFE METER (owner, 2026-09-20)
 *
 * "A complaint I've gotten about the UI, a few times, is that it's too hard to
 * see the life totals. It's small and you can't tell when it changes."
 *
 * Three answers, and they are not independent:
 *
 *   SIZE     the total is 26px in a 13px row (ui/style.css .lifenum), and the
 *            heart beside it stayed small so the DIGITS are what grew.
 *   FLASH    every change, both seats (ui/anim.ts flashLife) — red down, green
 *            up, plus the amount rising off the pill.
 *   SOUND    every change to YOUR total (ui/sfx.ts lifeChanges + audibleLife,
 *            ui/audio.ts's 'life' channel).
 *
 * The DIFF logic is ui/test/54's — what changed, and which change is heard.
 * THIS file is about the seam between that logic and the screen, which is a
 * single fragile fact:
 *
 *   ui/anim.ts flashLife reaches for `[data-animzone="life:<seat>"]` and
 *   expects the TOTAL to be inside it.
 *
 * That element predates the flash by months — it is the motion layer's anchor
 * and the targeting arrow's endpoint — so nothing about its NAME says the
 * life number has to live in it. Move the total out of that span, or move the
 * animzone onto a wrapper, and `elFor` still resolves, `flash()` still runs,
 * and the pill the player is watching never changes colour. Nothing throws.
 * That is the failure this file exists to make loud.
 *
 * Driven through test/ui-driver.ts, which has no layout and no DOM to flash —
 * so these assertions are about the MARKUP the flash needs, read where a real
 * browser would read it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { client } from './ui-driver.ts';
import { toDeployment } from '../../engine/test/util.ts';
import { lifeChanges, sfxSnap } from '../sfx.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';

const ui = await client();

const SEAT: Seat = 0;

function dealt(seed: number): GameState {
  const h = new Harness(seed);
  toDeployment(h);
  return h.state;
}

/** the state again, with `seat` on `life` — through the engine's own handle */
function atLife(s: GameState, seat: Seat, life: number): GameState {
  const copy = JSON.parse(JSON.stringify(s)) as GameState;
  const e = new E(copy);
  e.player(seat).life = life;
  e.settle();
  return copy;
}

const show = (s: GameState): string => ui.update(viewFor(s, SEAT), legalActions(s, SEAT));

/**
 * The whole `[data-animzone="life:<seat>"]` element and NOTHING outside it.
 *
 * Tag-balanced on purpose. The first cut of this helper took "the third
 * `</span>` after the attribute", which is right for the markup as it stands
 * and blind to the exact break the file is about: move the total out of the
 * pill and the naive slice reaches past the closing tag and swallows it
 * again, so §1 passes while the flash lights an empty pill. It was checked by
 * breaking it, which is the only way that was ever going to surface.
 */
function pill(html: string, seat: Seat): string {
  const at = html.indexOf(`data-animzone="life:${seat}"`);
  assert.notEqual(at, -1, `seat ${seat} has no life animzone — the flash has nothing to find`);
  const start = html.lastIndexOf('<span', at);
  let depth = 0, i = start;
  for (;;) {
    const open = html.indexOf('<span', i + 1);
    const close = html.indexOf('</span>', i + 1);
    assert.notEqual(close, -1, `seat ${seat}: the life pill is never closed`);
    if (open !== -1 && open < close) { depth++; i = open; continue; }
    if (depth === 0) return html.slice(start, close + 7);
    depth--; i = close;
  }
}

// ── the seam ──────────────────────────────────────────────────────────

test('316 §1 the element ui/anim.ts flashes is the one with the number in it', () => {
  const s = dealt(31600);
  const html = ui.join(viewFor(s, SEAT), SEAT, legalActions(s, SEAT));
  for (const seat of [0, 1] as const) {
    const el = pill(html, seat);
    const life = s.players[seat]!.life;
    assert.match(el, /class="lifenum"/,
      `seat ${seat}: the life animzone does not contain .lifenum — flashLife would light an empty pill`);
    assert.match(el, new RegExp(`<span class="lifenum">${life}</span>`),
      `seat ${seat}: the total is not inside the element the flash lands on`);
    assert.match(el, /class="lifeheart"/, `seat ${seat}: the heart left the pill`);
  }
});

test('316 §2 BOTH seats have one, because the flash is for both players', () => {
  // the sound is yours alone (ui/test/54 §audibleLife); the flash is not, and
  // it cannot be if only one seat has somewhere to put it
  const s = dealt(31601);
  const html = ui.join(viewFor(s, SEAT), SEAT, legalActions(s, SEAT));
  const found = html.match(/data-animzone="life:\d"/g) ?? [];
  assert.deepEqual([...new Set(found)].sort(), ['data-animzone="life:0"', 'data-animzone="life:1"']);
});

test('316 §3 the redacted view a client actually renders still carries both totals', () => {
  // life is PUBLIC — server/view.ts must not redact the opponent's, or the
  // pill on screen would flash a number this client cannot see change
  const s = dealt(31602);
  const mine = viewFor(s, 0), theirs = viewFor(s, 1);
  for (const seat of [0, 1] as const) {
    assert.equal(mine.players[seat]!.life, s.players[seat]!.life, `seat ${seat}'s life is hidden from seat 0`);
    assert.equal(theirs.players[seat]!.life, s.players[seat]!.life, `seat ${seat}'s life is hidden from seat 1`);
  }
  assert.deepEqual(sfxSnap(mine, 0, false).life, sfxSnap(theirs, 1, false).life,
    'the two clients disagree about the totals, so one of them would flash the wrong pill');
});

// ── a life change through the real client ─────────────────────────────

test('316 §4 a life change arrives as an update, repaints the total, and is SEEN', () => {
  // the whole path in one test: the server pushes a later state, main.ts
  // repaints, and the snapshot pair that drives the flash and the cue reports
  // exactly the change that was pushed
  const s = dealt(31603);
  const before = s.players[SEAT]!.life;
  ui.join(viewFor(s, SEAT), SEAT, legalActions(s, SEAT));

  const hit = atLife(s, SEAT, before - 7);
  const html = show(hit);
  assert.match(pill(html, SEAT), new RegExp(`<span class="lifenum">${before - 7}</span>`),
    'the repaint did not carry the new total');
  assert.deepEqual(
    lifeChanges(sfxSnap(viewFor(s, SEAT), SEAT, false), sfxSnap(viewFor(hit, SEAT), SEAT, false)),
    [{ seat: SEAT, delta: -7 }]);

  // …and back up again, so nothing here is only true downwards
  const healed = atLife(hit, SEAT, before - 2);
  assert.match(pill(show(healed), SEAT), new RegExp(`<span class="lifenum">${before - 2}</span>`));
  assert.deepEqual(
    lifeChanges(sfxSnap(viewFor(hit, SEAT), SEAT, false), sfxSnap(viewFor(healed, SEAT), SEAT, false)),
    [{ seat: SEAT, delta: 5 }]);
});

test('316 §5 the opponent\'s total repaints too — you watch the number you are attacking', () => {
  const s = dealt(31604);
  const them: Seat = 1;
  const before = s.players[them]!.life;
  ui.join(viewFor(s, SEAT), SEAT, legalActions(s, SEAT));
  const hit = atLife(s, them, before - 9);
  assert.match(pill(show(hit), them), new RegExp(`<span class="lifenum">${before - 9}</span>`));
});

test('316 §6 a repaint that did not move life reports nothing to flash', () => {
  // the quiet half, and the one a careless "flash on every render" would fail:
  // the board repaints constantly, and a pill that pulses on every paint is
  // indistinguishable from one that never pulses
  const s = dealt(31605);
  ui.join(viewFor(s, SEAT), SEAT, legalActions(s, SEAT));
  const a = sfxSnap(viewFor(s, SEAT), SEAT, false);
  show(s);
  assert.deepEqual(lifeChanges(a, sfxSnap(viewFor(s, SEAT), SEAT, false)), []);
});

// ── the sound files ───────────────────────────────────────────────────

test('316 §7 both life cues have a sample on disk, beside the ones that had one', async () => {
  // ui/audio.ts resolves every cue to `sfx/<cue>.ogg` and swallows every
  // failure — a missing file is not an error anywhere, it is just a cue that
  // never plays. So the file list is the only thing that can say it is there.
  const { readdir } = await import('node:fs/promises');
  const { SFX_DIR } = await import('../../engine/scripts/paths.mjs');
  const files = new Set(await readdir(SFX_DIR));
  for (const cue of ['lifeup', 'lifedown', 'phase', 'priority', 'subphase', 'decision', 'error', 'thump', 'gameover']) {
    assert.ok(files.has(`${cue}.ogg`), `sfx/${cue}.ogg is missing — that cue is silent, silently`);
  }
});
