/* 1021 — THE TEST-MODE LAUNCHER IS THE HOME'S TO DRAW, AND KEEPS ITS ICON
 * (new home, docs/24, 2026-11-03).
 *
 * Until 2026-11-03 ui/sandbox.ts appended a "Test mode" button to the home's
 * `.homesolo` row off a MutationObserver, so a home without that row lost the
 * button silently. The new home draws `data-sbx="open"` itself (the toolbar's
 * Test button); sandbox.ts only answers the click. And it says "dealing…"
 * (or the error) in the button's `[data-sbx-label]` caption when it has one,
 * so an icon button keeps its icon — a plain text button is written whole,
 * as before.
 *
 * §1 launcherLabel: the caption when there is one, else the button
 * §2 sandbox.ts injects nothing into the home any more
 *
 * (That the home's own source draws `data-sbx="open"` is pinned with the new
 * home, which this branch does not have yet.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UI_DIR } from '../../engine/scripts/paths.mjs';
import { launcherLabel } from '../sandbox.ts';

/** a button with (or without) a caption child, as far as launcherLabel looks */
function fakeButton(withLabel: boolean): { btn: HTMLElement; label: HTMLElement | null } {
  const label = withLabel ? ({ textContent: 'Test' } as unknown as HTMLElement) : null;
  const btn = {
    textContent: '🧪Test',
    querySelector: (sel: string) => (sel === '[data-sbx-label]' ? label : null),
  } as unknown as HTMLElement;
  return { btn, label };
}

test('1021 §1 the launcher writes into its caption, else into itself', () => {
  const icon = fakeButton(true);
  assert.equal(launcherLabel(icon.btn), icon.label, 'an icon button: the caption, so the icon survives');
  const plain = fakeButton(false);
  assert.equal(launcherLabel(plain.btn), plain.btn, 'a text button: the button itself');
  const bare = { textContent: 'Test mode' } as unknown as HTMLElement;
  assert.equal(launcherLabel(bare), bare, 'no querySelector at all (a headless stand-in): the button');
});

test('1021 §2 sandbox.ts no longer puts a button into the home', () => {
  const src = readFileSync(join(UI_DIR, 'sandbox.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(src, /dataset\['sbx'\]/, 'positive control: the click handler is read');
  assert.match(src, /what === 'open'/, 'the launcher click is still answered');
  assert.doesNotMatch(src, /homesolo|homeLauncher/, 'the home launcher is injected again — the home draws it now');
  assert.doesNotMatch(src, /setAttribute\('data-sbx', 'open'\)/, 'sandbox.ts builds its own launcher again');
  assert.doesNotMatch(src, /\bbtn\.textContent\s*=/, 'openSandbox overwrites the whole button again, icon and all');
});
