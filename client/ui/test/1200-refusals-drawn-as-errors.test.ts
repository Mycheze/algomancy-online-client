/* 1200 · A REFUSAL OUTSIDE THE GAME IS DRAWN AS AN ERROR, NOT IN THE GOLD OF A NOTE
 * (BL-10, the visual polish pass, 2026-11-09).
 *
 * The design-system round (2026-11-03) moved every page's message line onto
 * the status component "under today's look": the `note` tone, which is the old
 * `.deckmsg` gold. On these screens that line only ever holds a failure — the
 * server refused the room, "disconnected from the server — reconnecting…",
 * "could not reach the server", a wrong password, an invite that did not go —
 * and gold is the colour the same screens use for a success ("loaded X", the
 * headline). So a refusal read like good news (inventory 05 §18: "Errors and
 * successes share .deckmsg gold"). The queue, the profile and the admin page
 * already drew theirs red; these seven sites were left:
 *
 *   home's Play card · the Constructed and Single Card Duel waiting rooms ·
 *   the match room and its sideboard bar · the sign-in screen · the
 *   waiting rooms' "Invite a friend" panel
 *
 *   §1 each of those modules draws its failure line with the error tone
 *      (red, role="alert", read out at once), and no page writes the raw
 *      `<p class="deckmsg">` any more
 *   §2 the CSS: nothing gives `.pageerr` a colour of its own, so the error
 *      tone's red is what shows; `.deckmsg` (still the gold of a note) is not
 *      on any error line
 *
 *   §3 the draft lobby (2026-11-09, inventory 05 §18.16): it was the one
 *      waiting room that drew no failure line at all. The page took no error,
 *      so "disconnected from the server — reconnecting…" and a refused lock-in
 *      played the error sound over a lobby that said nothing. It now draws the
 *      same red line as the other two waiting rooms, and the dispatcher hands
 *      it the error.
 *
 * The rendered markup is pinned beside each page's own tests (960, 961, 973,
 * 977, 978). No browser runs here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readStyles } from './read-styles.ts';
import { statusMessage } from '../components/index.ts';
import { lobbyHtml, type LobbyView } from '../pages/lobby.ts';

const page = (f: string): string => readFileSync(new URL(`../pages/${f}`, import.meta.url), 'utf8');
const ERR = (text: string): RegExp =>
  new RegExp(`statusMessage\\(\\{ tag: 'p', tone: 'error', className: 'pageerr', text: ${text.replace(/\./g, '\\.')} \\}\\)`, 'g');

const SITES: readonly [file: string, text: string, count: number][] = [
  ['home.ts', 'v.error', 1],
  ['waiting.ts', 'v.error', 2],      // Constructed, Single Card Duel
  ['match.ts', 'v.error', 2],        // the room, the sideboard bar
  ['signin.ts', 'authMsg', 1],
  ['inbox.ts', 'v.msg', 1],          // the rooms' "Invite a friend" panel
  ['lobby.ts', 'v.error', 1],        // the draft lobby (§3)
];

test('§0 positive control: the error tone is red and read out; the note tone is not', () => {
  assert.equal(statusMessage({ tag: 'p', tone: 'error', className: 'pageerr', text: 'x' }),
    '<p class="ui-status ui-status--error pageerr" role="alert">x</p>');
  assert.doesNotMatch(statusMessage({ tag: 'p', className: 'deckmsg', text: 'x' }), /--error|alert/);
});

test('§1 every failure line on those screens uses the error tone', () => {
  for (const [file, text, count] of SITES) {
    const src = page(file);
    assert.equal([...src.matchAll(ERR(text))].length, count, `${file}: ${count} error line(s) drawing ${text}`);
    assert.doesNotMatch(src, new RegExp(`className: 'deckmsg', text: ${text.replace(/\./g, '\\.')}\\b`),
      `${file}: ${text} is never drawn in the note's gold`);
  }
  for (const file of ['home.ts', 'lobby.ts', 'waiting.ts', 'match.ts', 'signin.ts', 'inbox.ts', 'deckpicker.ts']) {
    assert.doesNotMatch(page(file), /<p class="deckmsg">/, `${file}: no hand-written gold message line`);
  }
});

test('§2 the CSS lets the error red show', () => {
  const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.match(css, /\.ui-status--error\s*\{[^}]*color:\s*var\(--color-danger\)/, 'positive control: the tone is red');
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (/\.pageerr\b/.test(m[1]!)) {
      assert.doesNotMatch(m[2]!, /(^|[;\s])color\s*:/, `no rule colours .pageerr: ${m[1]!.trim()}`);
    }
  }
  // the two places that pull the line tight still do, under its new name
  assert.match(css, /\.homeplayfoot \.pageerr\s*\{\s*margin:\s*0;?\s*\}/);
  assert.match(css, /\.ccsbbar \.pageerr\s*\{\s*margin:\s*0;?\s*\}/);
});

test('§3 the draft lobby draws the failure line, and the dispatcher hands it the error', () => {
  const view = (error?: string): LobbyView => ({
    lobby: { method: 'pick-one', methods: [{ id: 'pick-one', label: 'One each', blurb: 'b' }], locked: [false, false], mine: {} },
    seat: 0, names: ['Ann', 'Bo'], peers: [true, true], room: 'QXZZ', link: 'http://x/?room=QXZZ&seat=1',
    pick: null, ranking: [], ready: false, chrome: { signedIn: true, alerts: 0 },
    ...(error === undefined ? {} : { error }),
  });
  const msg = 'disconnected from the server — reconnecting in 2s…';
  const html = lobbyHtml(view(msg));
  assert.ok(html.includes(statusMessage({ tag: 'p', tone: 'error', className: 'pageerr', text: msg })), 'the red, read-out line');
  assert.ok(html.indexOf('role="alert"') > html.indexOf('class="lobbyfoot"'), 'under the seats, as in the other rooms');
  for (const quiet of [lobbyHtml(view('')), lobbyHtml(view())]) {
    assert.doesNotMatch(quiet, /role="alert"|pageerr/, 'no error, no line and no empty section');
  }
  // pages/waiting.ts paintWaiting's trio branch passes the error it was handed
  const trio = page('waiting.ts').match(/if \(w\.trio\) \{[^]*?return;\s*\}/)?.[0] ?? '';
  assert.match(trio, /lobbyView\(\{/, 'positive control: found the trio branch');
  assert.match(trio, /\berror\b/, 'the trio branch hands the lobby the error');
});
