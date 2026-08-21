/* The DOM half of the visual-clarification system: FLIP, card flights, and
 * targeting arrows. ui/motion.ts decides WHAT moved; nothing here knows a
 * thing about Algomancy.
 *
 * Two overlays live outside #app so render()'s innerHTML wipe cannot touch
 * them: a ghost layer (flying card scans) and an SVG arrow layer. Both are
 * pointer-events:none and purely decorative — the real DOM is already final
 * and clickable the instant render() returns, so an animation can never eat
 * an input or delay an action. That is the whole contract: motion explains
 * what the engine already did, it never gates it.
 *
 * Usage per render:
 *   const frame = captureFrame();      // BEFORE innerHTML
 *   ...re-render...
 *   playMotion(frame, diffCensus(before, after));
 */

/** every [data-anim] key and [data-animzone] anchor on screen, with its box */
export type Frame = Map<string, DOMRect>;

interface Deps { art(name: string): string }
let deps: Deps = { art: () => '' };
export function initAnim(d: Deps): void { deps = d; }

// ── the preference ────────────────────────────────────────────────────
const PREF = 'algoMotion';
const reduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** on by default, off by default for prefers-reduced-motion, always overridable */
export function motionOn(): boolean {
  const raw = localStorage.getItem(PREF);
  if (raw === '1') return true;
  if (raw === '0') return false;
  return !reduced();
}
export function setMotionOn(on: boolean): void { localStorage.setItem(PREF, on ? '1' : '0'); }
/** The CLARITY half of the feature — targeting arrows, which are static, and
 * the beat an unrespondable effect gets on the visual stack (ui/flash.ts),
 * which is information rather than decoration. prefers-reduced-motion has no
 * business turning either off; only an explicit "motion: off" hides them. (The
 * beat's own arrival animation IS dropped by the media query in style.css.) */
export function clarityOn(): boolean { return localStorage.getItem(PREF) !== '0'; }
export const arrowsOn = clarityOn;

// ── tuning ────────────────────────────────────────────────────────────
const FLIP_MS = 200;
const FLY_MIN = 240, FLY_MAX = 460;
const STAGGER_MS = 45, STAGGER_MAX = 220;
/** a resolution chain can move a dozen cards at once; past this it stops
 * reading as "that card went there" and starts reading as confetti */
const MAX_FLIGHTS = 12;
const EASE = 'cubic-bezier(.35,.05,.2,1)';

// ── the overlay layers ────────────────────────────────────────────────
let ghostLayer: HTMLDivElement | null = null;
function ghosts(): HTMLDivElement {
  if (!ghostLayer) {
    ghostLayer = document.createElement('div');
    ghostLayer.className = 'animlayer';
    document.body.appendChild(ghostLayer);
  }
  return ghostLayer;
}

// ── measuring ─────────────────────────────────────────────────────────
/** Snapshot every animatable box. Anchors are keyed '@<name>' so a slot key
 * and its zone anchor can share one lookup table. */
export function captureFrame(): Frame {
  const f: Frame = new Map();
  if (!motionOn()) return f;
  for (const el of document.querySelectorAll<HTMLElement>('[data-anim]')) {
    const k = el.dataset['anim']!;
    if (!f.has(k)) f.set(k, el.getBoundingClientRect());
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-animzone]')) {
    const k = '@' + el.dataset['animzone']!;
    if (!f.has(k)) f.set(k, el.getBoundingClientRect());
  }
  return f;
}

const elFor = (key: string): HTMLElement | null =>
  key.startsWith('@')
    ? document.querySelector<HTMLElement>(`[data-animzone="${CSS.escape(key.slice(1))}"]`)
    : document.querySelector<HTMLElement>(`[data-anim="${CSS.escape(key)}"]`);

const centre = (r: DOMRect): [number, number] => [r.left + r.width / 2, r.top + r.height / 2];
/** laid out at all (a card with no art yet measures zero-height) */
const real = (r: DOMRect): boolean => r.width > 0 && r.height > 0;
const onScreen = (r: DOMRect): boolean => real(r) && r.bottom > -200 && r.top < innerHeight + 200;
/** The table is taller than the window, so one end of a flight is often
 * scrolled away. Rather than drop the animation — the far seat's hand is
 * exactly where the surprises come from — pin that end to the nearest edge, so
 * the card visibly flies IN from (or OUT towards) where it really is. */
const EDGE = 48;
const clampPt = (p: [number, number]): [number, number] => [
  Math.min(Math.max(p[0], EDGE), Math.max(EDGE, innerWidth - EDGE)),
  Math.min(Math.max(p[1], EDGE), Math.max(EDGE, innerHeight - EDGE)),
];

// ── the motion shape ui/motion.ts hands us ────────────────────────────
interface Move {
  card: string; from: string | null; fromAnchor: string | null;
  to: string | null; toAnchor: string | null; kind: 'move' | 'enter' | 'leave';
}
interface Pulse { key: string; anchor: string; kind: 'hurt' | 'buff' }
interface Motion { moves: Move[]; pulses: Pulse[] }

/** rect for a slot key, falling back to its zone anchor when the card itself
 * has no element (the bin mini only shows three; a mod is a badge) */
function rectOf(f: Frame, key: string | null, anchor: string | null): { r: DOMRect; exact: boolean } | null {
  if (key) { const r = f.get(key); if (r && real(r)) return { r, exact: true }; }
  if (anchor) { const r = f.get(anchor); if (r && real(r)) return { r, exact: false }; }
  return null;
}

/** longest first: a card crossing the whole table is the one worth watching */
const flightRank = (m: Move): number => (m.kind === 'move' ? 0 : m.kind === 'leave' ? 1 : 2);

/**
 * Slot keys whose real element is hidden because a ghost is still flying to
 * it, and how many flights are in the air for each.
 *
 * This has to be keyed rather than held as an element reference: one click can
 * re-render more than once (handleAction renders again after the handler that
 * already rendered), and the second pass throws away the very node the first
 * pass hid. Re-hiding by key after every render keeps the destination blank
 * until its card actually lands, instead of showing it twice.
 */
const inFlight = new Map<string, number>();
function holdHidden(key: string): void {
  inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
  const el = elFor(key);
  if (el) el.style.visibility = 'hidden';
}
function releaseHidden(key: string, land: boolean): void {
  const n = (inFlight.get(key) ?? 1) - 1;
  if (n > 0) { inFlight.set(key, n); return; }
  inFlight.delete(key);
  const el = elFor(key);
  if (!el) return;
  el.style.visibility = '';
  if (land) flash(el, 'animland');
}

/**
 * Play one render's worth of motion. `prev` is the frame captured before the
 * re-render; the post-render frame is measured here (one forced layout).
 */
export function playMotion(prev: Frame, m: Motion): void {
  if (!motionOn() || !prev.size) return;
  const next = captureFrame();
  // this render replaced the nodes a live flight was aiming at — hide the new
  // ones too, so the card is not on screen twice while it is still in the air
  for (const key of inFlight.keys()) elFor(key)?.style.setProperty('visibility', 'hidden');

  // 1. FLIP — anything that kept its key but changed place slides there
  //    (a unit walking out of its region into an attack column).
  for (const [key, before] of prev) {
    if (key.startsWith('@')) continue;
    const after = next.get(key);
    if (!after || !onScreen(after) || !onScreen(before)) continue;
    const dx = before.left - after.left, dy = before.top - after.top;
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) continue;
    const el = elFor(key);
    if (!el) continue;
    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: FLIP_MS, easing: EASE },
    );
  }

  // 2. flights — cards that changed zone, so changed key
  const flights = [...m.moves].sort((a, b) => flightRank(a) - flightRank(b)).slice(0, MAX_FLIGHTS);
  // Only a render that actually MOVED something supersedes the cards in the
  // air. A no-op re-render must leave them alone — otherwise the second render
  // of a single click wipes the flight the first one just launched.
  if (flights.length) ghosts().replaceChildren();
  let i = 0;
  for (const mv of flights) {
    const src = rectOf(prev, mv.from, mv.fromAnchor);
    const dst = rectOf(next, mv.to, mv.toAnchor);
    const delay = Math.min(i * STAGGER_MS, STAGGER_MAX);

    if (mv.kind === 'enter' || !src) {
      // came from nowhere we can point at (spawned token, drawn-from-nothing):
      // pop it where it landed instead of flying a lie across the screen
      if (mv.to) pop(mv.to, delay);
      i++;
      continue;
    }
    fly(mv, src.r, dst, next.has(mv.to ?? ''), prev.has(mv.to ?? ''), delay);
    i++;
  }

  // 3. pulses — same card, different numbers
  for (const p of m.pulses) {
    const el = elFor(p.key) ?? elFor(p.anchor);
    if (!el) continue;
    flash(el, p.kind === 'hurt' ? 'animhurt' : 'animbuff');
  }
}

/** one card scan flying from `src` to `dst` (or fading out, when dst is null) */
function fly(
  mv: Move, src: DOMRect, dst: { r: DOMRect; exact: boolean } | null,
  destFresh: boolean, destExisted: boolean, delay: number,
): void {
  const [sx, sy] = clampPt(centre(src));
  const g = document.createElement('div');
  g.className = 'animghost';
  g.style.left = `${sx - src.width / 2}px`;
  g.style.top = `${sy - src.height / 2}px`;
  g.style.width = `${src.width}px`;
  g.style.height = `${src.height}px`;
  // art() answers '' for a card this client is not allowed to see (the
  // opponent's face-down hand) — that flies as a card BACK, not a blank plate
  const src2 = mv.card ? deps.art(mv.card) : '';
  if (src2) {
    const img = document.createElement('img');
    img.src = src2;
    img.alt = '';
    img.addEventListener('error', () => { g.classList.add('noart'); img.remove(); });
    g.appendChild(img);
  } else {
    g.classList.add('back');
  }
  ghosts().appendChild(g);

  if (!dst) {                       // erased / trashed: shrink out in place
    g.animate(
      [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.5) rotate(-8deg)', opacity: 0 }],
      { duration: 300, delay, easing: 'ease-in', fill: 'both' },
    ).addEventListener('finish', () => g.remove());
    setTimeout(() => g.remove(), 300 + delay + 400);
    return;
  }

  const [tx, ty] = clampPt(centre(dst.r));
  const dx = tx - sx, dy = ty - sy;
  const dist = Math.hypot(dx, dy);
  // landing on a zone anchor (the bin mini, the deck counter) means "into that
  // pile" — shrink and fade. Landing on the card's real element means "it is
  // now that" — match its size and hand over at full opacity.
  // fit INSIDE the destination box rather than matching its width: a stack
  // row is wide and short, and a card scan that matched its width would
  // balloon to three times the size of the card that left the hand
  const scale = dst.exact
    ? Math.max(0.2, Math.min(2, Math.min(
      dst.r.width / (src.width || 1), dst.r.height / (src.height || 1))))
    : 0.45;
  const endOpacity = dst.exact ? 1 : 0.1;
  // a slight arc reads as travel; a straight slide reads as a glitch
  const arc = Math.min(70, dist * 0.16);
  const perp = dist > 1 ? [-dy / dist, dx / dist] : [0, 0];
  const duration = Math.max(FLY_MIN, Math.min(FLY_MAX, FLY_MIN + dist * 0.22));

  // hide the destination while the ghost is in the air, but only if it is a
  // brand-new element — never blank something the player was already reading
  const hideKey = destFresh && !destExisted && dst.exact ? mv.to : null;
  if (hideKey) holdHidden(hideKey);

  const anim = g.animate([
    { transform: 'translate(0px, 0px) scale(1)', opacity: 1, offset: 0 },
    {
      transform: `translate(${dx / 2 + perp[0]! * arc}px, ${dy / 2 + perp[1]! * arc}px) scale(${(1 + scale) / 2})`,
      opacity: 1, offset: 0.5,
    },
    { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: endOpacity, offset: 1 },
  ], { duration, delay, easing: EASE, fill: 'both' });

  let landed = false;
  const land = (arrived: boolean): void => {
    if (landed) return;
    landed = true;
    g.remove();
    if (hideKey) releaseHidden(hideKey, arrived);
  };
  anim.addEventListener('finish', () => land(true));
  // a cancelled animation (the next render superseded us) must still un-hide
  anim.addEventListener('cancel', () => land(false));
  // belt and braces: a ghost is a card scan floating over the table, so it
  // must never outlive its flight even if the frame callback never lands
  setTimeout(() => land(true), duration + delay + 400);
}

function pop(key: string, delay: number): void {
  const el = elFor(key);
  if (!el) return;
  el.animate(
    [{ transform: 'scale(.55)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
    { duration: 260, delay, easing: 'cubic-bezier(.2,1.3,.4,1)', fill: 'both' },
  );
}

/** a CSS class worn just long enough to run its keyframes */
function flash(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;      // restart the animation if it is already wearing it
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 900);
}

// ── targeting arrows ──────────────────────────────────────────────────

/** one arrow: the first selector that resolves on each side wins, so a caller
 * can say "the unit's card, or failing that its region" without branching */
export interface ArrowSpec {
  from: string[];
  to: string[];
  /** 'tgt' (bright, what this aims at) · 'src' (dashed, what made it) ·
   * 'soft' (thin, the always-on top-of-stack hint) */
  cls?: 'tgt' | 'src' | 'soft';
  label?: string;
}

const SVGNS = 'http://www.w3.org/2000/svg';
let arrowLayer: SVGSVGElement | null = null;
let baseArrows: ArrowSpec[] = [];
let hoverArrows: ArrowSpec[] | null = null;
let arrowsWired = false;

function layer(): SVGSVGElement {
  if (!arrowLayer) {
    arrowLayer = document.createElementNS(SVGNS, 'svg') as SVGSVGElement;
    arrowLayer.setAttribute('class', 'arrowlayer');
    document.body.appendChild(arrowLayer);
  }
  if (!arrowsWired) {
    arrowsWired = true;
    // panels scroll independently, so listen in the capture phase
    addEventListener('scroll', () => paintArrows(), true);
    addEventListener('resize', () => paintArrows());
    // A card's height comes from its scan, so a board whose art has not
    // arrived yet measures as a stack of zero-height boxes and every arrow is
    // skipped as unresolvable. Repaint as the images land (capture phase —
    // `load` does not bubble).
    addEventListener('load', () => schedulePaint(), true);
  }
  return arrowLayer;
}

/** coalesce repaints into the next frame (many images land at once) */
let paintQueued = false;
function schedulePaint(): void {
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => { paintQueued = false; paintArrows(); });
}

/** the arrows that stay up with no hover (the top stack item, a pending aim) */
export function setBaseArrows(specs: ArrowSpec[]): void { baseArrows = specs; paintArrows(); schedulePaint(); }
/** the arrows for whatever is hovered right now; null = back to base */
export function setHoverArrows(specs: ArrowSpec[] | null): void { hoverArrows = specs; paintArrows(); }
export function clearArrows(): void { baseArrows = []; hoverArrows = null; paintArrows(); }

const firstEl = (sels: string[]): HTMLElement | null => {
  for (const s of sels) {
    const el = document.querySelector<HTMLElement>(s);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
};

/** where a line aimed at (tx,ty) leaves the box `r` — so arrows touch the edge
 * of a card instead of burying their heads in the middle of the art */
function edge(r: DOMRect, tx: number, ty: number, pad: number): [number, number] {
  const [cx, cy] = centre(r);
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const hw = r.width / 2 + pad, hh = r.height / 2 + pad;
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return [cx + dx * t, cy + dy * t];
}

export function paintArrows(): void {
  const svg = layer();
  svg.replaceChildren();
  if (!arrowsOn()) { svg.classList.remove('on'); return; }
  svg.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
  // a hover set survives the re-render that destroyed the thing being hovered;
  // when none of it resolves any more, fall back to the base set rather than
  // showing nothing at all
  const drawn = draw(svg, hoverArrows ?? baseArrows);
  if (!drawn && hoverArrows) draw(svg, baseArrows);
  svg.classList.toggle('on', svg.childElementCount > 0);
}

/** paint `specs` into `svg`; returns how many actually resolved */
function draw(svg: SVGSVGElement, specs: ArrowSpec[]): number {
  let n = 0;
  for (const spec of specs) {
    const a = firstEl(spec.from), b = firstEl(spec.to);
    if (!a || !b || a === b) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const [acx, acy] = centre(ra), [bcx, bcy] = centre(rb);
    const [x1, y1] = edge(ra, bcx, bcy, 2);
    const [x2, y2] = edge(rb, acx, acy, 7);
    const dx = x2 - x1, dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    if (dist < 8) continue;
    // bow every arrow the same way so two arrows between the same pair of
    // panels stay distinguishable instead of overlapping
    const bow = Math.min(90, dist * 0.18);
    const cx = (x1 + x2) / 2 - (dy / dist) * bow;
    const cy = (y1 + y2) / 2 + (dx / dist) * bow;
    const cls = spec.cls ?? 'tgt';

    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', `arrow ${cls}`);

    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('d', `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`);
    g.appendChild(path);

    const dot = document.createElementNS(SVGNS, 'circle');
    dot.setAttribute('cx', String(x1)); dot.setAttribute('cy', String(y1));
    dot.setAttribute('r', '3.5');
    dot.setAttribute('class', 'arrowdot');
    g.appendChild(dot);

    // head oriented along the curve's final tangent (p2 - control)
    const hx = x2 - cx, hy = y2 - cy, hl = Math.hypot(hx, hy) || 1;
    const ux = hx / hl, uy = hy / hl, size = 10;
    const head = document.createElementNS(SVGNS, 'path');
    head.setAttribute('class', 'arrowhead');
    head.setAttribute('d',
      `M ${x2} ${y2} L ${x2 - ux * size - uy * size * 0.55} ${y2 - uy * size + ux * size * 0.55}` +
      ` L ${x2 - ux * size + uy * size * 0.55} ${y2 - uy * size - ux * size * 0.55} Z`);
    g.appendChild(head);

    if (spec.label) {
      const t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('class', 'arrowlabel');
      t.setAttribute('x', String((x1 + x2) / 2 - (dy / dist) * bow * 0.75));
      t.setAttribute('y', String((y1 + y2) / 2 + (dx / dist) * bow * 0.75));
      t.setAttribute('text-anchor', 'middle');
      t.textContent = spec.label;
      g.appendChild(t);
    }
    svg.appendChild(g);
    n++;
  }
  return n;
}
