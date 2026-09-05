/* CT-135 — AN OVERLAY HAS TO BE IN ALL THREE LISTS, AND NOTHING CHECKED IT.
 *
 * There is no reusable modal in this client. Every overlay hand-writes its own
 * `class="overlay"` markup, and each one must ALSO be hand-added to three
 * separate, non-derived lists:
 *
 *   1. the RENDER SLOT LIST — one `${…}` line in renderNow's `$app.innerHTML`
 *      template. Markup order, and it encodes z-stacking.
 *   2. the ESCAPE LADDER — `if (<gate>) { …; return; }` rungs, in PRIORITY
 *      order, which is not the same order and is not meant to be.
 *   3. the `overlayUp` DISJUNCTION — a boolean, read by the S-skip, the
 *      Space-pass and the Enter-confirm hotkeys.
 *
 * Miss (2) and Escape does not close the dialog. Miss (3) and a hotkey fires
 * straight through it into the live game.
 *
 * ── WHY THIS FILE IS A GUARD AND NOT A REFACTOR
 *
 * The ticket is explicit that a single source of truth is the wrong first
 * move: the three are three different KINDS of list, and (1) encodes
 * z-stacking, so unifying them would silently restack every dialog in the
 * client. Measured, the three orders really do disagree — the menu is first on
 * the Escape ladder and eleventh from the top of the markup — so the ladder is
 * a deliberate priority, not a z-order, and this file does not touch any
 * order. It asserts MEMBERSHIP only: every overlay is in all three.
 *
 * ── WHAT IT FOUND
 *
 * Three overlays with five holes between them:
 *
 *   pendingReveal  in the ladder, NOT in overlayUp     ← the live one
 *   pendingTrio    in neither
 *   postGame       in neither
 *
 * The reveal interstitial is the one that mattered: it goes up mid-game, over
 * a board that may be offering priority, and `overlayUp` did not know about
 * it — so Space reached `[data-btn="pass"]` behind it. That is a priority pass
 * nobody meant, in a real match, through a modal.
 *
 * ── DERIVED, NOT TYPED (docs/13-assessment.md §7.2)
 *
 * §1 reads the census out of renderNow's own template: every whole-line `${…}`
 * slot, its gate expression, and whether the markup behind it emits
 * `class="overlay"`. Nothing is listed here by hand — a twelfth overlay added
 * next round walks into §2 and §3 on its own. The derivation is self-checked
 * the way 265 §1 checks its own: every overlay slot must yield at least one
 * gate identifier, so a slot written `${cond ? a() : b()}` fails loudly
 * instead of shrinking the census, and the classifier must discriminate (some
 * slots overlays, some not) or "everything is an overlay" would pass forever.
 *
 * ── ⚠ WHAT THIS FILE DELIBERATELY DOES NOT CLAIM (CT-180)
 *
 * `test/ui-driver.ts`'s `document.querySelector` returns null for everything,
 * so the Space and Enter handlers — which reach the board by looking a button
 * up with `querySelector` — CANNOT click anything here, with or without an
 * overlay. A test asserting "Space did not pass" would be green for the wrong
 * reason, forever. So §3 drives the S hotkey instead, which the driver can
 * really see (it drains the pace queue and the ⏭ chip goes away), and carries
 * its own positive control: with no overlay up the same key MUST work. §2 then
 * pins that all three hotkeys read the one `overlayUp` value, which is what
 * carries the S result across to the other two.
 *
 * ── AND THE DRIVER HAD NEVER PRESSED A KEY
 *
 * Nothing in this suite had, so the whole keyboard layer was driven by nothing
 * at all. `test/ui-driver.ts` grew a `key()` for this file; the one trap it
 * documents is worth repeating here, because it would have made §3 green
 * without testing anything: the fake element proxy answers an unknown property
 * with a no-op FUNCTION, which is truthy, so a key event whose target does not
 * explicitly say `isContentEditable: false` looks to main.ts like a keypress
 * inside a text field, and every game hotkey is suppressed before it is asked
 * about overlays at all.
 *
 * §1 the census, derived twice — from renderNow's slots, and from the scrims
 * §2 every overlay is in the Escape ladder and in overlayUp
 * §3 …and on the real client: Escape closes it, S does not get through
 *
 * Seeds 26900-26999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { client, openLog } from './ui-driver.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';

const UI = new URL('../', import.meta.url);
const MAIN = readFileSync(new URL('main.ts', UI), 'utf8');
/** every module of the browser client, so a slot's markup can be found
 * wherever it is written (`pg.postGameHtml` lives in ui/postgame.ts) */
const MODULES = readdirSync(UI).filter(f => f.endsWith('.ts'))
  .map(f => readFileSync(new URL(f, UI), 'utf8'));

/* ── OFF-BOARD MODALS, and why the scrim count has to know about them ──
 *
 * §1's second derivation counts `class="overlay` across client/ui/ and demands
 * it equal the census taken from renderNow's slots. That works only while
 * every modal in the client is a BOARD modal, which was true until BL-01: the
 * matchmaking queue is a HOME-SCREEN page — renderNow never runs while it is
 * up, `$app` is owned by ui/queue.ts, and the game hotkeys §2 and §3 are about
 * are not installed — so its "match found" scrim is not something renderNow's
 * slot list could ever reach, and counting it would make the two derivations
 * disagree for ever.
 *
 * ⚠ AN EXCLUSION LIST IS EXACTLY HOW A GUARD LIKE THIS GETS HOLLOWED OUT, so
 * this one is checked rather than trusted: `renderNow`'s own template must not
 * mention the excluded module's import alias. The day somebody paints the
 * queue from the board, the exclusion becomes a lie and §1 says so.
 */
const OFF_BOARD = ['queue.ts'];
const BOARD_SRC = readdirSync(UI).filter(f => f.endsWith('.ts') && !OFF_BOARD.includes(f))
  .map(f => readFileSync(new URL(f, UI), 'utf8'));

/* ══ §1 — the census ═══════════════════════════════════════════════════ */

/** the brace-matched body of a top-level function or const in one source */
function bodyIn(src: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\n)(?:export )?(?:function ${name}\\(|const ${name}\\s*[:=])`);
  const m = re.exec(src);
  if (!m) return null;
  const open = src.indexOf('{', m.index + m[0].length - 1);
  if (open < 0) return null;
  let d = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}' && --d === 0) break;
  }
  return src.slice(open + 1, i);
}

/** the body of `name` wherever in client/ui/ it is written */
function bodyOf(name: string): string | null {
  const bare = name.includes('.') ? name.slice(name.indexOf('.') + 1) : name;
  for (const src of MODULES) { const b = bodyIn(src, bare); if (b) return b; }
  return null;
}

/** the `$app.innerHTML = \`…\`` template inside renderNow — the RENDER SLOT
 * LIST itself, anchored on the function rather than on a line number so a
 * second `$app.innerHTML` elsewhere in the file can never be read instead. */
function renderTemplate(): string {
  const body = bodyIn(MAIN, 'renderNow');
  assert.ok(body, 'ui/main.ts has no renderNow() — the render slot list is what this file reads');
  const at = body!.indexOf('$app.innerHTML = `');
  assert.ok(at > 0, 'renderNow no longer assigns $app.innerHTML — re-anchor before trusting §1');
  const end = body!.indexOf('restoreViewport(snap);', at);
  assert.ok(end > at, 'renderNow no longer ends its paint with restoreViewport — re-anchor');
  return body!.slice(at, end);
}

interface Slot {
  /** the whole slot expression, for a failure message */
  expr: string;
  /** the markup function it calls, if it calls one */
  fn: string | null;
  /** the state identifiers its gate reads, in source order */
  gate: string[];
  /** does the markup behind it carry the modal scrim? */
  overlay: boolean;
}

/** the modal scrim, and ONLY the scrim: `class="overlaybox"` is the panel
 * INSIDE one and starts with the same eleven characters, so the class name has
 * to end here or every box counts as a second overlay (it did: 21 hits for 11
 * dialogs). */
const SCRIM = /class="overlay(?=[\s"])/;
const SCRIM_G = /class="overlay(?=[\s"])/g;

const IDENT = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?/g;
const NOT_STATE = new Set(['null', 'undefined', 'true', 'false', 'typeof', 'new']);
const identsIn = (s: string): string[] =>
  [...new Set([...s.matchAll(IDENT)].map(m => m[0]).filter(w => !NOT_STATE.has(w)))];

const SLOTS: Slot[] = renderTemplate().split('\n').flatMap(line => {
  const m = /^\s*\$\{(.*)\}$/.exec(line);
  if (!m) return [];
  const expr = m[1]!;
  const q = expr.indexOf(' ? ');
  const gateExpr = q > 0 ? expr.slice(0, q) : null;
  const call = q > 0 ? expr.slice(q + 3) : expr;
  const fn = (/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\(/.exec(call) ?? [])[1] ?? null;
  const body = fn ? bodyOf(fn) : null;
  // an OVERLAY is one that paints the modal scrim — either inline on this
  // line, or inside the function the slot calls. Markup, not a name list.
  const overlay = SCRIM.test(line) || SCRIM.test(body ?? '');
  // the gate is the slot's own condition, or — for a bare `${fn()}` — the
  // leading `if (…) return '';` the function opens with, which is the same
  // decision written one level in
  let gate = gateExpr ? identsIn(gateExpr) : [];
  if (!gateExpr && body) {
    const g = /^\s*if \((.*?)\) return '';/m.exec(body);
    if (g) gate = identsIn(g[1]!);
  }
  return [{ expr, fn, gate, overlay }];
});

const OVERLAYS = SLOTS.filter(s => s.overlay);
/** the identifier each overlay is known by in the other two lists */
const key = (s: Slot): string => s.gate[0] ?? '(no gate)';

test('CT-135 §1 the overlay census is derived from renderNow, and the derivation is complete', () => {
  assert.ok(SLOTS.length > 0,
    'renderNow\'s template yielded no slots at all — the parse above is reading the wrong text');
  assert.ok(OVERLAYS.length > 0,
    'the overlay census is EMPTY. A guard over an empty derived set passes forever '
    + '(docs/13-assessment.md §5) — either the modal markup stopped saying class="overlay", or '
    + 'the slots moved out of renderNow\'s own template.');
  assert.ok(OVERLAYS.length >= 10,
    `only ${OVERLAYS.length} overlay(s) found; there were twelve when this was written, and the `
    + 'ticket counted eleven before that. The number only ever goes up — if one was genuinely '
    + 'retired, move this floor with it.');

  // THE CLASSIFIER DISCRIMINATES. If everything were an overlay this file
  // would be asserting something about the whole board, and §2 would be
  // meaningless — so the census must be a strict subset of the slot list.
  assert.ok(OVERLAYS.length < SLOTS.length,
    'every slot in renderNow classified as an overlay — the markup test has stopped '
    + 'discriminating, and §2 is now a claim about the entire board');

  // THE SECOND, INDEPENDENT DERIVATION. Everything above reads the RENDER
  // SLOT LIST, and a slot whose markup this file cannot resolve — a call it
  // cannot follow, an overlay built by something it does not recognise —
  // would drop out of the census SILENTLY and take its §2 and §3 coverage
  // with it, without ever tripping the floor. So count the modal scrims in
  // the source itself, from the other end: one `class="overlay` written
  // anywhere in client/ui/ is one overlay, and the two counts must agree.
  // the exclusion above, kept honest: if renderNow's template ever refers to
  // an off-board module, that module IS a board overlay source and skipping
  // its scrims would hide it from §2 and §3
  for (const file of OFF_BOARD) {
    const alias = new RegExp(`import \\* as ([A-Za-z_$][\\w$]*) from '\\./${file.replace('.', '\\.')}'`).exec(MAIN)?.[1];
    if (!alias) continue;
    assert.doesNotMatch(renderTemplate(), new RegExp(`\\b${alias}\\.`),
      `ui/${file} is excluded from the scrim count as an off-board (home screen) module, and `
      + `renderNow now paints from it as \`${alias}.…\` — so it IS a board overlay source, and `
      + 'the exclusion is hiding it from the Escape ladder and overlayUp checks below');
  }
  const scrims = BOARD_SRC.reduce((n, src) => n + (src.match(SCRIM_G) ?? []).length, 0);
  assert.equal(OVERLAYS.length, scrims,
    `client/ui/ writes the modal scrim ${scrims} times and the render-slot census found `
    + `${OVERLAYS.length} overlays. Either an overlay is painted from somewhere renderNow's slot `
    + 'list does not reach — in which case §2 and §3 have never seen it — or one function writes '
    + 'the scrim twice, which is worth a look of its own.');

  // EVERY OVERLAY HAS A GATE THE OTHER TWO LISTS CAN NAME. A slot written
  // `${cond ? a() : b()}`, or one whose function guards in a shape the parse
  // does not read, yields none — and would silently drop out of §2.
  const ungated = OVERLAYS.filter(s => !s.gate.length);
  assert.deepEqual(ungated.map(s => s.fn ?? s.expr), [],
    'these overlays have no readable gate, so §2 cannot check them and they are UNGUARDED: '
    + `${ungated.map(s => s.expr).join(' | ')}. Teach the parse their shape.`);

  // …and the markup behind each one was really found, so a rename cannot
  // quietly turn an overlay into "not an overlay"
  for (const s of OVERLAYS) {
    assert.ok(s.fn === null || bodyOf(s.fn) !== null || SCRIM.test(s.expr),
      `${s.fn}() is in the render list and its body is nowhere in client/ui/`);
  }
});

/* ══ §2 — the other two lists ══════════════════════════════════════════ */

/** the body of the block that opens at the first `{` after `marker` */
function blockAfter(marker: string, what: string): string {
  const at = MAIN.indexOf(marker);
  assert.ok(at > 0, `ui/main.ts has no ${what} — the ladder this file checks is gone`);
  const open = MAIN.indexOf('{', at);
  let d = 0, i = open;
  for (; i < MAIN.length; i++) {
    if (MAIN[i] === '{') d++;
    else if (MAIN[i] === '}' && --d === 0) break;
  }
  return MAIN.slice(open + 1, i);
}

/** the Escape ladder's rungs, in priority order — the condition of each
 * `if (…) { …; return; }` inside the `Escape` branch. Since 2026-09-05 the
 * dialog rungs live in `closeTopOverlay()` (a click on a dialog's scrim takes
 * the same ladder), called from the branch as one rung: its `return true;`
 * rungs are spliced in at that call, so the order this file checks is the
 * order a player experiences. */
function escapeLadder(): string[][] {
  const body = blockAfter("if (e.key === 'Escape') {", 'Escape branch');
  const shared = blockAfter('function closeTopOverlay(): boolean {', 'closeTopOverlay()');
  const sharedRungs = [...shared.matchAll(/if \((.*?)\) \{[^\n]*return true;/g)].map(m => identsIn(m[1]!));
  assert.ok(sharedRungs.length >= 8, `closeTopOverlay() parsed to ${sharedRungs.length} rungs`);
  const out: string[][] = [];
  for (const m of body.matchAll(/if \((.*?)\) \{[^\n]*return;/g)) {
    if (/closeTopOverlay\(\)/.test(m[1]!)) out.push(...sharedRungs);
    else out.push(identsIn(m[1]!));
  }
  return out;
}

/** the identifiers `overlayUp` is built from */
function overlayUpIdents(): string[] {
  const m = /const overlayUp = ([\s\S]*?);\n/.exec(MAIN);
  assert.ok(m, 'ui/main.ts no longer defines overlayUp — the hotkey gate this file checks is gone');
  return identsIn(m![1]!);
}

const LADDER = escapeLadder();
const LADDER_IDENTS = new Set(LADDER.flat());
const UP_IDENTS = new Set(overlayUpIdents());

test('CT-135 §2 the two hand-written lists were read, and they are not empty', () => {
  // the controls the two membership checks below rest on
  assert.ok(LADDER.length >= 10, `the Escape ladder parsed to ${LADDER.length} rungs — too few to `
    + 'be the real ladder; the parse is not reading it');
  assert.ok(UP_IDENTS.size >= 8, `overlayUp parsed to ${UP_IDENTS.size} operands — too few to be `
    + 'the real disjunction');
});

test('CT-135 §2 every overlay is on the Escape ladder', () => {
  const missing = OVERLAYS.filter(s => !s.gate.some(g => LADDER_IDENTS.has(g)));
  assert.deepEqual(missing.map(key), [],
    `Escape does not close these overlays: ${missing.map(key).join(', ')}. Add a rung to the `
    + 'Escape branch that clears the same state its own dismiss button clears. ⚠ The ladder is a '
    + 'PRIORITY order, not the render order — insert, do not re-sort.');
});

test('CT-135 §2 every overlay is in the overlayUp disjunction that gates the hotkeys', () => {
  const missing = OVERLAYS.filter(s => !s.gate.some(g => UP_IDENTS.has(g)));
  assert.deepEqual(missing.map(key), [],
    `a hotkey fires straight through these overlays into the live game: ${missing.map(key).join(', ')}. `
    + 'overlayUp gates the S skip, the Space pass and the Enter confirm — with one of them up and '
    + 'a board behind it, Space finds [data-btn="pass"] and passes priority nobody meant to pass.');
});

test('CT-135 §2 all three hotkeys read the ONE overlayUp value', () => {
  // This is what carries §3's S-key result across to Space and Enter, which
  // the driver cannot exercise (see the header, CT-180). If a hotkey ever
  // grows its own opinion about what an overlay is, that argument breaks and
  // this is where it is noticed.
  const at = MAIN.indexOf('const overlayUp =');
  const rest = MAIN.slice(at, MAIN.indexOf('\n});', at));
  for (const k of ["e.key === 's'", "e.key === ' '", "e.key === 'Enter'"]) {
    const h = rest.indexOf(k);
    assert.ok(h > 0, `the ${k} handler is not below overlayUp any more`);
    const next = rest.indexOf("if (e.key ===", h + 10);
    const block = rest.slice(h, next === -1 ? rest.length : next);
    assert.match(block, /overlayUp/,
      `the ${k} hotkey no longer consults overlayUp — it has its own opinion about what an `
      + 'overlay is, and §3 no longer speaks for it');
  }
});

/* ══ §3 — on the real client ═══════════════════════════════════════════ */

const ui = await client();
const SEAT: Seat = 0;

/**
 * A board this seat is looking at, with the pace queue drained first (237).
 *
 * The bin and the cache are SEEDED, because their dialogs are opened from
 * panels the board only draws when the zone has something in it — an empty
 * board offers no way in, and a raise that cannot happen would be exempted
 * rather than tested.
 */
function board(seed: number): GameState {
  if (ui.has({ btn: 'paceskip' })) ui.click({ btn: 'paceskip' });
  const h = new Harness(seed);
  const e = new E(h.state);
  h.state.players[SEAT]!.bin.push('Oorblak');
  e.cacheFromHand(SEAT, 0);
  // …and a unit in play, because the card inspector is reached by
  // right-clicking a card and an opening board has none on the table
  FIRST_CARD = e.spawnUnit(SEAT, 'Oorblak', e.homeRegion(SEAT)).id;
  e.settle();
  ui.join(viewFor(h.state, SEAT), SEAT, legalActions(h.state, SEAT));
  return h.state;
}

/** an update the throttle may NOT hold, then one it MAY — so the ⏭ chip is on
 * screen and the S hotkey has something real to do */
function holdSomething(s: GameState): void {
  const legal = legalActions(s, SEAT);
  assert.ok(legal.length, 'fixture: this seat really is being offered something');
  ui.update(viewFor(s, SEAT), legal);
  ui.update(viewFor({ ...structuredClone(s), turn: s.turn + 6 }, SEAT), []);
  assert.ok(ui.has({ btn: 'paceskip' }), 'fixture: the throttle is holding something to skip');
}

/**
 * How to put each overlay on screen, keyed by the identifier §1 derived. The
 * KEYS are checked against the census below, so an overlay added next round
 * arrives here as a red test naming it rather than as an untested dialog.
 */
const RAISE: Record<string, () => void> = {
  helpOpen: () => { ui.click({ btn: 'helpopen' }); },
  judgeOpen: () => { ui.click({ btn: 'judgeopen' }); },
  reportOpen: () => { ui.click({ btn: 'reportopen' }); },
  logOpen: () => { openLog(ui); },
  binView: () => { ui.click({ btn: 'binopen', p: SEAT }); },
  cacheView: () => { ui.click({ btn: 'cacheopen', p: SEAT }); },
  // both seats' erased piles are offered; either raises the same dialog
  erasedView: () => { menuItem(/erased/i, 0); },
  concedeAsk: () => { menuItem(/concede/i); },
  inspect: () => { cardMenuItem(/details/i); },
  pendingReveal: () => {
    // ⚠ WITH LEGAL ACTIONS ON PURPOSE. R150's gate holds an update that offers
    // this seat nothing, and a HELD update never reaches applyUpdate — which
    // is where `pendingReveal` is set. An empty `legal` here raised no overlay
    // at all and read as a hotkey correctly suppressed.
    ui.push({
      t: 'update', view: viewFor(REVEAL_STATE, SEAT),
      legal: legalActions(REVEAL_STATE, SEAT), step: 'deploy',
      reveal: REVEAL_EVENTS, events: REVEAL_EVENTS,
    });
  },
  pendingTrio: () => {
    ui.push({
      t: 'joined', seat: SEAT, view: viewFor(REVEAL_STATE, SEAT), log: [], legal: [],
      peers: [true, true], names: ['Ann', 'Bo'],
      trio: { els: ['fire', 'water', 'wood'], how: 'both rolled', detail: ['Ann rolled fire'] },
    });
  },
  postGame: () => { ui.push({ t: 'gameover', ...GAME_OVER }); },
};

/** open the bare-table right-click menu and click the entry matching `want` */
function menuItem(want: RegExp, which = 0): void {
  const menu = ui.rightClick({ act: 'player', p: 0 });
  const hit = [...menu.matchAll(/data-btn="menuitem" data-i="(\d+)">([\s\S]*?)<\/button>/g)]
    .filter(m => want.test(m[2]!.replace(/<[^>]*>/g, '')));
  assert.ok(hit[which], `the bare-table menu offers no entry ${which} matching ${want}`);
  ui.click({ btn: 'menuitem', i: hit[which]![1]! });
}

/** the same, from a card's own right-click menu */
function cardMenuItem(want: RegExp): void {
  const id = FIRST_CARD;
  const menu = ui.rightClick({ previd: id });
  const hit = [...menu.matchAll(/data-btn="menuitem" data-i="(\d+)">([\s\S]*?)<\/button>/g)]
    .filter(m => want.test(m[2]!.replace(/<[^>]*>/g, '')));
  assert.equal(hit.length, 1, `the card menu offers ${hit.length} entries matching ${want}`);
  ui.click({ btn: 'menuitem', i: hit[0]![1]! });
}

/** the server's post-game payload, filled out enough for pg.postGameHtml to
 * draw it — every field it maps over has to be there or the raise throws
 * before the overlay is up */
const seatStats = (name: string): Record<string, unknown> => ({
  name, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0,
  cardElements: {}, recycled: {}, resourcesActivated: 0, abilitiesActivated: 0,
  attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, cardsDrafted: 0, lifeLeft: 30,
});
const GAME_OVER = {
  seat: 0, winner: 0, names: ['Ann', 'Bo'], mode: 'constructed', els: ['fire'],
  turns: 4, seats: [seatStats('Ann'), seatStats('Bo')],
  rematch: [false, false], rematchRoom: null, recorded: false,
};

let REVEAL_STATE: GameState = new Harness(26900).state;
let FIRST_CARD = 0;
const REVEAL_EVENTS = [{ type: 'info', msg: 'Ann deploys something.' }];

test('CT-135 §3 the raise table covers the derived census exactly', () => {
  const covered = Object.keys(RAISE).sort();
  const census = OVERLAYS.map(key).sort();
  assert.deepEqual(covered, census,
    'the render list and this file disagree about what the overlays are.\n'
    + `  in renderNow, not raised here: ${census.filter(k => !covered.includes(k)).join(', ') || 'none'}\n`
    + `  raised here, not in renderNow: ${covered.filter(k => !census.includes(k)).join(', ') || 'none'}\n`
    + 'A NEW OVERLAY MUST BE DRIVEN: add a way to raise it above, then Escape must close it and '
    + 'no hotkey may reach the board through it.');
});

test('CT-135 §3 the S hotkey reaches the board when nothing is in the way', () => {
  // THE POSITIVE CONTROL THE REST OF §3 RESTS ON. "No hotkey fired" is the
  // answer a driver that never delivers keys gives to every question, so this
  // has to fire one for real first.
  const s = board(26901);
  holdSomething(s);
  ui.key('s');
  assert.equal(ui.has({ btn: 'paceskip' }), false,
    'S did not drain the pace queue with no overlay up — the key never reached ui/main.ts, and '
    + 'every "the hotkey was suppressed" assertion below would be green for that reason alone');
});

test('CT-135 §3 with each overlay up, Escape closes it and S does not get through', () => {
  const escFailed: string[] = [], keyFailed: string[] = [];
  for (const s of OVERLAYS) {
    const k = key(s);
    const st = board(26902);
    REVEAL_STATE = st;
    assert.doesNotMatch(ui.html(), SCRIM,
      `fixture: the bare board already has an overlay on it before ${k} was raised`);

    RAISE[k]!();
    // IS IT ACTUALLY UP? The census's own definition of an overlay is markup
    // carrying the modal scrim, so that is the question asked here too — a
    // raise that quietly did nothing would otherwise read as "the hotkey was
    // correctly suppressed" for the rest of time.
    assert.match(ui.html(), SCRIM,
      `raising ${k} put no overlay on screen — the rest of this iteration would be measuring `
      + 'an empty board');

    // the queue is loaded AFTER the raise, because some overlays arrive on a
    // message that drains it on the way in (a 'gameover' begins with
    // flushPace) — loading it first would leave nothing for S to do and read
    // as a suppression that never happened
    holdSomething(st);
    ui.key('s');
    if (!ui.has({ btn: 'paceskip' })) keyFailed.push(k);

    // …and Escape must put the overlay away
    const before = ui.html();
    ui.key('Escape');
    if (ui.html() === before) escFailed.push(k);
  }
  // both at once: fixing one and not the other is exactly how this ticket's
  // three lists drifted apart in the first place
  assert.deepEqual({ keyFailed, escFailed }, { keyFailed: [], escFailed: [] },
    `the S hotkey fired straight through these overlays into the live game: `
    + `[${keyFailed.join(', ')}] — Space and Enter read the same overlayUp (§2), so they get `
    + `through too, and Space passes priority. And Escape changed nothing on screen with these `
    + `up: [${escFailed.join(', ')}].`);
});
