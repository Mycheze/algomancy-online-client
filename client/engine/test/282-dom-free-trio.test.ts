/* BL-41 — THE ONE EDGE FROM server/ INTO ui/, AND WHAT KEEPS IT HONEST.
 *
 * server/api-cardsearch.ts imports ui/cardsearch.ts. That is the first
 * `server -> ui` import in the repo and it was taken deliberately: the
 * alternative was a second copy of the query grammar, in Python, that would
 * drift. But an edge nobody watches is an edge that widens, and the reason
 * this one is SAFE is a property of exactly three files — they are pure and
 * DOM-free — which until now was only ever CLAIMED, in a comment.
 *
 * §1 ⭐ THE TRIO STAYS DOM-FREE. ui/tsconfig.json has `"lib": [..., "DOM"]`,
 *    so a stray `document` in cardsearch.ts compiles there. server/tsconfig
 *    has no DOM, so it would now fail the build — but only for as long as the
 *    server keeps importing it. This says it out loud instead.
 * §2 ⭐ THE EDGE STAYS NARROW. server/ may import those three files and no
 *    other ui/ module. The day it imports ui/cards.ts, the server has taken a
 *    dependency on the browser page and this test names the file that did it.
 * §3 the trigger for moving the trio to client/search/ is written down where
 *    the next reader will be standing
 *
 * Textual, on purpose: the point is to catch an import that WOULD compile.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const UI = new URL('../../ui/', import.meta.url);
const SERVER = new URL('../../server/', import.meta.url);

/** The files server/ is allowed to reach into: the search trio, and since
 * BL-43 the custom-rules resolver built on it (the server resolves a room's
 * rules with the very search the home screen previews them with). */
const TRIO = ['cardsearch.ts', 'cardindex.ts', 'cardsynonyms.ts', 'customrules.ts'] as const;

const readUi = (f: string): string => readFileSync(new URL(f, UI), 'utf8');

/* ══ §1 — no DOM in the three files the server compiles ════════════════ */

test('BL-41 §1 ⭐ the search trio names no DOM type', () => {
  /* Identifiers that only exist in a browser. Deliberately NOT `Element` or
   * `Node`: this game's own five elements are called elements, and the query
   * parser's AST type is called Node. Both appear constantly and neither is
   * the DOM. The list below is what a browser dependency actually looks like
   * when it sneaks in. */
  const DOM = [
    'document', 'window', 'localStorage', 'sessionStorage', 'navigator',
    'HTMLElement', 'HTMLInputElement', 'querySelector', 'addEventListener',
    'createElement', 'innerHTML', 'textContent', 'requestAnimationFrame',
  ];
  for (const file of TRIO) {
    const src = readUi(file);
    for (const id of DOM) {
      assert.ok(
        !new RegExp(`\\b${id}\\b`).test(src),
        `ui/${file} names \`${id}\` — it is imported by server/api-cardsearch.ts, `
        + 'which compiles without DOM. Either keep it pure, or move the search '
        + 'out of the server (see that file\'s header).',
      );
    }
  }
});

test('BL-41 §1b …and the server really does compile without DOM', () => {
  const tsconfig = readFileSync(new URL('tsconfig.json', SERVER), 'utf8');
  const lib = JSON.parse(tsconfig.replace(/^\s*"\/\/":[\s\S]*?\],/m, '')) as
    { compilerOptions: { lib: string[] } };
  assert.ok(
    !lib.compilerOptions.lib.some(l => /dom/i.test(l)),
    'server/tsconfig.json must not pull in DOM — that is what makes §1 a build '
    + 'error rather than a wish',
  );
});

/* ══ §2 — the edge is exactly three files wide ═════════════════════════ */

test('BL-41 §2 ⭐ server/ imports only the search trio from ui/', () => {
  const files = readdirSync(SERVER).filter(f => f.endsWith('.ts'));
  assert.ok(files.length > 20, 'non-vacuous: the server really was scanned');

  const allowed = new Set<string>(TRIO);
  let sawTheEdge = false;

  for (const f of files) {
    const src = readFileSync(new URL(f, SERVER), 'utf8');
    // every `from '../ui/<something>'`, import-type included
    for (const m of src.matchAll(/from\s+'\.\.\/ui\/([^']+)'/g)) {
      const target = m[1]!;
      sawTheEdge = true;
      assert.ok(
        allowed.has(target),
        `server/${f} imports ui/${target}. The server may reach into ui/ for the `
        + `card query language ONLY (${TRIO.join(', ')}). Importing anything else `
        + 'makes the game server depend on the browser page.',
      );
    }
  }

  // If this ever goes false the test has stopped testing anything — the edge
  // was removed, and so should this file have been.
  assert.ok(sawTheEdge, 'no server -> ui import found at all; is the endpoint still there?');
});

/* ══ §3 — the move-out trigger is recorded, not remembered ═════════════ */

test('BL-41 §3 the header says when to move the trio to client/search/', () => {
  const src = readFileSync(new URL('api-cardsearch.ts', SERVER), 'utf8');
  assert.match(
    src, /client\/search\//,
    'api-cardsearch.ts must name the condition under which the trio moves out '
    + 'of ui/ — otherwise the next reader re-derives the decision from scratch',
  );
});
