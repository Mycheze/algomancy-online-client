/* TWO PLAYTEST REPORTS ABOUT THINGS THE CLIENT THROWS AWAY ON EVERY PAINT.
 *
 *  [142] CT-155, room QJEY: "There's an annoying UX bug thing where the page
 *        resets/scrolls to the top on any change. It happens on most pages
 *        (deck building, in game) and also resets the hover effects. It even
 *        happens when the other player is doing things in a hidden zone, which
 *        just feels clunky."
 *  [145] CT-158, room QJEY: "Now that the game log is hidden, it should show
 *        the ENTIRE log, without cutting things off."
 *
 * ── WHAT [142] IS NOT, MEASURED IN HEADLESS CHROME BEFORE ANY EDIT ───────
 *
 * The obvious reading is that `renderNow` forgets a scroll position, and the
 * obvious fix is to add the window to `SCROLLERS`. BOTH ARE WRONG, and the
 * measurements are here so nobody spends the afternoon again:
 *
 *   · IN GAME THE WINDOW CANNOT SCROLL AT ALL. `#app.board` is
 *     `height: 100vh; overflow: hidden` (style.css §board) and `.main` is the
 *     only scroller. Measured on ?demo=1 at 1400x900: document scrollHeight
 *     813 against clientHeight 813. Adding the window to `SCROLLERS` is a
 *     literal no-op on the board.
 *   · `.main` IS ALREADY RESTORED, and it works. Scrolled to 238 and then
 *     through motion / sound / help-open / help-close / a card click: 238
 *     every time, one `$app.innerHTML` write per click.
 *   · REPLACING `$app.innerHTML` DOES NOT, BY ITSELF, RESET THE DOCUMENT
 *     SCROLL. The card browser is 5595px tall on an 813px viewport; scrolled
 *     to 1200 and 2000 it survived a focus repaint and a "load more" repaint
 *     with the position exactly intact.
 *
 * ── WHAT [142] IS ──────────────────────────────────────────────────────
 *
 * §2 — THE CARD IMAGE HAS NO RESERVED HEIGHT, so a board that has just been
 * repainted is SHORTER than the board it replaced for as long as its art
 * takes to arrive, and `restoreViewport` writes the old `scrollTop` into that
 * short frame, where the browser clamps it. Measured on ?demo=1 over HTTP,
 * every `<img>` given a fresh URL so the paint is the "a card this client has
 * never shown" case that the report describes ("when the other player is doing
 * things in a hidden zone"):
 *
 *     BEFORE   .main scrollTop     578 -> 379 (at paint) -> 468 (settled)
 *              .main scrollHeight  974 -> 775            -> 974
 *     AFTER    .main scrollTop     578 -> 578            -> 578
 *              .main scrollHeight  974 -> 974            -> 974
 *
 * 37 images, 0 of them `complete` at paint time, 199px of the board missing,
 * and 110px of the player's scroll gone for good. With the art already decoded
 * the same click loses nothing — which is exactly why it reads as intermittent
 * and "on any change".
 *
 * ⚠ AND `.card img` WAS NOT THE WHOLE OF IT. With only that fixed the board
 * was still 46px short at paint time and 10 images still collapsed — all of
 * them `.rescard img`, the resource cards, whose scans are the same 720x1000
 * and whose rule was the same width-only one. That is why §2 SWEEPS the
 * stylesheet for width-driven image rules instead of naming `.card img`: a
 * list would have stopped at the first one and shipped 46px of the bug.
 *
 * §3 — THE HOVER TIP IS KILLED BY CONSTRUCTION. `hideHoverTip()` was the first
 * statement of `renderNow()`, unconditionally, so every paint closed the card
 * box the player was reading. Measured in headless Chrome with real
 * `Input.dispatchMouseEvent` (a synthetic `el.dispatchEvent` does not exercise
 * the path), hovering a board card and then repainting WITHOUT MOVING THE
 * MOUSE:
 *
 *                          before the fix     after
 *     CSS :hover           kept               kept    (Chrome re-resolves it)
 *     #preview focus rail  kept               kept    (repaintFocus)
 *     #hovertip opacity    1 -> 0             1 -> 1
 *
 * So "resets the hover effects" is the long-hover text box and nothing else,
 * and it is the whole of the in-game complaint: the scroll does not move, the
 * highlight does not drop, and exactly one repaint happens — the card box the
 * player was reading simply closes.
 *
 * ⚠ AND THE RULE, NOT THE LISTENER, IS WHAT IS TESTED HERE — see
 * test/199-hover-scroll.test.ts, which says at length why a tooltip assertion
 * CANNOT be written in test/ui-driver.ts (no mouseover, `#hovertip` in
 * ABSENT, `classList.contains` flat false). R230 answered that by moving the
 * decision into a pure function; R272 does the same, in ui/hover.ts. The
 * WIRING is what the browser numbers above are evidence for.
 *
 * ── [145] AND THE TWO CURTAINS IT IS NOT ABOUT ──────────────────────────
 *
 * `logPanelHtml()` drew a window on the last 80 lines. That number was sized
 * for the 290px rail column the panel lived in before CT-124 moved it into the
 * `.logbox` modal, and it outlived the panel it was written for. §1 removes
 * it — and asserts, in the same test, that the OTHER TWO curtains over the
 * same observable are untouched: R80's `untold`/`heldLines` pacing curtain and
 * the #125 story/verbose fold. A guard that counts log rows can go red for a
 * reason unrelated to what it tests; this repo has already been bitten by that
 * once, when the story view landed.
 *
 * Seeds 25200-25299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { client, closeLog, openLog } from './ui-driver.ts';
import { toDeployment } from './util.ts';
import { CARDS_DIR, REPO_ROOT } from '../scripts/paths.mjs';
import { hoverSurvivesPaint } from '../../ui/hover.ts';
import type { Seat } from '../src/types.ts';

const CSS = readFileSync(join(REPO_ROOT, 'client', 'ui', 'style.css'), 'utf8');

/* ══ §1 — [145] THE LOG MODAL SHOWS THE WHOLE LOG ════════════════════════ */

/** the log lines on screen, bounded at the panel's own closing tag — the same
 * walk 226 and 146 use, and for the same reason (the Close button that follows
 * the panel in the modal otherwise lands on the tail line) */
function logLines(html: string): string[] {
  const from = html.indexOf('<div class="logpanel"');
  assert.ok(from >= 0, 'the log panel is on screen — open it with openLog() first');
  let i = from + 4, depth = 1, end = html.length;
  for (;;) {
    const open = html.indexOf('<div', i), close = html.indexOf('</div>', i);
    assert.ok(close >= 0, 'unbalanced markup around the log panel');
    if (open >= 0 && open < close) { depth++; i = open + 4; continue; }
    depth--; i = close + 6;
    if (depth === 0) { end = close; break; }
  }
  return [...html.slice(from, end).matchAll(/<div class="([^"]*)">((?:(?!<div)[\s\S])*)/g)]
    .map(m => m[2]!.replace(/<[^>]*>/g, '').trim())
    .filter(t => t && !/bookkeeping line/.test(t));
}

/** R80 paces the tail and R150 throttles updates; run both out or a test reads
 * a log the client has not finished telling. (Copied from 226 deliberately —
 * it is four lines and a shared helper would make two files move together for
 * no reason.) */
function settle(ui: { tick(): void; html(): string;
  has(w: Record<string, string | number>): boolean;
  click(w: Record<string, string | number>): string }): string {
  for (let i = 0; i < 8; i++) {
    ui.tick();
    if (ui.has({ btn: 'paceskip' })) ui.click({ btn: 'paceskip' });
  }
  return ui.html();
}

function seated(seed: number): { h: Harness; seat: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  return { h, seat: h.state.initiative as Seat };
}

test('R272 §1a a log longer than the old 80-line window is shown WHOLE', async () => {
  const { h, seat } = seated(25201);
  /* A full resync — `log:` on an update, the shape a net client gets on join
   * and after an undo. Every line arrives with NO type, which is the case the
   * #125 curtain deliberately fails open on (226 §1c), so nothing here is
   * hidden by the story fold and the ONLY thing that could cut the list is the
   * 80-line window this test is about. */
  const lines = Array.from({ length: 214 }, (_, i) => `resync line ${i + 1} of 214`);

  // ── the non-vacuity assertions, FIRST: without these the test below passes
  // identically against a client that shows nothing at all.
  assert.ok(lines.length > 80,
    `the fixture must be longer than the window it is about (${lines.length} lines)`);

  const ui = await client();
  ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
  openLog(ui);
  ui.push({ t: 'update', view: viewFor(h.state, seat), legal: legalActions(h.state, seat), log: lines });
  const shown = logLines(settle(ui));

  assert.ok(shown.includes(lines[lines.length - 1]!),
    'the newest line is on screen at all — the panel is showing this log');

  const missing = lines.filter(l => !shown.includes(l));
  assert.equal(missing.length, 0,
    `${missing.length} of ${lines.length} log lines are cut off (${missing[0]} … `
    + `${missing[missing.length - 1]}). The oldest line on screen is "${shown[0]}" — [145] asks `
    + 'for the ENTIRE log now that it is a modal, and the 80-line window was sized for the '
    + '290px rail column CT-124 moved it out of.');
  closeLog(ui);
});

test('R272 §1b lifting the window does not lift the story curtain with it', async () => {
  /* The trap the brief names: there are THREE curtains over this one
   * observable and only one of them is the report. If removing the 80-line
   * window quietly took the #125 fold with it, §1a would go green and the
   * client would have re-broken [126]. */
  const { h, seat } = seated(25202);
  const ui = await client();
  ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
  openLog(ui);
  /* typed lines this time: news, and two of the types LOG_PLUMBING folds away
   * (main.ts — the client exports nothing, so the types are named here; §1b
   * goes vacuous, and says so, if either ever stops being plumbing) */
  ui.push({
    t: 'update', view: viewFor(h.state, seat), legal: legalActions(h.state, seat),
    events: [
      { type: 'spawned', msg: 'A Watcher enters play.' },
      { type: 'resolved', msg: 'Ability leaves the stack.' },
      { type: 'afterCombat', msg: 'After-combat step.' },
    ],
  });
  const story = logLines(settle(ui));
  const all = logLines(ui.click({ btn: 'logmode' }));
  ui.click({ btn: 'logmode' });

  // non-vacuity: the fixture really did produce both kinds of line
  assert.ok(all.length > story.length,
    `the story curtain is still folding something away (story ${story.length} of ${all.length})`);
  for (const line of story) {
    assert.ok(all.includes(line), `"${line}" is in the story view but not in the full one`);
  }
  closeLog(ui);
});

test('R272 §1c the pacing curtain still holds the tail it has not told yet', async () => {
  /* R80's `untold`/`heldLines` is the second curtain, and it is the one that
   * makes the log arrive at reading speed instead of all at once. It is
   * expressed as `logEnd`, one line above the window §1a removed, so a careless
   * edit takes it too — and nothing else in the suite reads the log BEFORE it
   * has been drained. Every other log test calls settle() first. */
  const { h, seat } = seated(25203);
  const ui = await client();
  ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
  openLog(ui);
  const events = [
    { type: 'attackDeclared', msg: 'Ann attacks with 2 units.' },
    { type: 'blocksDeclared', msg: 'Bo blocks.' },
    { type: 'damage', msg: 'A Watcher deals 3.' },
    { type: 'died', msg: 'A Watcher dies.' },
  ];
  const held = logLines(ui.update(viewFor(h.state, seat), legalActions(h.state, seat), { events }));
  const told = logLines(settle(ui));
  assert.ok(told.length >= held.length,
    `draining the beats can only ever ADD lines (held ${held.length}, told ${told.length})`);
  assert.ok(told.includes('A Watcher dies.'),
    'and once the beats have played the last line is on screen');
  closeLog(ui);
});

/* ══ §2 — [142] THE CARD IMAGE RESERVES ITS OWN BOX ══════════════════════ */

/** the pixel size of a JPEG, read off its SOF marker. Fifteen lines beats a
 * dependency, and the point of reading the real files is that the ratio this
 * test asserts is DERIVED from the scans rather than typed in beside them. */
function jpegSize(file: string): { w: number; h: number } {
  const b = readFileSync(file);
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1]!;
    // SOF0..SOF15, minus the four that are not frame headers
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error(`no SOF marker in ${file}`);
}

/** Every rule in style.css, as `[selector, declarations]`, comments stripped.
 * A brace scanner rather than one regex, because `@media` nests and a regex
 * that ignores that quietly drops every rule inside one — which is where the
 * responsive card widths live. */
function rules(): [string, string][] {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: [string, string][] = [];
  let head = '', i = 0;
  while (i < bare.length) {
    const c = bare[i]!;
    if (c === '{') {
      const close = bare.indexOf('}', i), open = bare.indexOf('{', i + 1);
      if (open >= 0 && open < close) { head = ''; i++; continue; }   // an at-rule wrapper
      out.push([head.trim().replace(/\s+/g, ' '), bare.slice(i + 1, close)]);
      head = ''; i = close + 1; continue;
    }
    if (c === '}') { head = ''; i++; continue; }
    head += c; i++;
  }
  return out;
}

/** ⚠ DERIVED, NOT ENUMERATED. The question is not "does `.card img` have a
 * ratio" — it is "is there any width-driven card image left that does not".
 * `.card img` was the 199px; `.rescard img` was another 46px that only turned
 * up when the first fix was measured rather than assumed; `.deckcover img` is
 * the same shape on the deck page. A list would have stopped at the first.
 *
 * The one documented exemption, and why: */
const RATIO_EXEMPT: Record<string, string> = {
  '.modstrip img': 'its PARENT reserves the box (`.modstrip { aspect-ratio: calc(.72 / var(--modpeek)) }`), '
    + 'and the peek is `translateY(calc(-100% * …))` — measured against the image\'s own height, so a '
    + 'ratio here would move the crop as well as reserve the space',
  '.preview img': 'the rail overrides this to `width: auto` on the board (`#app.board .preview > img`), '
    + 'and a ratio cannot size a replaced element whose width and height are both auto. The rail\'s '
    + 'scroll is snapshotted like the board\'s; nothing has been measured to be lost there.',
};

test('R272 §2 a card image reserves its height, so a repaint cannot clamp the scroll', () => {
  /* ⚠ THE NON-VACUITY ASSERTIONS COME FIRST. This guard is worth nothing
   * unless the boxes really are content-sized (nothing else gives a card a
   * height) and the ratio they reserve really is the ratio the scans have. */
  const scans = readdirSync(CARDS_DIR).filter(f => f.endsWith('.jpg'));
  assert.ok(scans.length > 400,
    `only ${scans.length} scans in ${CARDS_DIR} — this test is measuring the wrong place`);
  const ratios = scans.map(f => { const s = jpegSize(join(CARDS_DIR, f)); return s.w / s.h; });
  const ratio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  assert.ok(Math.max(...ratios) - Math.min(...ratios) < 0.01,
    'the pool is one shape — if the scans ever stop being, one reserved ratio is the wrong fix');

  // the rules this is about: an <img> sized by its width alone, so its HEIGHT
  // comes from the image and from nothing else
  const widthDriven = rules().filter(([sel, body]) =>
    /\bimg\b/.test(sel) && /(^|;)\s*width:\s*100%/.test(body) && !/(^|;)\s*height:/.test(body));
  assert.ok(widthDriven.length >= 3,
    `only ${widthDriven.length} width-driven image rules found — the parse is wrong, not the CSS`);

  const naked = widthDriven.filter(([sel]) => !(sel in RATIO_EXEMPT))
    .filter(([, body]) => !/aspect-ratio:/.test(body))
    .map(([sel]) => sel);
  assert.deepEqual(naked, [],
    `${naked.join(', ')} reserve NO height until their art loads. Every repaint rebuilds every `
    + '<img>, so for one frame the page is short by the sum of them — and restoreViewport (and '
    + 'decks.ts alight()) write the old scrollTop into exactly that frame, where the browser '
    + 'clamps it. MEASURED in headless Chrome on ?demo=1 with fresh image URLs: .main '
    + 'scrollHeight 974 -> 775 at paint time (37 images, 0 complete) and the player\'s scroll '
    + '578 -> 379, settling at 468. That is report [142], "the page resets/scrolls to the top on '
    + 'any change". Give each one `aspect-ratio: auto <w> / <h>` — or add it to RATIO_EXEMPT '
    + 'above with the reason.');

  for (const [sel, body] of widthDriven) {
    if (sel in RATIO_EXEMPT) continue;
    const m = /aspect-ratio:\s*(auto\s+)?(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/.exec(body)!;
    const declared = Number(m[2]) / Number(m[3]);
    assert.ok(Math.abs(declared - ratio) < 0.01,
      `${sel} reserves ${m[2]}/${m[3]} = ${declared.toFixed(4)}, but the ${scans.length} scans `
      + `are ${ratio.toFixed(4)}. The box would jump the moment the art arrived, which is the `
      + 'bug in miniature.');
    assert.ok(m[1],
      `${sel} states the ratio as an OVERRIDE. It has to be a FALLBACK — the auto keyword `
      + 'first — so a scan that is ever a different shape is still drawn at its own once it '
      + 'has loaded.');
  }
});

/* ══ §3 — [142] THE HOVER TIP SURVIVES A PAINT THAT DID NOT MOVE ITS CARD ═ */
/*
 * R272. The rule, as a total function, the way R230 put `scrollHidesHoverTip`
 * in ui/inspect.ts — read 199's header for why the browser half of this cannot
 * live in test/ui-driver.ts.
 *
 * The question the rule answers is the same one R230 asks of a scroll: could
 * this have moved the card out from under the cursor? A repaint that leaves
 * the card where it was has not, and closing the box the player is reading
 * because a hidden zone changed is the "clunky" in the report.
 */

const AT = { key: 'e17', present: true, moved: false };

test('R272 §3a a repaint that leaves the hovered card where it was keeps the tip', () => {
  assert.equal(hoverSurvivesPaint(AT), true);
  // and the same for a card hovered by NAME (a log line, a decision menu) —
  // those carry data-prev and no entity id
  assert.equal(hoverSurvivesPaint({ ...AT, key: 'cGood Whale' }), true);
});

test('R272 §3b a card that is gone from the new board takes its tip with it', () => {
  /* This is the reason the unconditional hide was written in the first place,
   * and it has to survive the fix: the unit died, or the card was played, and a
   * box still floating over the board would be describing something that is not
   * there. `moved` is meaningless when nothing is present, so both readings of
   * it have to give the same answer. */
  assert.equal(hoverSurvivesPaint({ ...AT, present: false, moved: false }), false);
  assert.equal(hoverSurvivesPaint({ ...AT, present: false, moved: true }), false);
});

test('R272 §3c a card that moved is no longer under the cursor', () => {
  /* The board rearranged around it — a column closed ranks, a unit left the
   * hand for the table. The card exists, but the cursor is over whatever slid
   * into its place, so the box would be describing the wrong card. */
  assert.equal(hoverSurvivesPaint({ ...AT, moved: true }), false);
});

test('R272 §3d nothing hovered is not something to keep', () => {
  /* The common case by far, and it must answer the same as today: no key means
   * no tip and no dwell, and the client hides (idempotently) either way. */
  for (const present of [true, false]) {
    for (const moved of [true, false]) {
      assert.equal(hoverSurvivesPaint({ key: '', present, moved }), false,
        `key '' with present=${present} moved=${moved}`);
    }
  }
});

test('R272 §3e the rule is total and keeps exactly one of its eight inputs', () => {
  /* The whole domain, enumerated, so a later edit that widens the `keep` side
   * has to come here and say so. */
  const kept: string[] = [];
  for (const key of ['', 'e17']) {
    for (const present of [true, false]) {
      for (const moved of [true, false]) {
        if (hoverSurvivesPaint({ key, present, moved })) kept.push(`${key || '(none)'}/${present}/${moved}`);
      }
    }
  }
  assert.deepEqual(kept, ['e17/true/false'],
    'exactly one case keeps the tip: a real card, still on the board, still where it was');
});

/* ══ §4 — [142] "WHEN THE OTHER PLAYER IS DOING THINGS IN A HIDDEN ZONE" ══ */

test('R272 §4 an update this seat cannot see costs exactly one paint', async () => {
  /* The third reading of [142], and the one the brief expected to be the
   * loudest: that the client repaints wholesale on updates that change nothing
   * this seat can see, and that the waste is the "clunky".
   *
   * MEASURED, AND IT IS NOT. One authoritative update is one `$app.innerHTML`
   * write, and draining the timers it books adds none. There is nothing here
   * to suppress — what the player was losing on that paint was the hover box
   * (§3), not time. Suppressing the paint would have fixed the symptom by the
   * long way round and taken the focus, the motion baselines and the pace
   * queue with it.
   *
   * Kept as a guard rather than deleted as a null result, because the failure
   * mode it bounds is REAL and this repo has shipped it: the deck-collection
   * page repainted the home screen 2,696 times in 2,265ms on one click, and
   * three browser tests stayed green because every one of them asserted the
   * END STATE, which was correct — after 2,696 renders. A count is the only
   * assertion that can see that. */
  const { h, seat } = seated(25204);
  const opp = (1 - seat) as Seat;
  const ui = await client();
  ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
  const before = ui.renders();
  const wasRaw = ui.raw();

  // the opponent shuffles their own hand: a real state change, in a zone
  // server/view.ts redacts, so the view THIS seat gets back is identical
  const hand = h.state.players[opp]!.hand;
  assert.ok(hand.length >= 2, `the fixture needs an opponent hand to hide (${hand.length} cards)`);
  h.state.players[opp]!.hand = [...hand].reverse();
  const hidden = viewFor(h.state, seat);

  ui.update(hidden, legalActions(h.state, seat));
  ui.tick();
  const paints = ui.renders() - before;

  // non-vacuity: this really was an update the seat cannot see
  assert.equal(ui.raw(), wasRaw,
    'the markup is byte-identical — if it is not, the fixture is not a hidden-zone change and '
    + 'the count below is measuring something else');
  assert.equal(paints, 1,
    `one update, ${paints} whole-page repaints. One is the cost of an authoritative state `
    + 'arriving and is not worth suppressing; anything above it is the BL-14 failure — a paint '
    + 'that books work that books another paint. Draining the timers must add none.');
});
