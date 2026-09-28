/* BL-41 — THE ONE EDGE FROM server/ INTO ui/, AND WHAT KEEPS IT HONEST.
 *
 * server/api-cardsearch.ts imports ui/cardsearch.ts. That is the first
 * `server -> ui` import in the repo and it was taken deliberately: the
 * alternative was a second copy of the query grammar, in Python, that would
 * drift. But an edge nobody watches is an edge that widens, and the reason
 * this one is SAFE is a property of exactly three files — they are pure and
 * DOM-free — which until now was only ever CLAIMED, in a comment.
 *
 * §1 ⭐ THE SHARED FILES STAY DOM-FREE. ui/tsconfig.json has
 *    `"lib": [..., "DOM"]`, so a stray `document` in cardsearch.ts compiles
 *    there. server/tsconfig has no DOM, so it would now fail the build — but
 *    only for as long as the server keeps importing it. This says it out loud
 *    instead. The list covers what server/ imports AND what those files import
 *    in turn: a DOM reference two hops in breaks the server build just as
 *    hard, and names no file the server can see.
 * §2 ⭐ THE EDGE STAYS NARROW. server/ may import those files and no other
 *    ui/ module. The day it imports ui/cards.ts, the server has taken a
 *    dependency on the browser page and this test names the file that did it.
 * §3 the trigger for moving the trio to client/search/ is written down where
 *    the next reader will be standing
 * §4 ⭐ the one NON-search file on the edge, ui/passrelease.ts (2026-09-28),
 *    is proved DOM-free down its WHOLE import chain rather than by its name:
 *    it imports nothing at runtime, and every file its types reach is walked
 *    and scanned
 *
 * Textual, on purpose: the point is to catch an import that WOULD compile.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const UI = new URL('../../ui/', import.meta.url);
const SERVER = new URL('../../server/', import.meta.url);

/**
 * The files server/ is allowed to reach into, and why each one is there.
 *
 *   cardsearch · cardindex · cardsynonyms   the search trio (BL-41): one card
 *     query language, rather than a second copy of it in Python that drifts.
 *   customrules   BL-43 — the server resolves a room's rules with the very
 *     search the home screen previews them with.
 *   deckformat    2026-09-20 — the deck interchange format. The browser WRITES
 *     a deck file and the server READS one back, so the shape, the entry
 *     collapsing and the parser have to be one module or the export and the
 *     import will disagree about the format they share. It is also the file an
 *     outside reader (algomancer.cc) is handed, which is the strongest reason
 *     of the three for there to be exactly one of it.
 */
const TRIO = [
  'cardsearch.ts', 'cardindex.ts', 'cardsynonyms.ts', 'customrules.ts', 'deckformat.ts',
] as const;

/** …plus what those files import from ui/ in turn, which compiles into the
 * server just the same. `deckformat.ts` is built on the deck analysis. */
const TRANSITIVE = ['deckstats.ts'] as const;

/**
 * The standing pass's judgements (owner, 2026-09-28: *"When a player is 'Pass
 * all'ed, their timer should never go down."*). The server stops a Pass-all
 * seat's clock and passes for it when the client is late, and it must decide
 * when the arm comes off with the client's OWN release list, not a second copy
 * that drifts — the same argument that let the search trio in. The functions
 * were cut verbatim out of ui/battle.ts and ui/inspect.ts (both re-export them)
 * precisely so that the server would not compile those two, which reach the
 * card text and ui/util.ts's clipboard helper. §4 is what keeps it that way.
 */
const PASS = ['passrelease.ts'] as const;

const readUi = (f: string): string => readFileSync(new URL(f, UI), 'utf8');

/* ══ §1 — no DOM in the three files the server compiles ════════════════ */

test('BL-41 §1 ⭐ the files the server compiles name no DOM type', () => {
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
  for (const file of [...TRIO, ...TRANSITIVE]) {
    const src = readUi(file);
    for (const id of DOM) {
      assert.ok(
        !new RegExp(`\\b${id}\\b`).test(src),
        `ui/${file} names \`${id}\` — it compiles into server/, which is built `
        + 'without DOM. Either keep it pure, or move it out of the reach of the '
        + 'server (see api-cardsearch.ts\'s header).',
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

  const allowed = new Set<string>([...TRIO, ...PASS]);
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
        + `card query language and the deck format ONLY (${TRIO.join(', ')}), `
        + `plus the standing pass's release list (${PASS.join(', ')}). `
        + 'Importing anything else makes the game server depend on the browser page.',
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

/* ══ §4 — the standing pass's module, proved down its whole chain ═════════ */

/** Code only: the pass module talks about priority WINDOWS in every other
 * comment, and a comment is not a dependency. Strings are left in — a DOM
 * name in a string is still worth a look. */
const code = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');

test('BL-41 §4 ⭐ ui/passrelease.ts imports nothing at runtime, and nothing its types reach names the DOM', () => {
  const DOM = [
    'document', 'window', 'localStorage', 'sessionStorage', 'navigator',
    'HTMLElement', 'HTMLInputElement', 'querySelector', 'addEventListener',
    'createElement', 'innerHTML', 'textContent', 'requestAnimationFrame',
  ];
  const ENGINE_SRC = new URL('../src/', import.meta.url).href;
  for (const f of PASS) {
    const root = new URL(f, UI);
    const own = readFileSync(root, 'utf8');
    // (1) no RUNTIME edge at all: every import is `import type`, and it
    //     re-exports nothing from anywhere
    const imports = [...own.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)'/gm)];
    assert.ok(imports.length > 0, `non-vacuous: ui/${f}'s imports were found`);
    for (const m of imports) {
      assert.ok(m[1], `ui/${f} imports ${m[2]} at RUNTIME — it may only import engine TYPES, so `
        + 'that nothing the server compiles through it can grow a browser dependency');
    }
    assert.doesNotMatch(own, /^export\s[^;]*\sfrom\s+'/m, `ui/${f} re-exports from another module`);

    // (2) walk the WHOLE chain its type imports reach, and scan every file
    const seen = new Set<string>();
    const queue: URL[] = [root];
    while (queue.length) {
      const u = queue.pop()!;
      if (seen.has(u.href)) continue;
      seen.add(u.href);
      const src = readFileSync(u, 'utf8');
      for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s+'(\.{1,2}\/[^']+\.ts)'/g)) {
        queue.push(new URL(m[1]!, u));
      }
      const rel = u.href.startsWith(UI.href) ? `ui/${u.href.slice(UI.href.length)}`
        : u.href.startsWith(ENGINE_SRC) ? `engine/src/${u.href.slice(ENGINE_SRC.length)}` : u.href;
      assert.ok(u.href === root.href || u.href.startsWith(ENGINE_SRC),
        `ui/${f}'s import chain reaches ${rel}. It may reach the engine and nothing else: `
        + 'another ui/ module is the browser page, which is exactly what BL-41 keeps out of server/');
      const body = code(src);
      for (const id of DOM) {
        assert.ok(!new RegExp(`\\b${id}\\b`).test(body),
          `${rel} (reached from ui/${f}) names \`${id}\` in code — it compiles into server/, `
          + 'which is built without DOM');
      }
    }
    assert.ok(seen.size >= 2, `non-vacuous: the chain from ui/${f} was walked (${seen.size} files)`);
  }
});
