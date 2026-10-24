/* Report D3 (Discord, 2026-10-16) — A KEY PRESSED IN A LAYER IS THE LAYER'S.
 *
 * The report: "When you're in the "Report" dialogue, the hotkeys still work in
 * the game. I used Enter to submit a report and it skipped over my combat."
 *
 * Enter, Space, the number keys and S were already swallowed while the form
 * is up (the hotkeys' overlay gate, CT-135). The same family had real holes:
 *  · Ctrl+Z sent a GAME undo from inside the report's text box — or from
 *    anywhere, over any layer: its listener checked nothing at all;
 *  · Control pressed for a chord in a text box (Ctrl+Enter sends the report)
 *    was taken as the full-control hold, which drops an armed Pass all;
 *  · the pick dialog's Enter exception looked for `.overlay` in the DOM, which
 *    the report's scrim is not, so Enter could commit a draft pick behind it;
 *  · a sent report closes when the server answers, and the board had the
 *    keyboard back that instant — the best reading of what the player saw.
 * One predicate now answers "is this key someone else's?" — ui/main.ts
 * `inputOwned` — and every game keydown handler returns on it. §3 is the census.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { toDeployment } from '../../engine/test/util.ts';
import { client, openLog } from './ui-driver.ts';

const ui = await client();

(globalThis as unknown as { fetch: unknown }).fetch = () =>
  Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
const settle = (): Promise<void> => new Promise(r => setImmediate(r));

const undos = (): number => ui.sent().filter(m => m['t'] === 'undo').length;
const holds = (): unknown[] => ui.sent().filter(m => m['t'] === 'fullcontrol').map(m => m['on']);

/** a deployment board (undo works there), report shut */
function board(seed: number): void {
  const h = new Harness(seed, ['Ann', 'Bo']);
  toDeployment(h);
  const me = h.state.deployPlayer!;
  if (ui.has({ report: 'close' })) ui.click({ report: 'close' });
  ui.join(viewFor(h.state, me), me, legalActions(h.state, me));
  ui.sent();
}
function openReport(): void {
  ui.click({ btn: 'reportopen' });
  assert.ok(ui.has({ report: 'close' }), 'fixture: the report dialog is open');
  ui.sent();
}

/* ── §1 Ctrl+Z ─────────────────────────────────────────────────────────── */

test('D3 §1 negative control: on the bare board Ctrl+Z is the game undo', () => {
  board(45701);
  ui.key('z', { ctrl: true });
  assert.equal(undos(), 1, 'or the guards below prove nothing');
});

test('D3 §1 report open: Ctrl+Z in its box or on the page sends no game undo', () => {
  board(45702);
  openReport();
  ui.key('z', { ctrl: true, field: true });
  assert.equal(undos(), 0, 'in the text box Ctrl+Z is the box undoing your typing');
  ui.key('z', { ctrl: true });
  assert.equal(undos(), 0, 'and with the form up nothing else is aimed at the game either');
  ui.click({ report: 'close' });
});

test('D3 §1 any layer open, or any text box: Ctrl+Z sends no game undo', () => {
  board(45703);
  ui.key('z', { ctrl: true, field: true });
  assert.equal(undos(), 0, 'a text box anywhere owns its own Ctrl+Z');
  openLog(ui);
  ui.key('z', { ctrl: true });
  assert.equal(undos(), 0, 'the game log is up');
  ui.key('Escape');
});

/* ── §2 the Control hold, and the moment after a send ─────────────────── */

test('D3 §2 Control pressed in a text box is not the full-control hold', () => {
  board(45704);
  // the Ctrl+Z presses above latched Control as a chord; letting go clears it
  ui.key('Control', { up: true });
  openReport();
  ui.key('Control', { field: true });
  assert.deepEqual(holds(), [], 'Ctrl+Enter in the report is a chord, not a hold');
  ui.key('Control', { field: true, up: true });
  ui.click({ report: 'close' });
  ui.sent();
  ui.key('Control');
  assert.deepEqual(holds(), [true], 'negative control: on the bare board it is the hold');
  ui.key('Control', { up: true });
  ui.sent();
});

test('D3 §2 just after a sent report closes, the board does not take the keys yet', async () => {
  board(45705);
  openReport();
  ui.click({ report: 'kind', kind: 'other' });
  ui.type('report-note', 'the combat was skipped');
  ui.click({ report: 'send' });
  await settle();
  assert.ok(!ui.has({ report: 'close' }), 'fixture: the send closed the form');
  ui.sent();
  ui.key('z', { ctrl: true });
  assert.equal(undos(), 0, 'a key a moment after the send was aimed at the form, not the game');
});

/* ── §3 the census ─────────────────────────────────────────────────────── */

/**
 * Every DOCUMENT- or WINDOW-level keydown listener in client/ui/*.ts.
 *
 * A listener on an element (a text box, a dialog's own input) hears only keys
 * typed into it, and is that element's business. A page-level one hears every
 * key on the page, so it must be one of:
 *  · a GAME handler that returns on `inputOwned(` — Ctrl+Z, the Control hold;
 *  · the hotkey handler, which reads the parts separately because it is also
 *    where Escape closes the layers and Enter answers the pick dialog
 *    (`typingIn(` + `overlaysUp(` + `actBarUp(`);
 *  · a LAYER's own `{ capture: true }` handler, which runs before the board's
 *    and stops what it takes;
 *  · or one of the few named below that are not game input at all.
 */
const NOT_GAME_KEYS: Record<string, string> = {
  'main.ts:hideHoverTip': 'a key press hides the hover tooltip — it acts on nothing',
  'main.ts:primeAudio': 'the first key press unlocks audio — it acts on nothing',
  'crsearch.ts:input.focus()': "'/' focuses the comprehensive-rules search on the review page; it skips text boxes and open dialogs itself",
  'rules.ts:rules-q': 'Escape in the rules search box clears it; it reads only that box',
};

const UI = new URL('../', import.meta.url);
interface Listener { file: string; at: number; text: string }

function pageKeyListeners(): Listener[] {
  const out: Listener[] = [];
  for (const file of readdirSync(UI).filter(f => f.endsWith('.ts'))) {
    const src = readFileSync(new URL(file, UI), 'utf8');
    for (const m of src.matchAll(/addEventListener\(\s*'(keydown|keypress)'/g)) {
      const at = m.index!;
      const before = src.slice(Math.max(0, at - 12), at);
      // the receiver: `document.` / `window.` / nothing (the global) is the page
      const page = /(?:^|[^\w.?)\]])(?:document|window)\.$/.test(before) || /(?:^|[\s;(])$/.test(before);
      if (!page) continue;
      // the whole call, to its balanced closing paren
      let depth = 0, i = src.indexOf('(', at);
      const start = i;
      for (; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')' && --depth === 0) break;
      }
      out.push({ file, at, text: src.slice(start, i + 1) });
    }
  }
  return out;
}

test('D3 §3 census: every page-level keydown listener checks inputOwned, is the hotkeys, a layer capture, or is named', () => {
  const all = pageKeyListeners();
  assert.ok(all.length >= 12, `the census found ${all.length} page-level keydown listeners — too few to be reading the files`);
  const main = all.filter(l => l.file === 'main.ts');
  assert.ok(main.length >= 4, `and ${main.length} in main.ts`);
  const unclaimed: string[] = [];
  const named = new Set<string>();
  for (const l of all) {
    if (l.text.includes('inputOwned(')) continue;
    if (l.text.includes('typingIn(') && l.text.includes('overlaysUp(') && l.text.includes('actBarUp(')) continue;
    if (/\{\s*capture:\s*true\s*\}\s*\)$/.test(l.text)) continue;
    const key = Object.keys(NOT_GAME_KEYS).find(k => k.startsWith(`${l.file}:`) && l.text.includes(k.slice(l.file.length + 1)));
    if (key) { named.add(key); continue; }
    const line = readFileSync(new URL(l.file, UI), 'utf8').slice(0, l.at).split('\n').length;
    unclaimed.push(`${l.file}:${line} ${l.text.slice(0, 90).replace(/\s+/g, ' ')}`);
  }
  assert.deepEqual(unclaimed, [],
    'these page-level keydown listeners hear every key on the page and ask nobody whether it is theirs. '
    + 'A game key returns on inputOwned(e) (ui/main.ts); a layer handles its own keys in capture; '
    + 'anything else is named in NOT_GAME_KEYS with the reason it acts on nothing.');
  assert.deepEqual([...named].sort(), Object.keys(NOT_GAME_KEYS).sort(),
    'every NOT_GAME_KEYS entry still names a listener — a stale exemption is how a new one hides');
});

test('D3 §3 the game handlers name the predicate: Ctrl+Z and the Control hold', () => {
  const main = pageKeyListeners().filter(l => l.file === 'main.ts');
  const undo = main.find(l => /NET\.undo\(\)/.test(l.text));
  assert.ok(undo && /if \(inputOwned\(e\)\) return;/.test(undo.text), 'the Ctrl+Z listener returns on inputOwned first');
  const hold = main.find(l => /setFullControl\(true\)/.test(l.text));
  assert.ok(hold && /!inputOwned\(e\)\) setFullControl\(true\)/.test(hold.text), 'the Control hold is not raised from a box or a layer');
});
