/* 299 — THE FRONT DOOR: what a stranger's browser gets before they have played.
 *
 * Owner, 2026-09-15, the day after the site went public: there was no favicon,
 * no way to the rules without starting a game, no rulebook, and nothing that
 * says the site wants you from a background tab. One round fixed all of it,
 * and each fix is a promise about a FILE or a ROUTE that nothing else checks:
 *
 *   §1  every icon index.html links is a real file, relative (so file:// works
 *       too), with an extension the server knows how to type
 *   §2  the link preview — og:image is absolute and names a real file
 *   §3  the rulebook: the URL the client frames is a file on disk, the server
 *       routes exactly that one file, and the edge lets the site frame it
 *   §4  the Rulebook tab frames that URL and offers a way out to a full tab
 *   §5  the Discord invite, and the footer's way into the help box
 *   §6  the help box is reachable off the board, as a layer, not an overlay
 *   §7  the background-tab title flash, and the three places that raise it
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RULEBOOK_URL } from '../assets.ts';
import { DISCORD_INVITE, footHtml } from '../legal.ts';
import { helpBoxHtml, rulesBoxHtml, setHelpTab } from '../rules.ts';
import { flashTitle } from '../tabalert.ts';
import { RULES_DIR } from '../../engine/scripts/paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_DIR = resolve(HERE, '..');
const REPO = resolve(UI_DIR, '..', '..');
const read = (...p: string[]): string => readFileSync(join(...p), 'utf8');
const INDEX = read(UI_DIR, 'index.html');
const SERVER = read(UI_DIR, '..', 'server', 'main.ts');
const MAIN = read(UI_DIR, 'main.ts');
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** the extensions server/main.ts's MIME table types — anything else is a 404 */
const MIME_EXTS = new Set([...(SERVER.match(/const MIME[^]*?\n\};/)?.[0] ?? '').matchAll(/'(\.[a-z0-9]+)':/g)].map(m => m[1]));

test('§0 the MIME table was really read', () => {
  assert.ok(MIME_EXTS.has('.html') && MIME_EXTS.has('.js'), `parsed ${[...MIME_EXTS].join(' ')}`);
});

test('§1 every icon the page links exists, is relative, and is a type the server serves', () => {
  const hrefs = [...INDEX.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*?href="([^"]+)"/g)].map(m => m[1]!);
  assert.ok(hrefs.length >= 3, `expected the .ico, a png and the apple-touch icon, found ${hrefs.join(', ')}`);
  for (const href of hrefs) {
    assert.ok(!href.startsWith('/') && !href.includes('://'), `${href} is not relative — the file:// rig would lose it`);
    assert.ok(existsSync(join(UI_DIR, href)), `index.html links ${href}, which is not in client/ui/`);
    assert.ok(MIME_EXTS.has(extname(href)), `the server has no MIME type for ${extname(href)}, so ${href} would 404`);
  }
  // a browser asks for /favicon.ico whatever the page says
  assert.ok(existsSync(join(UI_DIR, 'favicon.ico')), 'no client/ui/favicon.ico for the implicit /favicon.ico request');
});

test('§2 the link preview names an absolute image that is really there', () => {
  for (const p of ['og:title', 'og:description', 'og:url', 'og:image']) {
    assert.match(INDEX, new RegExp(`<meta property="${p}" content="[^"]+">`), `index.html has no ${p}`);
  }
  assert.match(INDEX, /<meta name="description" content="[^"]+">/);
  assert.match(INDEX, /<meta name="twitter:card" content="summary_large_image">/);
  const img = INDEX.match(/<meta property="og:image" content="([^"]+)">/)![1]!;
  assert.match(img, /^https:\/\//, 'og:image must be an absolute https URL — a crawler has no page to resolve it against');
  const file = new URL(img).pathname.slice(1);
  assert.ok(existsSync(join(UI_DIR, file)), `og:image is ${img}, but client/ui/${file} does not exist`);
  assert.ok(MIME_EXTS.has(extname(file)), `the server cannot type ${file}`);
});

test('§3 the rulebook: a real file, served by exactly one route, frameable by the site itself', () => {
  const name = basename(RULEBOOK_URL);
  assert.equal(RULEBOOK_URL, `/data/rules/${name}`);
  assert.ok(existsSync(join(RULES_DIR, name)), `RULEBOOK_URL names ${name}, which is not in data/rules/`);
  assert.ok(MIME_EXTS.has('.pdf'), 'the server has no MIME type for .pdf');
  assert.match(SERVER, new RegExp(`path === '${esc(RULEBOOK_URL)}'[^]{0,200}?'data', 'rules', '${esc(name)}'`),
    'server/main.ts does not route RULEBOOK_URL to that file');
  assert.doesNotMatch(SERVER, /startsWith\('\/data\/rules\//,
    'the server serves the whole of data/rules/ — it is the bot corpus, only the rulebook is public');
  // the edge sends X-Frame-Options: DENY, which refuses even a same-origin frame
  const caddy = read(REPO, 'deploy', 'Caddyfile');
  assert.match(caddy, new RegExp(`@rulebook path ${esc(RULEBOOK_URL)}\\s*\\n\\s*header @rulebook X-Frame-Options "SAMEORIGIN"`),
    'deploy/Caddyfile does not let the site frame the rulebook');
  assert.match(caddy, new RegExp(`@notrulebook not path ${esc(RULEBOOK_URL)}\\s*\\n\\s*header @notrulebook X-Frame-Options "DENY"`),
    'deploy/Caddyfile no longer denies framing everything else');
});

test('§4 the Rulebook tab frames the book, links it out, and has no search box', () => {
  const book = rulesBoxHtml('book', '');
  assert.match(book, new RegExp(`<iframe class="bookframe" src="${esc(RULEBOOK_URL)}"`));
  assert.match(book, new RegExp(`<a class="bookopen" href="${esc(RULEBOOK_URL)}" target="_blank" rel="noopener">`),
    'no way out to a full tab — a phone shows a framed PDF badly');
  assert.ok(book.includes(DISCORD_INVITE), 'the Rulebook tab no longer points at the Discord');
  assert.doesNotMatch(book, /id="rules-q"/, 'there is nothing to search on the book tab');
  assert.match(book, /class="helptab on" data-btn="helptab" data-tab="book"/);
  // the tab the box remembers accepts "book", and nothing unknown
  setHelpTab('book');
  assert.match(helpBoxHtml(), /<iframe/);
  setHelpTab('nonsense');
  assert.match(helpBoxHtml(), /id="rules-q"/);
  setHelpTab('rules');
});

test('§5 the Discord invite is the one his site links, and the footer carries it and the help button', () => {
  assert.match(DISCORD_INVITE, /^https:\/\/discord\.gg\/[A-Za-z0-9]+$/);
  const foot = footHtml();
  assert.ok(foot.includes(`href="${DISCORD_INVITE}"`), 'the footer lost the Discord link');
  assert.match(foot, /data-help="rules"/, 'the footer lost its way into the help box');
});

test('§6 the help box is reachable off the board, from a layer that is not a board overlay', () => {
  const home = MAIN.match(/function renderHome\(\): void \{[^]*?\n\}\n/)?.[0] ?? '';
  assert.ok(home.length > 1000, 'could not find renderHome');
  assert.match(home, /data-help="rules"/, 'the home screen has no "How to play" button');
  assert.match(MAIN, /\ninstallHelpLayer\(\);/, 'main.ts never installs the help layer');
  const layer = read(UI_DIR, 'helplayer.ts');
  assert.doesNotMatch(layer, /class="overlay/,
    'the layer uses class="overlay" — 269 would count it as a board overlay and main.ts would close it as one');
  assert.match(layer, /\{ capture: true \}/);
  assert.match(layer, /e\.stopPropagation\(\)/,
    "the layer's clicks must stop before main.ts's handler, which paints the board on the home screen");
});

test('§7 the title flashes the reason, and the three moments that want you raise it', () => {
  assert.equal(flashTitle('Match found!', 0), 'Match found! — Algomancy');
  assert.equal(flashTitle('Match found!', 1), 'Algomancy');
  assert.equal(flashTitle('Your move', 2, 'X'), 'Your move — X');

  const queue = read(UI_DIR, 'queue.ts');
  assert.match(queue, /if \(next && !offer\) \{[^}]*alertTab\(/, 'a match offer no longer flashes the tab');
  const sound = MAIN.match(/function soundPass\(\): void \{[^]*?\n\}\n/)?.[0] ?? '';
  assert.match(sound, /alertTab\('Your move'\)/, 'being asked to act no longer flashes the tab');
  assert.match(MAIN, /if \(this\.waiting\) alertTab\(/, 'the room filling up no longer flashes the tab');
  // the opponent arriving is read where `peers` is actually applied — onMsg copies
  // m.peers before any branch runs, so a comparison further down sees no change
  const peersAt = MAIN.indexOf('if (m.peers) this.peers = m.peers;');
  assert.ok(peersAt > 0, 'onMsg no longer applies m.peers in one place — re-find where the opponent arrives');
  assert.match(MAIN.slice(peersAt - 400, peersAt), /alertTab\('Your opponent is here'\)/,
    'the opponent connecting no longer flashes the tab');
});
