/* 962 — THE PAGE CONTRACT (client/ui/pages/README.md), and the small pieces.
 *
 * A page under ui/pages/ is a view-gatherer plus a PURE `…Html(view)`: no DOM,
 * no browser globals, no other module's state, none of its own `let` state.
 * That is what lets a page have a Storybook story and a DOM-free test. This
 * file holds the contract to the source, and drives the three small pieces the
 * home screen and waiting rooms are built from.
 *
 * §1 every exported …Html function in pages/*.ts is pure (read off the source)
 * §1b …and that check reads code: a string, a comment or `v.tab` is not a read of `let tab`
 * §2 main.ts keeps no second copy of what moved
 * §3 the deck picker: loading, the bundled list, the collection, a stray deck
 * §4 the clock picker: Default, a preset, off
 * §5 the connecting screen: connecting, and a refused join with its way home
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { deckPickerHtml, type DeckPickerView } from '../pages/deckpicker.ts';
import { clockPickHtml } from '../pages/clockpick.ts';
import { connectingHtml } from '../pages/connecting.ts';

const PAGES = new URL('../pages/', import.meta.url);
const FILES = readdirSync(PAGES).filter(f => f.endsWith('.ts'));
const src = (f: string): string => readFileSync(new URL(f, PAGES), 'utf8');
const MAIN = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');

/** the brace-matched body of `export function <name>(` */
function bodyOf(text: string, at: number): string {
  const open = text.indexOf('{', text.indexOf(')', at));
  let depth = 0, i = open;
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) break;
  }
  return text.slice(open + 1, i);
}

/** browser globals a pure html function must not touch */
const GLOBALS = ['document', 'window', 'localStorage', 'sessionStorage', 'location', 'fetch', 'navigator',
  'setTimeout', 'setInterval', 'requestAnimationFrame', 'Date.now', 'Math.random'];

/**
 * The CODE of a function body: every comment, every string literal and the
 * static text of every template literal blanked to spaces, the `${…}` inside a
 * template kept (to any depth). So `'admin-tab'`, `data-btn="queue-mode"` in a
 * template and a word in a comment are not reads of anything; `${tab}` still is.
 * (ds-w3b, 2026-11-03: the check matched words anywhere, so a page could not
 * name a module `let` in a string or as a property without tripping it.)
 */
function codeOnly(text: string): string {
  let out = '';
  /** what each open `{` belongs to: true = it opened a template's `${` */
  const braces: boolean[] = [];
  let i = 0;
  const blank = (s: string): string => s.replace(/[^\n]/g, ' ');
  /** the static run of a template from i (just after its backtick or a `}` closing a `${`) */
  const templateRun = (): void => {
    const start = i;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i] === '`') { out += blank(text.slice(start, i)) + '`'; i++; return; }
      if (text[i] === '$' && text[i + 1] === '{') { out += blank(text.slice(start, i)) + '${'; i += 2; braces.push(true); return; }
      i++;
    }
    out += blank(text.slice(start));
  };
  while (i < text.length) {
    const c = text[i]!, n = text[i + 1];
    if (c === '/' && n === '/') { const e = text.indexOf('\n', i); const end = e < 0 ? text.length : e; out += blank(text.slice(i, end)); i = end; continue; }
    if (c === '/' && n === '*') { const e = text.indexOf('*/', i + 2); const end = e < 0 ? text.length : e + 2; out += blank(text.slice(i, end)); i = end; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      out += c + blank(text.slice(i + 1, j)) + c; i = j + 1; continue;
    }
    if (c === '`') { out += '`'; i++; templateRun(); continue; }
    if (c === '{') { braces.push(false); out += c; i++; continue; }
    if (c === '}') {
      out += c; i++;
      if (braces.pop()) templateRun();
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** what makes one exported …Html function impure, read off its file's source */
function impurities(text: string): string[] {
  const found: string[] = [];
  // what this file could reach that is not pure: other modules' namespaces,
  // and its own module-level `let` state
  const namespaces = [...text.matchAll(/^import \* as (\w+) from/gm)].map(m => m[1]!);
  const lets = [...text.matchAll(/^let (\w+)/gm)].map(m => m[1]!);
  for (const m of text.matchAll(/^export function (\w+Html)\(/gm)) {
    const name = m[1]!, body = codeOnly(bodyOf(text, m.index!));
    // a word that is not a property (`v.tab`, `x?.tab`) and not part of a longer name
    const word = (w: string): RegExp => new RegExp(`(^|[^.\\w$])${w.replace('.', '\\.')}(?![\\w$])`);
    for (const g of GLOBALS) {
      if (word(g).test(body)) found.push(`${name}() touches ${g} — gather it in the view function and pass it in`);
    }
    for (const ns of namespaces) {
      if (new RegExp(`(^|[^.\\w$])${ns}\\s*\\??\\.`).test(body)) found.push(`${name}() calls into ${ns}.* — that module's markup is a slot the view fills`);
    }
    for (const l of lets) {
      if (word(l).test(body)) found.push(`${name}() reads the module's own state \`${l}\` — put it in the view`);
    }
  }
  return found;
}

test('962 §1 every exported …Html function in ui/pages/ is pure', () => {
  let checked = 0;
  for (const f of FILES) {
    const text = src(f);
    checked += [...text.matchAll(/^export function (\w+Html)\(/gm)].length;
    assert.deepEqual(impurities(text), [], `pages/${f}`);
  }
  // positive control: the derived set is the pages this round extracted, not empty
  assert.ok(checked >= 8, `only ${checked} …Html functions found under ui/pages/ — the parse is not reading them`);
});

test('962 §1b the purity check reads code, not strings, comments or properties — and still catches a read', () => {
  const page = (body: string): string =>
    `import * as acct from '../account.ts';\nlet tab = 'stats';\nlet fetching = false;\nexport function fooHtml(v: V): string {\n${body}\n}\n`;
  // not reads: a string, a template's own text, a property, a comment, a longer name
  for (const ok of [
    "  return 'admin-tab' + \"tab\";",
    '  return `<button data-btn="admin-tab" class="tab">${v.tab}</button>`;',
    '  return `${v?.tab ?? \'\'}${v.fetching ? \'…\' : \'\'}`;',
    '  // the tab, while fetching, from document and window\n  return \'\';',
    '  /* tab */ return `${v.tabs.map(t => `<i>${t.tab}</i>`).join(\'\')} fetch the document`;',
    '  const tabName = v.tab, tab_ = 1; return `${tabName}${tab_}`;',
    "  return 'acct.me' + v.acct;",
  ]) assert.deepEqual(impurities(page(ok)), [], ok);
  // reads, wherever the code is: plain, in a template's ${}, nested, shorthand, a global, a namespace
  for (const [bad, want] of [
    ['  return tab;', /`tab`/],
    ['  return `<b>${tab}</b>`;', /`tab`/],
    ['  return `${v.on ? `<i>${fetching ? 1 : 2}</i>` : \'\'}`;', /`fetching`/],
    ['  return JSON.stringify({ tab });', /`tab`/],
    ['  return `${document.title}`;', /touches document/],
    ['  return String(Date.now());', /touches Date\.now/],
    ['  return `${acct.currentUser()}`;', /calls into acct/],
  ] as const) {
    const found = impurities(page(bad));
    assert.ok(found.some(f => want.test(f)), `${bad} → ${JSON.stringify(found)}`);
  }
});

test('962 §2 main.ts keeps no second copy of what moved to ui/pages/', () => {
  for (const name of ['deckPickerHtml', 'wireDeckPicker', 'importDeck', 'ensureDefaultDecks', 'singleDuelHtml',
    'wireSingleDuel', 'clockPickHtml', 'constructedOptionsHtml', 'chosenClockMs', 'renderSingleWaiting', 'caretIn',
    'restoreCaret']) {
    assert.doesNotMatch(MAIN, new RegExp(`\\nfunction ${name}\\(`), `main.ts defines ${name}() again`);
  }
  for (const name of ['HOME_TYPED', 'HOME_CARET', 'CLOCK_PRESETS', 'CLOCK_DEFAULT_BY_MODE', 'saveHomeName']) {
    assert.doesNotMatch(MAIN, new RegExp(`\\nconst ${name}\\b`), `main.ts declares ${name} again`);
  }
  for (const name of ['deckMsg', 'defaultDeckList', 'homeOptionsOpen', 'singleDuelOpen']) {
    assert.doesNotMatch(MAIN, new RegExp(`\\nlet ${name}\\b`), `main.ts holds ${name} again`);
  }
  // positive control: the router and the two wrappers are still there
  assert.match(MAIN, /\nfunction renderHome\(\): void \{[^]*?paintHome\(\$app, /);
  assert.match(MAIN, /\nfunction renderWaiting\(\): void \{[^]*?paintWaiting\(\$app, /);
  assert.match(MAIN, /\nfunction renderConnecting\(\): void \{[^]*?connectingHtml\(/);
});

const EMBER = { name: 'Ember Rush', author: 'Caleb', url: 'https://algomancer.cc/d/1', cards: Array(30).fill('X') };
const pv = (over: Partial<DeckPickerView> = {}): DeckPickerView =>
  ({ current: null, signedIn: false, mine: [], defaults: null, msg: '', ...over });

test('962 §3 the deck picker in each of its states', () => {
  assert.match(deckPickerHtml(pv()), /<div class="hint">loading the deck list…<\/div>/);
  assert.match(deckPickerHtml(pv({ signedIn: true })),
    /loading your decks…<\/div><button class="ui-button ui-button--secondary deckmanage" data-btn="deck-openpage" type="button">My decks →<\/button>/);
  // signed out, the bundled list plus import-by-link
  const out = deckPickerHtml(pv({ defaults: [EMBER] }));
  assert.match(out, /<option value="" selected disabled>choose a deck…<\/option><option value="d0" >Ember Rush — by Caleb<\/option>/);
  for (const b of ['deckimporturl', 'deckimporttext']) assert.match(out, new RegExp(`data-btn="${b}"`));
  assert.doesNotMatch(out, /deckmanage/, 'no My decks button signed out');
  assert.match(deckPickerHtml(pv({ defaults: [EMBER], current: EMBER })), /value="d0" selected>/);
  assert.match(deckPickerHtml(pv({ defaults: [EMBER], current: { name: 'Mine', author: 'Bo', cards: [] } })),
    /<option value="custom" selected>Mine — by Bo \(imported\)<\/option>/);
  // signed in with a collection: no import boxes, a stray deck is named as such
  const mine = [{ id: 'd1', name: 'A', author: 'you', cards: [] }, { id: 'd2', name: 'B', author: 'Bo', cards: [] }];
  const coll = deckPickerHtml(pv({ signedIn: true, mine, current: { id: 'zz', name: 'Gone', author: 'me', cards: [] } }));
  assert.match(coll, /<option value="c0" >A<\/option><option value="c1" >B — by Bo<\/option><option value="stray" selected>Gone \(not in your collection\)/);
  assert.doesNotMatch(coll, /deckimporturl/);
  // a statusMessage() since 2026-11-03 (the note tone is .deckmsg's look), still carrying .deckmsg
  assert.match(deckPickerHtml(pv({ msg: 'not playable: <x>' })), /<div class="ui-status ui-status--note deckmsg" role="status">not playable: &lt;x&gt;<\/div>/);
});

test('962 §4 the clock picker: Default, a preset, off', () => {
  const auto = clockPickHtml({ mode: 'draft', auto: true, now: 60 * 60_000, byModeMin: 60 });
  assert.match(auto, /data-clockpick="draft"/);
  assert.deepEqual([...auto.matchAll(/data-ms="([^"]+)"/g)].map(m => m[1]), ['auto', '0', '2700000', '3600000']);
  assert.match(auto, /class="elchip on" aria-pressed="true" data-btn="clockpick" data-ms="auto"/);
  assert.match(auto, /60m each/);
  const set = clockPickHtml({ mode: 'constructed', auto: false, now: 45 * 60_000, byModeMin: 45 });
  assert.match(set, /class="elchip on" aria-pressed="true"\s+data-btn="clockpick" data-ms="2700000" data-clockfor="constructed"/);
  assert.match(set, /running out of time loses the game/);
  assert.match(clockPickHtml({ mode: 'constructed', auto: false, now: 0, byModeMin: 45 }), /no clock — nobody can lose on time/);
});

test('962 §5 the connecting screen, and a refused join with its way home', () => {
  const wait = connectingHtml({ error: '' });
  assert.match(wait, /<p>Connecting to the server…<\/p>/);
  // in the app frame since 2026-11-04, as the rooms are: the toolbar's Home (gohome) is the
  // only button while it connects; the refusal adds its own way home below
  assert.deepEqual([...wait.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]), ['gohome']);
  assert.match(wait, /^<div class="ui-app-shell ui-app-shell--contained apppage joinscreen">/, 'report.ts still names it "join"');
  const refused = connectingHtml({ error: 'no room <QXZZ>' });
  assert.match(refused, /<p class="joinerr">no room &lt;QXZZ&gt;<\/p>/);
  assert.match(refused, /data-btn="gohome"/);
});
