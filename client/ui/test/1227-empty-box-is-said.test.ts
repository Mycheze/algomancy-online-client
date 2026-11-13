/* 1227 — A BUTTON PRESSED WITH ITS BOX EMPTY SAYS WHAT IS MISSING (BL-10,
 * docs/23-ui-inventory/01 §4 S16: "An empty room code is ignored with no
 * message").
 *
 * The class was five buttons, each of which read a text box, found it empty
 * and returned without a word — the press looked broken:
 *   - the home Join sheet's Join (pages/home.ts `joincode`)
 *   - the home Import sheet's Load and Use pasted list (`deckimporturl`,
 *     `deckimporttext` → pages/deckpicker.ts importDeck)
 *   - the Decks page's import sheet, the same two (decks.ts `deck-import-*`)
 *   - the profile's Add a friend (account.ts `acct-friend-add`)
 * Each now puts a line in the message spot it already had. The sign-in form
 * already did ("username and password, please").
 *
 * §1 the Join sheet: joinCodeTarget and the line it draws
 * §2 importDeck: the line, and no request
 * §3 the handlers in pages/home.ts (main.ts's until BL-63), decks.ts and account.ts take the saying path
 * §4 census: no ui handler reads a box and returns silently on empty
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
});

const read = (f: string): string => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('1227 §1 Join with no code: the Join sheet says so; a code opens the room', async () => {
  const home = await import('../pages/home.ts');
  assert.equal(home.joinCodeTarget('   '), null);
  assert.equal(home.homeView({ els: [], fixedOpen: false, error: '' }).joinError, home.EMPTY_CODE_LINE);
  const v = { ...home.homeView({ els: [], fixedOpen: false, error: '' }), sheet: 'join' as const };
  const html = home.homeHtml(v);
  const line = html.indexOf(home.EMPTY_CODE_LINE);
  assert.ok(line > html.indexOf('data-btn="joincode"'), 'drawn under the code row');
  assert.match(html.slice(html.lastIndexOf('<', line), line), /role="alert"/, 'an error line, read out');
  // typing a code and pressing Join opens the room, and the line goes
  assert.equal(home.joinCodeTarget(' ab12 '), '?ws=1&room=AB12');
  assert.equal(home.homeView({ els: [], fixedOpen: false, error: '' }).joinError, '');
  // …and opening a sheet afresh starts without it
  home.joinCodeTarget('');
  home.openHomeSheet('join');
  assert.equal(home.homeView({ els: [], fixedOpen: false, error: '' }).joinError, '');
  home.closeHomeSheet();
});

test('1227 §2 Load / Use pasted list with the box empty: a line, and nothing sent', async () => {
  const dp = await import('../pages/deckpicker.ts');
  const dk = await import('../decks.ts');
  let sent = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => { sent++; return new Promise(() => {}); }) as typeof fetch;
  try {
    let painted = 0;
    dp.importDeck({ url: '  ' }, () => { painted++; });
    assert.equal(dp.deckPickerView().msg, dk.EMPTY_DECK_LINK);
    dp.importDeck({ text: '\n' }, () => { painted++; });
    assert.equal(dp.deckPickerView().msg, dk.EMPTY_DECK_LIST);
    assert.equal(painted, 2, 'each press repaints, so the line shows');
    assert.equal(sent, 0, 'no request for an empty box');
    // positive control: a link goes to the server, trimmed
    dp.importDeck({ url: ' https://algomancer.cc/d/1 ' }, () => {});
    assert.equal(sent, 1);
    assert.equal(dp.deckPickerView().msg, 'importing…');
  } finally { globalThis.fetch = realFetch; }
});

/** the body of a handler, from its head to the next `return true;` that ends it */
const branch = (src: string, head: string, len = 900): string => {
  const i = src.indexOf(head);
  assert.ok(i >= 0, `positive control: ${head}`);
  return src.slice(i, i + len);
};

test('1227 §3 the handlers take the path that says it', () => {
  const home = read('pages/home.ts');   // handleHomeButton, main.ts's until BL-63 (2026-11-13)
  const join = branch(home, "if (b === 'joincode') {", 500);
  assert.match(join, /joinCodeTarget\(/, 'Join asks joinCodeTarget');
  assert.match(join, /if \(!target\) \{ renderHome\(\);/, '…and repaints so the line shows');
  for (const b of ['deckimporturl', 'deckimporttext']) {
    const body = branch(home, `if (b === '${b}') {`, 300);
    assert.match(body, /\n\s+importDeck\(\{ (url|text): /, `${b}: importDeck is called whatever the box holds`);
  }
  const decks = branch(read('decks.ts'), "case 'deck-import-text': {", 700);
  assert.match(decks, /msg: b === 'deck-import-url' \? EMPTY_DECK_LINK : EMPTY_DECK_LIST \};\s+paint\(\);/,
    'the Decks page\'s import sheet says it');
  const friend = branch(read('account.ts'), "case 'acct-friend-add': {", 500);
  assert.match(friend, /if \(!username\) \{ friendMsg = EMPTY_FRIEND_LINE; renderScreen\(\); return true; \}/);
});

test('1227 §4 census: no ui handler reads a text box and returns silently when it is empty', () => {
  const dir = new URL('../', import.meta.url);
  const files = [
    ...readdirSync(dir).filter(f => f.endsWith('.ts')),
    ...readdirSync(new URL('pages/', dir)).filter(f => f.endsWith('.ts')).map(f => `pages/${f}`),
  ];
  /* Left on purpose: the two "ask the judge" boxes (the lesson's, and the
   * table's `judgeask` in main.ts, whose `if (question && !judgeBusy)` this
   * pattern does not match). They are chat boxes on the table and in a lesson,
   * not BL-10's pages: Ask with nothing typed sends nothing, as a chat does,
   * and the box's own placeholder is the prompt. */
  const ALLOWED = new Set(['lessonlayer.ts: const q = (input?.value ?? judgeDraft).trim();']);
  const bad: string[] = [];
  let reads = 0;
  for (const f of files) {
    const src = read(f);
    // const x = …value….trim()…;  then within the next few lines a bare
    // `if (!x) return…;` or `if (x) doIt(…);` with nothing said otherwise
    for (const m of src.matchAll(/const (\w+) = [^;\n]*\.value\b[^;\n]*\.trim\(\)[^;\n]*;/g)) {
      reads++;
      const after = src.slice(m.index! + m[0].length, m.index! + m[0].length + 240);
      const v = m[1]!;
      if (new RegExp(`if \\(!${v}\\) return( true| 'no-repaint')?;`).test(after)
        || new RegExp(`if \\(${v}\\) \\w+\\([^;]*\\);\\s*\\n\\s*return`).test(after)) {
        const at = `${f}: ${m[0].slice(0, 80)}`;
        if (!ALLOWED.has(at)) bad.push(at);
      }
    }
  }
  assert.ok(reads >= 5, `positive control: the census sees the box reads (${reads})`);
  assert.deepEqual(bad, [], 'a press with an empty box must say what is missing');
});
