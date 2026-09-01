/* DRIVING ui/main.ts FROM A TEST.
 *
 * WHY THIS EXISTS
 *
 * ui/main.ts is the page entry point: no exports, `document` and
 * `location.search` read at import time, a WebSocket built in a constructor.
 * For a long time the only way a test could say anything about it was to read
 * it as TEXT — `assert.match(MAIN, /…/)` — and this repo has paid for that
 * repeatedly. A source regex asserts WHERE code sits and HOW it is formatted:
 * it breaks when somebody reformats a line that still works, and it passes
 * when somebody keeps the line and breaks what it does. Commit e43e51a
 * repaired two of those; the ledger's own history (#37 → #76, #46 → #60/#75)
 * is the longer version of the same lesson.
 *
 * So: give main.ts the smallest browser it will accept, hand it a socket we
 * hold the other end of, and drive it the way the server does. Then read the
 * markup it really produced, and the intents it really put on the wire.
 *
 * WHAT THIS IS NOT. It is not a DOM. Nothing here lays anything out, and
 * `closest()` understands exactly the selectors main.ts asks it. Anything the
 * client does that this fake cannot answer throws a TypeError naming the call,
 * which is the honest failure: nobody is left believing a render happened when
 * it did not.
 *
 * WHAT IT DOES HAVE, SINCE R205/CT-75: ANCESTORS. This comment used to say the
 * clicked element never needs any, "which is true of every affordance in the
 * board markup: they carry their own data-btn / data-act". That was FALSE, and
 * the falsehood is what let the bug survive. `.regioncache` (main.ts:2109) and
 * `.regionbin` (main.ts:1816) are `data-btn` CONTAINERS full of card scans, and
 * main.ts's click delegator (main.ts:4805) asks `closest('[data-btn]')` before
 * `closest('[data-act]')` — so a `data-act` nested anywhere inside one of them
 * loses to the container in a real browser, at any depth. With no ancestors
 * there was no container to lose to, so a test about a nested affordance went
 * GREEN in this driver and was WRONG on screen. CARD-TODO #64's prescribed fix
 * was exactly that shape; only somebody reading the delegator caught it.
 *
 * So `dispatch` now rebuilds the real ancestor chain out of the rendered HTML
 * (see `ancestorsOf`) and `closest()` walks it, nearest first, the way the
 * browser's does. `contains()` and `parentElement` come with it. If you are
 * about to write "this element has no ancestors" again: measure it.
 *
 * USE. Import this module BEFORE anything that touches ui/main.ts — importing
 * it installs the globals and loads the client. Then:
 *
 *     const ui = await client();
 *     ui.join(state, seat, legal);       // the server's 'joined'
 *     ui.click({ btn: 'resetblocks' });  // a real click through the real handler
 *     ui.sent();                         // what went out on the wire
 *     ui.html();                         // what is on screen
 */
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { Action, GameState, Seat } from '../src/types.ts';

const RECT = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 };

/** an element that remembers what is assigned to it and shrugs at the rest.
 * `onSet` is the one hook: the app root needs to behave like a real one when
 * its innerHTML is replaced (see APP below). */
function mkEl(props: Record<string, unknown> = {}, onSet?: (k: string) => void): Record<string, unknown> {
  const store: Record<string, unknown> = {
    id: '', innerHTML: '', textContent: '', value: '', scrollTop: 0, scrollHeight: 0,
    tagName: 'DIV', ...props,
  };
  const noop = (): void => {};
  const self: Record<string, unknown> = new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k as string];
      // `style` answers '' for any property read and swallows any write — and
      // since CSSOM's own methods live on it too (ui/legal.ts calls
      // `setProperty`), a read of one has to come back CALLABLE rather than as
      // the empty string, or the client dies constructing the page.
      if (k === 'style') return (t['style'] = new Proxy({}, {
        get: (_t, sk) => (typeof sk === 'string' && /^(set|remove|get|item)/.test(sk) ? noop : ''),
        set: () => true,
      }));
      if (k === 'classList') return { add: noop, remove: noop, toggle: noop, contains: () => false };
      if (k === 'getBoundingClientRect') return () => RECT;
      // the default for an element NOBODY placed in the markup — one main.ts
      // built with createElement (the hover tip, a ghost). A clicked element
      // gets a real ancestor-walking `closest` from `elementAt` (R205/CT-75),
      // which overwrites this.
      if (k === 'closest') return () => null;
      if (k === 'querySelector') return () => null;
      if (k === 'querySelectorAll' || k === 'getElementsByClassName') return () => [];
      if (k === 'children' || k === 'childNodes') return [];
      if (k === 'parentElement' || k === 'parentNode' || k === 'firstChild' || k === 'nextElementSibling') return null;
      if (typeof k === 'symbol') return undefined;
      return noop;
    },
    set(t, k, v) { t[k as string] = v; onSet?.(String(k)); return true; },
  }) as Record<string, unknown>;
  return self;
}

const ELS = new Map<string, Record<string, unknown>>();
const byId = (id: string): Record<string, unknown> => {
  if (!ELS.has(id)) ELS.set(id, mkEl({ id }));
  return ELS.get(id)!;
};
/**
 * The app root.
 *
 * R258 — REPLACING innerHTML DESTROYS THE CHILDREN, and the driver has to say
 * so. ui/main.ts now emits LIVE SLOTS — nodes render() paints empty and a
 * patcher fills afterwards, so the ⏭ chip and the presence dot can change
 * while R150's throttle is holding and no render is allowed to run. In a
 * browser `$app.innerHTML = …` throws every one of those nodes away and the
 * patcher puts fresh content into fresh nodes. Here the elements are
 * long-lived fakes, so without this hook a slot would keep content the browser
 * had already dropped — a driver that shows a chip nothing repainted. That is
 * the same lie R230 took out of `clearTimeout`.
 */
let RENDERS = 0;
const APP = mkEl({ id: 'app' }, k => {
  if (k !== 'innerHTML') return;
  RENDERS++;
  for (const [id, el] of ELS) if (id !== 'app') el['innerHTML'] = '';
});
ELS.set('app', APP);
/**
 * boxes main.ts asks for by id and treats as "absent unless open".
 *
 * ⚠ CT-124 — THIS LIST IS A CLAIM ABOUT THE BROWSER, AND A MISSING ENTRY IS A
 * HIDDEN CRASH. `#log` was not here, so `restoreViewport`'s unguarded
 * `document.getElementById('log')!` got a stub object back on every paint and
 * the suite stayed green over code that would throw the moment the node was
 * not on the page. It survived only because the log panel happened to be
 * unconditional; the log is a modal now, so it is absent on nearly every
 * paint. The guard went into main.ts and the id went in here — either alone
 * would have left the other free to rot.
 */
const ABSENT = new Set(['judge-q', 'report-note', 'preview', 'hovertip', 'log']);

type Listener = (e: unknown) => void;
const LISTENERS = new Map<string, Listener[]>();
const listen = (type: string, fn: Listener): void => {
  if (!LISTENERS.has(type)) LISTENERS.set(type, []);
  LISTENERS.get(type)!.push(fn);
};

interface FakeSocket {
  onopen: null | (() => void);
  onmessage: null | ((e: { data: string }) => void);
  onclose: null | (() => void);
}
let SOCKET: FakeSocket | null = null;
const WIRE: Record<string, unknown>[] = [];
/**
 * Timers the client books; never fired unless a test asks (see `tick`).
 *
 * R230 — A CANCELLED TIMER IS CANCELLED. `clearTimeout` used to be
 * `() => {}`, which meant the driver ran callbacks the client had explicitly
 * called off. Every debounce, every dwell and every "unless something happens
 * first" in ui/main.ts therefore fired here and only here, and a test could go
 * GREEN asserting an outcome the browser never produces. Report #110 is the
 * live example: the 550ms hover dwell is armed and then cleared three
 * milliseconds later, so the tooltip never appears on screen — and a driver
 * test would have watched `tick()` run the cancelled callback and called it
 * fixed.
 *
 * A Map with a monotonic id, not an array with a length-based one: `tick`
 * drains the collection, and an array that restarts at 1 after a drain would
 * hand out an id a test may still be holding from before it — at which point a
 * real `clearTimeout` cancels the WRONG timer, which is a worse lie than the
 * one it replaced.
 */
let NEXT_TIMER = 0;
const TIMERS = new Map<number, () => void>();
/** run every timer booked so far, in booking order, dropping the collection
 * first so a callback that books another does not spin */
const runTimers = (): void => {
  const due = [...TIMERS.entries()].sort((a, b) => a[0] - b[0]).map(([, fn]) => fn);
  TIMERS.clear();
  for (const fn of due) fn();
};

const g = globalThis as unknown as Record<string, unknown>;
g.document = {
  getElementById: (id: string) => (ABSENT.has(id) ? null : byId(id)),
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => mkEl(), createElementNS: () => mkEl(),
  addEventListener: (t: string, fn: Listener) => listen(t, fn),
  removeEventListener: () => {},
  // CT-124's rule, applied again: A MISSING PIECE OF THE PAGE IS A HOLE IN
  // THE PAGE, NOT A FACT ABOUT THE CLIENT. `document.head` was absent, and the
  // moment ui/legal.ts started appending its stylesheet at import time, EVERY
  // test in this suite that drives the client died on
  // "Cannot read properties of undefined (reading 'appendChild')" — before a
  // single assertion ran. A page the client boots against has a head.
  head: mkEl({ id: 'head' }),
  body: mkEl(), documentElement: mkEl(), activeElement: null, title: '', hidden: false,
};
g.window = globalThis;
g.addEventListener = (t: string, fn: Listener) => listen(t, fn);
// `?room=` is what makes main.ts build a NetBackend at import time rather than
// painting the home screen — this driver plays the ONLINE client by default,
// because that is the one where the server is authoritative and the client has
// to hold a plan across a round trip.
//
// R170/CT-46: …but ONLINE is not the only caller, and it is the one that can
// never see this bug. `server/view.ts` nulls a decision that is not yours, so
// an online client's `s.decision` is always its own; HOTSEAT is the only
// caller that sees both seats at once. A test asks for that client by setting
// `globalThis.__UI_DRIVER_SEARCH = '?hotseat=1'` BEFORE importing this module
// (i.e. `await import('./ui-driver.ts')`, not a static import — a static one
// is hoisted and runs first) and then driving it with `local()` below.
const SEARCH = (g['__UI_DRIVER_SEARCH'] as string | undefined) ?? '?room=UIDRIVER&seat=0';
// `origin` is part of every real Location and was missing, so every share
// link ui/main.ts builds came out as "undefined/?ws=1&room=…" here — a test
// reading one back could not tell a well-formed link from a broken one.
g.location = {
  host: 'x', protocol: 'http:', search: SEARCH, hash: '', href: 'http://x/',
  origin: 'http://x',
};
// a real store: the client keeps preferences here (the auto-pass toggle, the
// saved name) and a test that toggles one has to be able to read it back
const STORE = new Map<string, string>();
g.localStorage = {
  getItem: (k: string) => STORE.get(k) ?? null,
  setItem: (k: string, v: string) => { STORE.set(k, String(v)); },
  removeItem: (k: string) => { STORE.delete(k); },
  clear: () => STORE.clear(),
};
g.WebSocket = class {
  static OPEN = 1;
  readyState = 1;
  onopen: null | (() => void) = null;
  onmessage: null | ((e: { data: string }) => void) = null;
  onclose: null | (() => void) = null;
  constructor(_url: string) { SOCKET = this as unknown as FakeSocket; }
  send(s: string): void { WIRE.push(JSON.parse(s) as Record<string, unknown>); }
  close(): void {}
};
// …and the same hole one line further in: ui/legal.ts watches #app's class
// with a MutationObserver. Nothing here mutates it, so the callback never
// fires and no test depends on it — the object exists because the CLIENT
// constructs one at import time, and a page that cannot be constructed on is
// not a page.
g.MutationObserver = class {
  constructor(_fn: () => void) {}
  observe(): void {}
  disconnect(): void {}
  takeRecords(): unknown[] { return []; }
};
g.HTMLInputElement = class {};
// CT-124: `ui/anim.ts::elFor` builds its selectors with `CSS.escape`, which
// every browser has and this fake page did not. Nothing had reached it — the
// path is `pulseKeys`, i.e. the SECOND and later beats of a paced batch — so a
// fixture with a real multi-stage combat in it died on `CSS is not defined`
// rather than on anything it was testing. A missing browser global is a hole
// in the page, not a fact about the client.
g.CSS = { escape: (s: string) => String(s).replace(/["\\]/g, m => `\\${m}`) };
g.HTMLTextAreaElement = class {};
g.HTMLElement = class {};
g.requestAnimationFrame = () => 0;
g.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
g.setInterval = () => 0;
g.clearInterval = () => {};
g.setTimeout = (fn: () => void) => { const id = ++NEXT_TIMER; TIMERS.set(id, fn); return id; };
g.clearTimeout = (id: unknown) => { TIMERS.delete(Number(id)); };
g.innerWidth = 1200; g.innerHeight = 900; g.scrollX = 0; g.scrollY = 0; g.devicePixelRatio = 1;
g.getComputedStyle = () => new Proxy({}, { get: () => '' });
g.fetch = () => new Promise(() => {});   // never resolves: no rulings, no /api

/* HOTSEAT ONLY: every Harness main.ts builds, in construction order.
 *
 * main.ts keeps its backend in a module-local `let h` and exports nothing, so
 * a hotseat test has no other way to put a game in front of it. Note what does
 * NOT work: a prototype accessor for `state`. `Harness` declares `state` as a
 * class FIELD, so every instance gets an own data property that shadows the
 * prototype — measured, not assumed. Its METHODS are genuinely on the
 * prototype, and the constructor calls one (`absorb`) before it returns, so
 * wrapping them captures each instance at birth.
 *
 * Installed ONLY in hotseat mode: an online test builds no Harness at all and
 * must not have the class it shares with the whole engine suite quietly
 * re-shaped underneath it.
 *
 * ⚠ And REMOVED again the moment main.ts has loaded. A test builds Harnesses
 * of its own to make fixtures with, and while the wrapper is on, every one of
 * those lands in this list too — so `local()` would drive the fixture instead
 * of the client, silently, and every assertion about the board would be about
 * markup that was never repainted. (It did, before this line existed.)
 */
const HARNESSES: Harness[] = [];
{
  const proto = Harness.prototype as unknown as Record<string, unknown>;
  const original: [string, unknown][] = [];
  if (SEARCH.includes('hotseat')) {
    for (const k of Object.getOwnPropertyNames(proto)) {
      if (k === 'constructor') continue;
      const d = Object.getOwnPropertyDescriptor(proto, k)!;
      if (typeof d.value !== 'function') continue;   // getters are not called at birth
      const fn = d.value as (...a: unknown[]) => unknown;
      original.push([k, fn]);
      proto[k] = function (this: Harness, ...a: unknown[]): unknown {
        if (!HARNESSES.includes(this)) HARNESSES.push(this);
        return fn.apply(this, a);
      };
    }
  }
  await import('../../ui/main.ts');
  for (const [k, fn] of original) proto[k] = fn;
}

// ── reading the markup ────────────────────────────────────────────────

/** the attributes of one HTML tag, `data-foo-bar` camel-cased the way a real
 * `dataset` presents it */
function attrsOf(tag: string): { attrs: Record<string, string>; dataset: Record<string, string> } {
  const attrs: Record<string, string> = {}, dataset: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
    attrs[m[1]!] = m[2]!;
    if (m[1]!.startsWith('data-')) {
      dataset[m[1]!.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = m[2]!;
    }
  }
  return { attrs, dataset };
}

/* R205/CT-75: element tags that never open a scope, so they must never push
 * onto the ancestor stack. Only the ones the board can actually emit are
 * listed plus the rest of the HTML void set, because a missing entry here
 * silently shifts every ancestor computed after it. */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

interface ScanTag { tag: string; name: string; close: boolean; at: number }

/* R205/CT-75: one QUOTE-AWARE scan of the markup, opening tags and closing
 * tags alike. The old `tags()` was `/<[a-zA-Z][^>]*>/g`, which ends a tag at
 * the first `>` even when it sits inside a quoted attribute value — and the
 * board writes prose into `title="…"` (main.ts:2111 is one). That is harmless
 * while nothing but the tag's own attributes are read, and it is NOT harmless
 * once tag boundaries have to nest correctly, so the ancestor walk and the
 * affordance lookup are now the same scan and cannot disagree. */
function scan(html: string): ScanTag[] {
  const out: ScanTag[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(lt, lt + 32));
    if (!m) { i = lt + 1; continue; }   // a stray `<` in text: not a tag
    let j = lt + m[0]!.length, quote = '';
    while (j < html.length) {
      const c = html[j]!;
      if (quote) { if (c === quote) quote = ''; }
      else if (c === '"' || c === '\'') quote = c;
      else if (c === '>') break;
      j++;
    }
    out.push({ tag: html.slice(lt, j + 1), name: m[2]!.toLowerCase(), close: m[1] === '/', at: lt });
    i = j + 1;
  }
  return out;
}

/** every opening tag in `html`, in document order */
function tags(html: string): { tag: string; at: number }[] {
  return scan(html).filter(t => !t.close).map(({ tag, at }) => ({ tag, at }));
}

/**
 * R258 — THE PAGE AS A BROWSER WOULD HAVE IT: the markup render() wrote, with
 * every LIVE SLOT's patched-in content put back inside it.
 *
 * ui/main.ts patches a handful of nodes in place, outside any render, so that
 * the ⏭ chip and the opponent's presence stay true while R150's throttle is
 * holding and a render would be unsafe (it ends in runAutoPass — it SENDS).
 * A test reads a string, so the two halves have to be reassembled here or the
 * fix would be invisible and every guard on it would be a guard on nothing.
 *
 * DERIVED, not listed: the slots are found by their `liveslot` class in the
 * markup itself, so a new one main.ts adds tomorrow is spliced with no change
 * here. And the render is required to have emitted each of them EMPTY — two
 * writers for one node is exactly the bug this shape exists to prevent, so it
 * fails loudly rather than quietly showing the chip twice.
 */
function spliceLive(html: string): string {
  let out = '', i = 0;
  for (const t of scan(html)) {
    if (t.close) continue;
    const { attrs } = attrsOf(t.tag);
    const id = attrs['id'];
    if (id === undefined) continue;
    if (!(attrs['class'] ?? '').split(/\s+/).includes('liveslot')) continue;
    const end = t.at + t.tag.length, close = `</${t.name}>`;
    assert.equal(html.slice(end, end + close.length), close,
      `the live slot #${id} was not painted EMPTY — render() is drawing it as well as the patcher`);
    out += html.slice(i, end) + String(ELS.get(id)?.['innerHTML'] ?? '');
    i = end;
  }
  return out + html.slice(i);
}

/** the enclosing opening tags of the tag that starts at `at`, NEAREST FIRST —
 * the chain a browser's `closest()` walks after the element itself.
 *
 * R205/CT-75. A close tag pops back to its own name rather than popping the
 * top blindly: if the board ever emits something unbalanced, the chain above
 * the damage stays right instead of the whole rest of the document sliding by
 * one. An unmatched close is ignored for the same reason. */
function ancestorsOf(html: string, at: number): string[] {
  const stack: ScanTag[] = [];
  for (const t of scan(html)) {
    if (t.at >= at) break;
    if (t.close) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.name === t.name) { stack.length = i; break; }
      }
      continue;
    }
    if (VOID_TAGS.has(t.name) || /\/\s*>$/.test(t.tag)) continue;
    stack.push(t);
  }
  return stack.reverse().map(t => t.tag);
}

/** the whole `<div …>…</div>` whose opening tag contains offset `at` */
function divAround(html: string, at: number, what: string): string {
  assert.ok(at >= 0, `the board has no ${what} at all`);
  const start = html.lastIndexOf('<div', at);
  assert.ok(start >= 0, `${what} is not inside a <div>`);
  let i = html.indexOf('>', at), depth = 1;
  while (depth > 0) {
    const open = html.indexOf('<div', i), close = html.indexOf('</div>', i);
    assert.ok(close >= 0, `unbalanced markup around ${what}`);
    if (open >= 0 && open < close) { depth++; i = open + 4; } else { depth--; i = close + 6; }
  }
  return html.slice(start, i);
}

/** the element carrying `data-animzone="<key>"`, with everything inside it —
 * the board's own name for a place cards can be, so a test can ask "is this
 * card THERE" without knowing anything about the layout */
export const zone = (html: string, key: string): string =>
  divAround(html, html.indexOf(`data-animzone="${key}"`), `the "${key}" zone`);

/** the entity ids of the cards inside a chunk of board markup */
export const idsIn = (chunk: string): number[] =>
  [...chunk.matchAll(/data-id="(\d+)"/g)].map(m => Number(m[1]));

/* ── R205/CT-75: the affordance census ────────────────────────────────
 *
 * docs/13-assessment.md §7.2: "a new guard's card list is COMPUTED from
 * printed data, not typed from the cards in the report." The same applies to
 * affordances. A guard that names `cacheopen`, `binopen` and `cacheplay` goes
 * stale the day somebody adds a fourth panel — and the whole point of CT-75 is
 * that nobody notices when a checker stops seeing. So: derive the list from
 * the markup the client really painted, and let a new panel walk into the
 * guard on its own. */
export interface Affordance {
  /** the element's own opening tag */
  tag: string;
  at: number;
  /** its own handles, if any */
  btn: string | null;
  act: string | null;
  /** enclosing opening tags, nearest first */
  ancestors: string[];
  /** the nearest ENCLOSING `data-btn` — the value that would claim a click on
   * this element before its own `data-act` ever got a look in (main.ts:4805) */
  enclosingBtn: string | null;
  /** the nearest enclosing `data-act`, same idea one rung down */
  enclosingAct: string | null;
}

/** every element in `html` that carries `data-btn` or `data-act`, in document
 * order, each with the chain main.ts's delegator would walk from it */
export function affordances(html: string): Affordance[] {
  const out: Affordance[] = [];
  for (const { tag, at } of tags(html)) {
    const own = attrsOf(tag).attrs;
    if (own['data-btn'] === undefined && own['data-act'] === undefined) continue;
    const ancestors = ancestorsOf(html, at);
    const near = (k: string): string | null => {
      for (const a of ancestors) {
        const v = attrsOf(a).attrs[k];
        if (v !== undefined) return v;
      }
      return null;
    };
    out.push({
      tag, at,
      btn: own['data-btn'] ?? null,
      act: own['data-act'] ?? null,
      ancestors,
      enclosingBtn: near('data-btn'),
      enclosingAct: near('data-act'),
    });
  }
  return out;
}

export interface Pick { [dataAttr: string]: string | number }

/** the first tag carrying every `data-<key>="<value>"` in `want` */
function findTag(html: string, want: Pick): { tag: string; at: number } | null {
  const keys = Object.entries(want).map(([k, v]) => [`data-${k}`, String(v)] as const);
  return tags(html).find(({ tag }) => {
    const { attrs } = attrsOf(tag);
    return keys.every(([k, v]) => attrs[k] === v);
  }) ?? null;
}

// ── the client, as a thing a test can push and poke ───────────────────

export interface Client {
  /** the markup currently on screen */
  html(): string;
  /**
   * R258: the markup the last `render()` WROTE, with the live slots left
   * empty — i.e. everything R150's throttle is entitled to freeze.
   *
   * The point of the pair: a held update must change `html()` (the ⏭ chip,
   * the presence dot) and must leave `raw()` byte-identical. If `raw()` moves,
   * a render ran — and a render is not a paint, it ends in `runAutoPass()`,
   * which SENDS. That is the thing CT-123 warned a naive fix would do.
   */
  raw(): string;
  /**
   * R258: how many times ui/main.ts has replaced the whole page — every
   * `$app.innerHTML =`, whatever wrote it.
   *
   * `raw()` says the markup did not CHANGE; this says the render did not RUN.
   * They are different questions and the difference is the whole of CT-123: a
   * render during a hold repaints the same state, so the markup is identical
   * and the invariant reads clean — while the policy pass around it
   * (hideHoverTip, gcStaleUi, planAutoPass, maybeCancelChain, publishBuilding,
   * a whole-board rebuild) has run once per held arrival at machine speed,
   * which is the cost R150 exists to stop.
   */
  renders(): number;
  /** the server's `joined`: an authoritative state, from scratch */
  join(state: GameState, seat: Seat, legal?: Action[]): string;
  /** a later authoritative state, the way a real action's echo arrives */
  update(state: GameState, legal?: Action[], extra?: Record<string, unknown>): string;
  /** any raw NetMsg — for the shapes `join`/`update` do not cover */
  push(msg: Record<string, unknown>): string;
  /** click the element carrying these data attributes, through the client's
   * own listener and its own handler. Fails loudly if it is not on screen. */
  click(want: Pick): string;
  /** right-click it — the board's context menu, and the only way in to the
   * card inspector */
  rightClick(want: Pick): string;
  /** is such an element on screen at all? */
  has(want: Pick): boolean;
  /** everything the client has put on the wire, and forget it */
  sent(): Record<string, unknown>[];
  /** the actions among them */
  actions(): Action[];
  /** run the callbacks the client booked with setTimeout */
  tick(): void;
  /** CT-135: press a key, through the client's own keydown listener. `field`
   * makes the event look like it came from a text input, which is the one
   * fact that handler branches on besides the key itself. */
  key(k: string, field?: boolean): string;
}

/** does `sel` — a comma-separated list of bare `[data-*]` attribute selectors,
 * which is exactly what main.ts ever asks `closest()` — match these attrs? */
function selMatches(sel: string, attrs: Record<string, string>): boolean {
  return sel.split(',').map(x => x.trim()).some(x => {
    const m = /^\[([a-zA-Z-]+)\]$/.exec(x);
    return m ? attrs[m[1]!] !== undefined : false;
  });
}

/** the clicked element, WITH the ancestor chain it really has in the markup.
 *
 * R205/CT-75. `closest()` here is the browser's algorithm: the element itself
 * first, then each enclosing tag outward, and the NEAREST match wins. That is
 * the whole point — main.ts's delegator asks for `[data-btn]` and `[data-act]`
 * in two separate calls, so a container's `data-btn` beats a nested
 * `data-act` at any depth, and until this existed the driver could not see it.
 * `contains()` and `parentElement` are built from the same chain so a
 * depth-aware rule in main.ts can be tested here at all. */
function elementAt(html: string, found: { tag: string; at: number }): Record<string, unknown> {
  // index 0 is the clicked element; the rest are its ancestors, nearest first
  const chainTags = [found.tag, ...ancestorsOf(html, found.at)];
  const parsed = chainTags.map(tag => ({ tag, ...attrsOf(tag) }));
  const els: Record<string, unknown>[] = parsed.map(p => mkEl({
    dataset: p.dataset,
    tagName: (/^<([a-zA-Z]+)/.exec(p.tag) ?? [])[1]?.toUpperCase() ?? 'DIV',
  }));
  els.forEach((el, i) => {
    el['closest'] = (sel: string): unknown => {
      for (let j = i; j < parsed.length; j++) if (selMatches(sel, parsed[j]!.attrs)) return els[j];
      return null;
    };
    // `a.contains(b)` — true when b is a, or is inside a. Deeper elements sit
    // at LOWER indexes, so everything from 0..i is inside els[i].
    el['contains'] = (other: unknown): boolean => els.slice(0, i + 1).includes(other as never);
    el['parentElement'] = els[i + 1] ?? null;
    el['parentNode'] = els[i + 1] ?? null;
  });
  return els[0]!;
}

/**
 * CT-124 — OPEN THE GAME LOG THE WAY A PLAYER HAS TO.
 *
 * Report #131 moved the log off the board and behind the bare-table
 * right-click menu, so every test that reads log markup now has to get there
 * first, and there is exactly one way in. This drives it: right-click
 * something that is not a card (the life counter — the contextmenu handler's
 * own test is `closest('[data-prev], [data-previd]')`, and a life span carries
 * neither), then click the entry that opens the log.
 *
 * Idempotent: a client that already has the modal up is left alone, because
 * `logOpen` is module state in ui/main.ts and survives a re-join.
 *
 * The entry is FOUND, not indexed — `boardMenuEntries` decides the order and
 * a test file must not encode it.
 */
export function openLog(c: {
  html(): string; has(w: Pick): boolean; click(w: Pick): string; rightClick(w: Pick): string;
}, bare: Pick = { act: 'player', p: 0 }): string {
  if (c.has({ btn: 'logclose' })) return c.html();      // already open
  const menu = c.rightClick(bare);
  assert.ok(menu.includes('class="menu"'),
    'right-clicking bare table opened no menu — the only way into the log is gone');
  const items = [...menu.matchAll(/data-btn="menuitem" data-i="(\d+)">([\s\S]*?)<\/button>/g)]
    .map(m => ({ i: m[1]!, label: m[2]!.replace(/<[^>]*>/g, '').trim() }));
  const hit = items.filter(it => /game log/i.test(it.label));
  assert.equal(hit.length, 1,
    `the bare-table menu offers ${hit.length} ways to open the log, not 1 — `
    + `it shows: ${items.map(it => it.label).join(' | ')}`);
  const html = c.click({ btn: 'menuitem', i: hit[0]!.i });
  assert.ok(html.includes('class="logpanel"'), 'the log entry opened no log');
  return html;
}

/** …and shut it again. `logOpen` is module state in ui/main.ts and outlives
 * the `client()` a test built, so a file that opens the log and then goes on
 * to read whole-board markup has to put it back. */
export function closeLog(c: { html(): string; has(w: Pick): boolean; click(w: Pick): string }): string {
  if (!c.has({ btn: 'logclose' })) return c.html();
  return c.click({ btn: 'logclose' });
}

/** the element a click on `want` would be delivered TO, with its chain, for a
 * test that wants to interrogate the chain rather than fire it. `dispatch`
 * builds the same thing — this is the one seam that lets 176 §1 check that
 * `closest`, `contains` and `parentElement` agree with each other, which is the
 * only reason to trust any of the three. */
export function elementFor(html: string, want: Pick): Record<string, unknown> {
  const found = findTag(html, want);
  assert.ok(found, `nothing in this markup carries ${JSON.stringify(want)}`);
  return elementAt(html, found);
}

/**
 * CT-135 — PRESS A KEY, through ui/main.ts's own `keydown` listener.
 *
 * Nothing in this suite had ever pressed one, so the whole keyboard layer —
 * the Escape ladder, the S skip, the Space pass, the Enter confirm — was
 * driven by nothing at all. The event carries exactly the facts that handler
 * reads, and no more.
 *
 * ⚠ `isContentEditable` IS SET EXPLICITLY, and it has to be: `mkEl`'s proxy
 * answers an unknown property with a no-op FUNCTION, which is truthy, so a
 * default target would look like a text field to `inField` and every game
 * hotkey would be suppressed here and only here — a green run over a client
 * that never sees a key.
 */
function press(k: string, paint: () => string, field = false): string {
  const target = mkEl({
    tagName: field ? 'INPUT' : 'DIV', isContentEditable: false, blur: () => {},
  });
  const ev = {
    key: k, target, ctrlKey: false, metaKey: false, altKey: false, repeat: false,
    preventDefault: () => {}, stopPropagation: () => {},
  };
  const fns = LISTENERS.get('keydown') ?? [];
  assert.ok(fns.length, 'ui/main.ts registered no keydown listener');
  for (const fn of fns) fn(ev);
  return paint();
}

/** send one real DOM event of `type` at the element carrying `want`, through
 * whatever listeners ui/main.ts registered for it */
function dispatch(type: string, want: Pick, paint: () => string): string {
  const html = paint();
  const found = findTag(html, want);
  assert.ok(found, `nothing on screen carries ${JSON.stringify(want)} — the affordance the test `
    + 'is about is not there at all');
  const el = elementAt(html, found);
  const ev = {
    target: el, currentTarget: el, clientX: 10, clientY: 10,
    preventDefault: () => {}, stopPropagation: () => {}, button: 0,
  };
  const fns = LISTENERS.get(type) ?? [];
  assert.ok(fns.length, `ui/main.ts registered no ${type} listener`);
  for (const fn of fns) fn(ev);
  return paint();
}

/** the HOTSEAT client (R170/CT-46): no socket, no server, no redaction — one
 * screen showing both seats, and `h` a local `Harness` this puts a game into.
 * Everything else (`html`, `click`, `has`) is the same real markup and the
 * same real handlers the online `client()` drives. */
export interface LocalClient {
  /** the markup currently on screen */
  html(): string;
  /** click / right-click a real affordance, through the client's own handler */
  click(want: Pick): string;
  rightClick(want: Pick): string;
  /** is such an element on screen at all? */
  has(want: Pick): boolean;
  /** run the callbacks the client booked with setTimeout */
  tick(): void;
  /** put this state in front of the client and repaint. Returns the markup. */
  show(state: GameState): string;
  /** the state the client is actually holding (it mutates it as you click) */
  state(): GameState;
}

export function local(): LocalClient {
  assert.ok(SEARCH.includes('hotseat'),
    'local() is the hotseat client — set globalThis.__UI_DRIVER_SEARCH = \'?hotseat=1\' '
    + 'before importing test/ui-driver.ts');
  assert.ok(!SOCKET, 'ui/main.ts opened a socket — this is not a hotseat game');
  assert.ok(HARNESSES.length, 'ui/main.ts built no Harness — the hotseat client did not start');
  const paint = (): string => spliceLive(String(APP['innerHTML']));   // R258
  const back = (): Harness => HARNESSES[HARNESSES.length - 1]!;
  const base: LocalClient = {
    html: paint,
    has: want => !!findTag(paint(), want),
    tick: runTimers,
    click: want => dispatch('click', want, paint),
    rightClick: want => dispatch('contextmenu', want, paint),
    state: () => back().state,
    show(state) {
      back().state = state;
      // there is no `render()` to call from outside: main.ts exports nothing.
      // The rules panel is chrome that is on screen in every game and whose
      // two buttons do nothing but flip a flag — so open it and close it, and
      // the close repaints the board over the state just installed.
      base.click({ btn: 'helpopen' });
      return base.click({ btn: 'helpclose' });
    },
  };
  return base;
}

export async function client(): Promise<Client> {
  assert.ok(SOCKET, 'ui/main.ts opened no socket — the fixture is not driving the client');
  const paint = (): string => spliceLive(String(APP['innerHTML']));   // R258
  const deliver = (msg: Record<string, unknown>): string => {
    SOCKET!.onmessage!({ data: JSON.stringify(msg) });
    return paint();
  };
  return {
    html: paint,
    raw: () => String(APP['innerHTML']),
    renders: () => RENDERS,
    join: (state, seat, legal = []) => deliver({
      t: 'joined', seat, view: state, log: [], legal, peers: [true, true], names: ['Ann', 'Bo'],
    }),
    update: (state, legal = [], extra = {}) => deliver({ t: 'update', view: state, legal, ...extra }),
    push: deliver,
    has: want => !!findTag(paint(), want),
    sent: () => WIRE.splice(0, WIRE.length),
    actions: () => WIRE.splice(0, WIRE.length)
      .filter(m => m['t'] === 'action').map(m => m['action'] as Action),
    tick: runTimers,
    click: want => dispatch('click', want, paint),
    rightClick: want => dispatch('contextmenu', want, paint),
    key: (k, field = false) => press(k, paint, field),
  };
}
