/* 995 · A PAGE DRAWS WITH THE COMPONENTS, NOT WITH THEIR CLASSES (design-system Phase 5)
 *
 * The `ui-` classes belong to ui/components/: the component writes them, its
 * piece under styles/components/ styles them, and its story and test pin the
 * markup. A page that writes `<table class="ui-table">` or
 * `<h3 class="ui-panel__title">` by hand has copied a component's markup, and
 * the next change to the component will not reach it. Wave 2 left nine such
 * copies where a component lacked a variant; the variants exist now (table
 * `headless`, panel `titleHtml`, …) and the copies are gone. If a page needs
 * something a component cannot draw, add the option to the component
 * (components/README.md § Adding a variant).
 *
 * Reading a `ui-` class (a querySelector in wiring code) is fine; WRITING one
 * into markup (`class="… ui-…"`) is what this forbids, in every client module
 * outside ui/components/.
 *
 *   §0  the detector
 *   §1  no hand-written ui- class outside ui/components/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { UI_COMPONENTS_DIR, UI_DIR, UI_PAGES_DIR } from '../../engine/scripts/paths.mjs';

/** a class attribute in markup, or a className/classList write, that names a ui- class */
const WRITES_UI_CLASS = /\bclass=(["'])[^"']*(?<![\w-])ui-[a-z]|\bclass(?:Name\s*=|List\.(?:add|toggle)\()\s*[^;\n]*?['"`][^'"`]*(?<![\w-])ui-[a-z]/;

function modules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.name === 'node_modules' || e.name === 'test') return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? modules(p) : e.name.endsWith('.ts') ? [p] : [];
  });
}

test('§0 the detector: writes caught, reads and look-alikes passed', () => {
  for (const s of [
    '`<table class="ui-table lgout"><tbody>`',
    '`<h3 class="ui-panel__title">${head}</h3>`',
    "`<div class='x ui-status ui-status--note'>`",
    "el.className = 'ui-button ui-button--primary';",
    "btn.classList.add('ui-tabs__tab');",
  ]) assert.ok(WRITES_UI_CLASS.test(s), `missed: ${s}`);
  for (const s of [
    "app.querySelector('.ui-tabs__tab.on')",
    '`<div class="quiz-row">`',
    '`<span class="gui-thing">`',
    "const k = 'ui-shots';",
    '`<td class="lgplay">`',
  ]) assert.ok(!WRITES_UI_CLASS.test(s), `flagged: ${s}`);
  const all = modules(UI_DIR);
  assert.ok(all.some(f => f.startsWith(UI_PAGES_DIR + sep)) && all.length >= 120, 'the walk does not reach the modules');
});

test('§1 no client module outside ui/components/ writes a ui- class into markup', () => {
  const bad: string[] = [];
  for (const f of modules(UI_DIR)) {
    if (f.startsWith(UI_COMPONENTS_DIR + sep)) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (WRITES_UI_CLASS.test(line)) bad.push(`${relative(UI_DIR, f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(bad, [],
    'a page writes a component\'s ui- class by hand. Call the component (ui/components/), adding the option it lacks '
    + 'there — with a story and a test — rather than copying its markup');
});
