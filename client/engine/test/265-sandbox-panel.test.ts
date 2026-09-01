/* BL-06 — THE TEST-MODE PANEL: IT INSTALLS, AND IT IS FAIL-CLOSED.
 *
 * `ui/sandbox.ts` is a self-installing module: it paints outside `#app`,
 * injects its own styles, owns its own clicks through a `data-sbx` attribute
 * the global listener does not match, and needs exactly two lines in
 * `ui/main.ts`. That shape buys a clean merge; it costs one thing, and this
 * file is the payment.
 *
 * ── THE TWO HAZARDS IT IS WRITTEN AGAINST ────────────────────────────────
 *
 * ① THE SILENT NO-OP. `installSandbox` DECLINES rather than throwing when the
 *    document has no `head`/`body`/MutationObserver, because
 *    `engine/test/ui-driver.ts` is exactly such a document — "the smallest
 *    browser main.ts will accept" — and 33 test files import it. A decline is
 *    the right answer there and the WRONG answer in a real browser, where it
 *    would mean test mode quietly has no controls and nothing anywhere would
 *    say so. §1 hands the module a document that does have those pieces and
 *    asserts it really installs.
 *
 * ② THE PANEL OVER A REAL GAME. `state.sandbox` comes from the server (it is
 *    set at the deal and rides in the redacted view), and no client-side flag
 *    may substitute for it. §2 is the negative control: a state without the
 *    flag paints nothing, whatever else is true.
 *
 * This is not a DOM. The fake below answers exactly what `installSandbox` and
 * `repaint` ask and nothing else — the same bargain, and the same honesty
 * about it, as ui-driver.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Element, GameState, Seat } from '../src/types.ts';
import { dealScenario, SANDBOX_ID } from '../../server/scenarios.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI = join(HERE, '..', '..', 'ui');

// ── the smallest browser ui/sandbox.ts will accept ───────────────────────

class FakeEl {
  tagName: string;
  id = '';
  innerHTML = '';
  textContent = '';
  title = '';
  children: FakeEl[] = [];
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  classList = { add: (): void => {}, remove: (): void => {}, contains: (): boolean => false };
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  appendChild(c: FakeEl): FakeEl { this.children.push(c); return c; }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  removeAttribute(k: string): void { delete this.attrs[k]; }
  addEventListener(): void {}
  querySelector(): null { return null; }
}

const head = new FakeEl('head');
const body = new FakeEl('body');
(globalThis as Record<string, unknown>)['MutationObserver'] = class {
  observe(): void {}
  disconnect(): void {}
};
(globalThis as Record<string, unknown>)['document'] = {
  head, body,
  createElement: (tag: string) => new FakeEl(tag),
  getElementById: () => null,
  querySelector: () => null,
  addEventListener: () => {},
};

// imported AFTER the fake is installed: the module reads `document` only
// inside its functions, but the import is kept below the setup anyway so the
// dependency is visible rather than incidental
const { installSandbox } = await import('../../ui/sandbox.ts');

// ── the states under test ────────────────────────────────────────────────

const NAMES: [string, string] = ['Seat 1', 'Seat 2'];
/** any trio — `mode: 'shared'` plays all seven whatever this says */
const ELS: Element[] = ['fire', 'water', 'earth'];
const sandboxState = (): GameState =>
  dealScenario(60600606, NAMES, 'shared', ELS, undefined, SANDBOX_ID).state;
const ordinaryState = (): GameState =>
  dealScenario(60600606, NAMES, 'shared', ELS, undefined).state;

let current: GameState | null = null;
let seat: Seat | null = 0;

installSandbox({
  state: () => current,
  seat: () => seat,
  room: () => 'TEST',
  act: () => {},
});

// ── §1 IT INSTALLS ───────────────────────────────────────────────────────

test('§1 installSandbox really installs when the document has head, body and an observer', () => {
  assert.ok(body.children.some(c => c.id === 'sbx-root'),
    'no #sbx-root in the body. installSandbox declines on a document without head/body/'
    + 'MutationObserver — which is right for ui-driver.ts and wrong everywhere else, and this '
    + 'is the assertion that stops the decline becoming permanent.');
  const style = head.children.find(c => c.tagName === 'STYLE');
  assert.ok(style, 'no <style> was injected — the panel would render unstyled over the board');
  assert.match(style!.textContent, /#sbx-root/,
    'the injected stylesheet does not scope itself to #sbx-root; it would leak into the board');
});

// ── §2 FAIL-CLOSED ───────────────────────────────────────────────────────

test('§2 ⚠ nothing is painted for an ORDINARY game', async () => {
  current = ordinaryState();
  seat = 0;
  assert.equal(current.sandbox, undefined);
  // a FRESH install, so this is a real paint against a real state rather than
  // a read of whatever the first install happened to leave behind
  assert.equal(await freshPanelHtml(), '',
    'the sandbox panel painted over an ordinary game. `state.sandbox` comes from the SERVER '
    + '(set at the deal, carried in the redacted view) precisely so that no client-side flag '
    + 'can put cheats on a real board.');
});

test('§2 …nor for a sandbox room this client has no seat in', async () => {
  current = sandboxState();
  seat = null;
  assert.equal(await freshPanelHtml(), '',
    'a spectator with no seat has nothing to cheat with — every control sends an action for '
    + 'a seat, and act() refuses one that is not yours anyway');
  seat = 0;
});

// ── §3 THE CONTROLS ──────────────────────────────────────────────────────

test('§3 the panel offers every control BL-06 asks for', async () => {
  current = sandboxState();
  seat = 0;
  const html = await freshPanelHtml();
  assert.match(html, /Test mode/, 'the panel names itself');
  assert.match(html, /data-sbx="spawn"/, 'a card can be summoned');
  assert.match(html, /data-sbx="zone" data-zone="hand"/, '…into your hand');
  assert.match(html, /data-sbx="zone" data-zone="play"/, '…your board');
  assert.match(html, /data-sbx="zone" data-zone="bin"/, '…or your bin');
  assert.match(html, /data-sbx="mana-set"/, 'mana is settable');
  assert.match(html, /data-sbx="life-set"/, 'life is settable');
  assert.match(html, /data-sbx="advance"/, 'the phase can be advanced');
  assert.match(html, /seat=1/, 'and the SECOND seat opens in another tab');
  assert.match(html, /1000/, 'the dealt life total is on screen');
});

/** Install a second copy of the module into a fresh body and read what it
 * paints. The module refuses a second install into the same module instance
 * (one panel, one set of clicks), so this loads a fresh instance — which is
 * also the honest way to prove the install path works more than once. */
async function freshPanelHtml(): Promise<string> {
  const body2 = new FakeEl('body');
  const head2 = new FakeEl('head');
  const doc = globalThis as unknown as { document: unknown };
  const saved = doc.document;
  doc.document = {
    head: head2, body: body2,
    createElement: (tag: string) => new FakeEl(tag),
    getElementById: () => null,
    querySelector: () => null,
    addEventListener: () => {},
  };
  // a distinct module instance, so `installSandbox`'s one-panel guard does not
  // refuse this one
  const mod = await import(`../../ui/sandbox.ts?fresh=${Date.now()}`) as
    { installSandbox: (c: Parameters<typeof installSandbox>[0]) => void };
  mod.installSandbox({
    state: () => current,
    seat: () => seat,
    room: () => 'TEST',
    act: () => {},
  });
  doc.document = saved;
  const r = body2.children.find(c => c.id === 'sbx-root');
  assert.ok(r, 'the fresh install painted no root');
  return r!.innerHTML;
}

// ── §4 IT STAYS OUT OF main.ts's WAY ─────────────────────────────────────

test('§4 the panel claims its clicks with data-sbx, never data-btn', () => {
  const src = readFileSync(join(UI, 'sandbox.ts'), 'utf8');
  // `data-btn=`, not `data-btn`: this file's own PROSE names the attribute
  // (explaining why it does not use it), and a sweep that could not tell an
  // explanation from a use would have to be silenced or lied to
  assert.equal(/data-btn\s*=/.test(src), false,
    'ui/sandbox.ts uses `data-btn`. main.ts\'s global click listener matches `[data-btn]` FIRST '
    + 'and would claim the panel\'s buttons — the whole point of `data-sbx` is that it does not.');
  // and the positive control for that sweep
  assert.equal(/data-btn\s*=/.test('<button data-btn="x">'), true,
    'the sweep cannot see the attribute at all — it would report clean on any file');
});

test('§4 main.ts needs exactly one import and one install call', () => {
  const src = readFileSync(join(UI, 'main.ts'), 'utf8');
  const imports = src.match(/import \{ installSandbox \} from '\.\/sandbox\.ts';/g) ?? [];
  // the CALL, not every mention: the comment above the import names it too
  const calls = src.match(/installSandbox\(\{/g) ?? [];
  assert.equal(imports.length, 1, 'ui/main.ts should import installSandbox exactly once');
  assert.equal(calls.length, 1,
    'ui/main.ts should call installSandbox exactly once. This is not a style rule: main.ts is '
    + 'the file that collides when several people work at once, and the two-line hook is what '
    + 'keeps a whole feature out of it.');
});
