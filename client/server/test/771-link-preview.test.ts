/* 771 — THE LINK PREVIEW: every page says what it is when its link is pasted.
 *
 * Owner, 2026-11-01: a link to ?league should unfurl in Discord as the league,
 * with a short description and a "Join us!"; ?cards as the card search; and
 * so on for every page — the comprehensive rules included. Discord's
 * unfurler runs no script, so server/linkpreview.ts writes the head per URL.
 *
 *   §1 every page image the table names is a real 1200×630 file, and the
 *      builder (ui/site-icons.py) draws exactly that list
 *   §2 ⭐ EVERY page the client opens off the query string has a preview of
 *      its own, or is declared not to need one — derived from the keys the
 *      client really reads, so a new `?page` cannot ship without one
 *   §3 the live part: league, challenge, room, deck, card, search, rule
 *   §4 ⭐ nothing a signed-out stranger could not see: a season, deck or room
 *      the server will not name gets the page's generic card
 *   §5 the head: the real index.html takes every value, escaped; a card scan
 *      states no size; a page with no tags of its own is given the set; a
 *      template that lost a tag fails loudly instead of silently not varying
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CR_PAGE_URL } from '../../ui/assets.ts';
import {
  deckTrio, imagePath, PAGE_IMAGES, previewFor, withPreview, type Preview, type PreviewCtx,
} from '../linkpreview.ts';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ui');
const ORIGIN = 'https://algomancy.online';

/** a context that knows nothing — every live question answers "nothing to say" */
const NONE: PreviewCtx = {
  origin: ORIGIN,
  league: () => null, challenge: () => null, room: () => null, deck: () => null,
  card: () => null, searchCount: () => null, rule: () => null,
};
const at = (search: string, ctx: Partial<PreviewCtx> = {}): Preview =>
  previewFor(new URL(`${ORIGIN}/${search}`), { ...NONE, ...ctx });
const imageOf = (p: Preview): string => p.image.slice(ORIGIN.length);

/** a JPEG's pixel size, off its first SOF marker */
function jpegSize(buf: Buffer): [number, number] {
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1]!;
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    }
    i += 2 + len;
  }
  throw new Error('no SOF marker');
}

test('§1 every page image is a real 1200×630 file, and the builder draws exactly these', () => {
  for (const p of PAGE_IMAGES) {
    const file = join(UI, imagePath(p).slice(1));
    assert.deepEqual(jpegSize(readFileSync(file)), [1200, 630], `${imagePath(p)} is not 1200×630`);
  }
  const py = readFileSync(join(UI, 'site-icons.py'), 'utf8');
  const block = py.match(/\nPAGES = \{([^]*?)\n\}\n/)?.[1] ?? '';
  const drawn = [...block.matchAll(/^ {4}"([a-z]+)": \(/gm)].map(m => m[1]);
  assert.deepEqual([...drawn].sort(), PAGE_IMAGES.filter(p => p !== 'home').sort(),
    'site-icons.py PAGES and linkpreview.ts PAGE_IMAGES name different pages');
  const onDisk = readdirSync(join(UI, 'og')).filter(f => f.endsWith('.jpg')).map(f => f.slice(0, -4));
  assert.deepEqual(onDisk.sort(), [...drawn].sort(), 'ui/og/ holds an image no page uses, or misses one');
});

/* The query keys that are not pages: what a page link carries besides its
 * page. Each needs no preview of its own — the page it rides on has one. */
const NOT_A_PAGE: Record<string, string> = {
  at: 'a rule or a moment within the page', bo: 'a room setting (best of 1 or 3)', board: "a past week's board on the challenge page",
  c: 'a comment on the review page', cc: 'a room setting (join a Competitive match: pick a deck first)', ccdeck: 'a room setting (the deck picked for a Competitive match)', clock: 'a room setting', el: 'the learner\'s element',
  els: 'a room setting', id: 'which challenge', mode: 'a room setting', new: 'a fresh lesson game',
  q: 'the card search query', ranked: 'a queue setting', run: 'which challenge run',
  seat: 'which seat of a room', signin: 'sign in, then the page', single: 'a room setting',
  tips: 'a lesson game with the client tips only',
  vs: 'whose queued game', watch: 'spectate the room',
};
/* Pages that keep the home card on purpose. */
const HOME_CARD: Record<string, string> = {
  admin: 'the operator dashboard — nobody shares it',
  demo: 'the scripted mid-battle rig, for development',
  judging: 'the judges\' review of the rules bot — staff only, nobody shares it',
};

test('§2 ⭐ every page the client opens off the URL has its own preview, or is declared', () => {
  const keys = new Set<string>();
  // ui/ and ui/pages/ (the design-system round moved the page modules there, 2026-11-03)
  const files = [...readdirSync(UI).filter(f => f.endsWith('.ts')),
    ...readdirSync(join(UI, 'pages')).filter(f => f.endsWith('.ts')).map(f => join('pages', f))];
  for (const f of files) {
    const src = readFileSync(join(UI, f), 'utf8');
    for (const m of src.matchAll(/\b(?:params|url|q)\.(?:get|has)\('([a-z]+)'\)|URLSearchParams\(location\.search\)\.(?:get|has)\('([a-z]+)'\)/g)) {
      keys.add((m[1] ?? m[2])!);
    }
  }
  // the reader really read: these are long-standing pages
  for (const k of ['league', 'cards', 'challenge', 'room', 'replay', 'rules']) assert.ok(keys.has(k), `never saw ?${k}`);
  const home = at('');
  for (const k of [...keys].sort()) {
    if (k in NOT_A_PAGE) continue;
    const p = at(`?${k}=1`);
    if (k in HOME_CARD) { assert.equal(p.image, home.image, `?${k} was declared to keep the home card`); continue; }
    assert.notEqual(p.title, home.title,
      `?${k} is a page the client opens, and its link unfurls as the home page — give it a preview in ` +
      'server/linkpreview.ts, or declare it here (NOT_A_PAGE / HOME_CARD) with the reason');
  }
  // and nothing stale in the declarations
  for (const k of [...Object.keys(NOT_A_PAGE), ...Object.keys(HOME_CARD)]) {
    assert.ok(keys.has(k), `?${k} is declared here but the client no longer reads it`);
  }
});

test('§2b the pages the owner named, each with its own image', () => {
  // the rules page's path: the browser's constant and the server's route agree
  const main = readFileSync(join(UI, '..', 'server', 'main.ts'), 'utf8');
  assert.match(main, new RegExp(`const CR_PAGE_URL = '${CR_PAGE_URL}';`), 'server/main.ts serves the rules page somewhere else');
  assert.equal(imageOf(at('?league')), '/og/league.jpg');
  assert.match(at('?league').description, /Join us!/);
  assert.equal(imageOf(at('?cards=1')), '/og/cards.jpg');
  assert.match(at('?cards=1').description, /Scryfall/);
  assert.equal(imageOf(at('?rules=cr')), '/og/rules.jpg');
  assert.match(at('?rules=cr').title, /Comprehensive Rules/);
  assert.equal(imageOf(at('')), '/og-image.jpg');
  assert.equal(imageOf(at('?nonsense=1')), '/og-image.jpg');
  // og:url is the link as shared
  assert.equal(at('?league=2026-11').url, `${ORIGIN}/?league=2026-11`);
});

test('§3 the live part says what the server knows', () => {
  const season = {
    name: 'November 2026', format: 'constructed' as const, phase: 'Sign-up week', players: 7,
    joinable: true, announced: false, finished: false,
  };
  let asked: string | null | undefined;
  const lg = at('?league=2026-11', { league: id => { asked = id; return season; } });
  assert.equal(asked, '2026-11');
  assert.equal(lg.title, 'November 2026 Algomancy League');
  assert.match(lg.description, /^Sign-ups are open for this constructed season, and 7 players have joined so far\./);
  assert.match(lg.description, /Join us!$/);
  at('?league=1', { league: id => { asked = id; return season; } });
  assert.equal(asked, null, '?league=1 is the current season');
  const running = at('?league', { league: () => ({ ...season, phase: 'Week 2 of 4', joinable: false }) });
  assert.doesNotMatch(running.description, /join us/i, 'a season that cannot be joined does not say "join us"');

  const ch = at('?challenge', { challenge: () => ({ title: 'Something Big', blurb: 'Deal 50 damage in one hit.', closes: Date.UTC(2026, 10, 8, 7) }) });
  assert.equal(ch.title, 'Weekly Challenge: Something Big');
  assert.match(ch.description, /^This week's puzzle: Deal 50 damage in one hit\. .* It closes on Sunday 8 November\.$/);

  const room = at('?ws=1&room=abcd', { room: code => (code === 'ABCD' ? { label: 'Live draft', host: 'Nyar', open: true, finished: false } : null) });
  assert.equal(room.title, "Join Nyar's game of Algomancy");
  assert.match(room.description, /^Nyar is waiting for an opponent in a live draft game\./);

  const scan = '/data/cards/Pack-Leader.jpg';
  const card = { name: 'Pack Leader', type: 'Plant Unit', scan, text: 'Create a 1/1 {wood} unit.' };
  const deck = at('?deck=d1', {
    deck: () => ({ name: 'Green Machine', author: 'Tomzy', size: 30, image: '/og/deck/d1.jpg?v=abc' }),
  });
  assert.equal(deck.title, 'Green Machine, an Algomancy deck');
  assert.equal(deck.image, `${ORIGIN}/og/deck/d1.jpg?v=abc`, 'a deck shows its own drawn picture');
  assert.deepEqual(deck.imageSize, [1200, 630]);
  const bare = at('?deck=d1', { deck: () => ({ name: 'Empty', author: 'Tomzy', size: 0, image: null }) });
  assert.equal(imageOf(bare), '/og/decks.jpg', 'a deck with nothing to draw gets the decks picture');

  // a card's own link: its scan, its name, its type and its text
  const one = at('?card=Pack%20Leader', { card: n => (n === 'Pack Leader' ? card : null) });
  assert.equal(one.title, 'Pack Leader');
  assert.equal(one.description, 'Plant Unit. Create a 1/1 wood unit.');
  assert.equal(one.image, ORIGIN + scan);
  assert.equal(one.imageSize, undefined, 'a scan is not 1200×630, so no size is stated');
  assert.equal(at('?card=Nothing').title, 'Algomancy card search', 'an unknown card is the search page');

  const stats = at('?cardstats=Pack%20Leader', { card: n => (n === 'Pack Leader' ? card : null) });
  assert.equal(stats.title, 'Pack Leader card stats');
  assert.equal(stats.image, ORIGIN + scan);

  const search = at('?cards=1&q=t%3Aunit%20e%3Afire', { searchCount: q => (q === 't:unit e:fire' ? 42 : null) });
  assert.equal(search.title, 'Algomancy card search: t:unit e:fire');
  assert.match(search.description, /^42 cards match this search\./);

  const rule = at('?rules=cr&at=608.2b', { rule: n => (n === '608.2b' ? { num: '608.2b', heading: 'Resolving', text: 'A {fire} spell [resolves].' } : null) });
  assert.equal(rule.title, 'Comprehensive Rules 608.2b: Resolving');
  assert.equal(rule.description, 'A fire spell resolves.', 'the oracle tokens read as words');
});

test('§4 ⭐ what the server will not name, the preview does not either', () => {
  // a hidden season, a private deck, a room code that is gone: the ctx answers
  // null (canSee / sharedDeck / getRoom) and the page's generic card is shown
  assert.equal(at('?league=secret').title, 'The Algomancy League');
  assert.equal(at('?deck=private').title, 'An Algomancy deck');
  assert.equal(imageOf(at('?deck=private')), '/og/decks.jpg');
  assert.equal(at('?room=GONE').title, 'Join a game of Algomancy');
  // a replay is its players' own: the preview has no way to ask whose it is
  assert.equal(at('?replay=ABCD').title, 'A game of Algomancy, replayed');
  // a seat already decided says so, and names nobody's seat as open
  const done = at('?room=ABCD', { room: () => ({ label: 'Constructed', host: 'Nyar', open: false, finished: true }) });
  assert.match(done.title, /is over/);
});

test('§5 the head: index.html takes every value, escaped; the rest of the page is untouched', () => {
  const index = readFileSync(join(UI, 'index.html'), 'utf8');
  const p = at('?cards=1&q=%22%3Cb%3E%22', { searchCount: () => 3 });
  const out = withPreview(index, p);
  const meta = (prop: string): string | undefined =>
    out.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)">`))?.[1];
  assert.equal(meta('og:title'), 'Algomancy card search: &quot;&lt;b&gt;&quot;');
  assert.equal(meta('og:description'), meta('description'));
  assert.equal(meta('og:url'), `${ORIGIN}/?cards=1&amp;q=%22%3Cb%3E%22`);
  assert.equal(meta('og:image'), `${ORIGIN}/og/cards.jpg`);
  assert.equal(meta('og:image:width'), '1200');
  assert.equal(meta('og:image:height'), '630');
  assert.match(out, /<title>Algomancy<\/title>/, 'the tab title is the client\'s, not the preview\'s');
  assert.doesNotMatch(out, /<b>/, 'the query reached the page unescaped');
  // everything outside the head's preview tags is byte-for-byte the file
  const strip = (s: string): string => s.replace(/<meta (?:property="og:[a-z:]+"|name="description") content="[^"]*">\s*/g, '');
  assert.equal(strip(out), strip(index));
  // home stays home
  assert.equal(withPreview(index, at('')), index, 'the home page is index.html exactly as committed');

  // a card scan: the size tags go, rather than lie
  const scan = withPreview(index, at('?cardstats=X', { card: () => ({ name: 'X', type: 'Unit', scan: '/data/cards/X.jpg', text: '' }) }));
  assert.doesNotMatch(scan, /og:image:width/);

  // a page with no preview tags of its own gets the whole set after its title
  const bare = '<!doctype html><html><head><title>Rules</title><style>x</style></head><body>b</body></html>';
  const given = withPreview(bare, at('?rules=cr'));
  assert.match(given, /<title>Rules<\/title>\n<meta name="description"[^]*<meta name="twitter:card" content="summary_large_image">\n?<style>/);
  assert.ok(given.endsWith('<style>x</style></head><body>b</body></html>'));

  // a template that lost a tag fails, rather than unfurling every page as home
  assert.throws(() => withPreview(index.replace(/<meta property="og:url"[^>]*>/, ''), p), /og:url/);
});

test('§6 a deck\'s picture: the cover in front, two more of its cards, several elements', () => {
  const facts: Record<string, { element: string; cost: number }> = {
    Cover: { element: 'fire', cost: 3 }, FireA: { element: 'fire', cost: 5 }, FireB: { element: 'fire', cost: 2 },
    Water: { element: 'water', cost: 1 }, Wood: { element: 'wood', cost: 4 }, NoArt: { element: 'earth', cost: 9 },
  };
  const f = (n: string) => (facts[n] ? { ...facts[n]!, hasScan: n !== 'NoArt' } : null);
  const deck = ['Cover', 'FireA', 'FireA', 'FireA', 'FireB', 'FireB', 'FireB', 'Water', 'Water', 'Wood', 'Wood', 'NoArt', 'NoArt', 'NoArt', 'NoArt'];
  // most copies first, but a new element beats a third fire card; no scan, no place
  assert.deepEqual(deckTrio(deck, 'Cover', f), ['Cover', 'Wood', 'Water']);
  // a one-element deck still fills the fan, most copies and then the dearer first
  assert.deepEqual(deckTrio(['Cover', 'FireB', 'FireB', 'FireA', 'FireA'], 'Cover', f), ['Cover', 'FireA', 'FireB']);
  // no cover: the deck's own best card leads
  assert.deepEqual(deckTrio(['Water', 'FireA', 'FireA'], null, f), ['FireA', 'Water']);
  assert.deepEqual(deckTrio(['NoArt'], 'NoArt', f), []);
});
