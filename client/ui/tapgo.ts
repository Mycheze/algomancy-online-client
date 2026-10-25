/*
 * CT-408 — ON TOUCH, A TAP ON A SPELL TOKEN OR A RESOURCE READS; A BUTTON ACTS.
 *
 * Report #201 made a finger's tap on a hand, cache or bin card READ it (main.ts
 * tapOnlyReads). Two taps on the table still acted at once: casting your own
 * spell token, and activating a resource (or the one Prismite exchange a
 * click would fire). Neither has a drag, so gating the tap alone would have
 * left a finger no way to do either. The owner (2026-10-25), asked which taps
 * should become "tap shows the card, then a button acts": "Casting a spell
 * token, Activating a resource". A unit's only ability stays one tap.
 *
 * So a finger's tap reads the card (the zoom, held, as #201's read) and arms
 * ONE pending action: the button drawn on that token or resource does it. The
 * pending action is a value — the very action the tap would have sent — and
 * the button is shown only while the engine still offers it (`tapGoLive`), so
 * a button left over from a moved-on state sends nothing.
 *
 * A mouse never arms one: tapOnlyReads answers false for a hovering pointer,
 * and the click acts as it always did.
 */
import type { Action } from '../engine/src/types.ts';

/** the action a finger's tap held back, and where its button is drawn */
export interface TapGo {
  /** `token:<id>` or `res:<seat>:<index>` — the element the button hangs on */
  key: string;
  action: Action;
  label: string;
}

export const tokenGoKey = (id: number): string => `token:${id}`;
export const resGoKey = (p: number, i: number): string => `res:${p}:${i}`;

/** the button's words: what the tap would have done */
export function tapGoLabel(a: Action): string {
  switch (a.type) {
    case 'castSpellToken': return '▶ Cast';
    case 'activateResource': return 'Activate';
    case 'exchangePrismite': return a.element === 'shard' ? '→ Shard' : `→ ${a.element}`;
    default: return 'Use';
  }
}

/** is the held action still one the engine offers? The same token, the same
 * resource (and for an exchange, the same element) — `ordered`, which the
 * client adds to a cast, is not part of what the engine lists. */
export function tapGoLive(go: TapGo, legal: readonly Action[]): boolean {
  const a = go.action;
  return legal.some(l => {
    if (l.type !== a.type || l.seat !== a.seat) return false;
    if (l.type === 'castSpellToken' && a.type === 'castSpellToken') return l.entityId === a.entityId;
    if (l.type === 'activateResource' && a.type === 'activateResource') return l.index === a.index;
    if (l.type === 'exchangePrismite' && a.type === 'exchangePrismite') return l.index === a.index && l.element === a.element;
    return false;
  });
}

/** the key of the element a source card (the zoom's, a click's) stands for,
 * as the held action names it — or null for anything else */
export function tapGoKeyOf(el: { dataset: Record<string, string | undefined> }): string | null {
  const d = el.dataset;
  if (d['act'] === 'token' && d['id'] !== undefined) return tokenGoKey(Number(d['id']));
  if (d['act'] === 'res' && d['p'] !== undefined && d['i'] !== undefined) return resGoKey(Number(d['p']), Number(d['i']));
  return null;
}

/** THE BUTTON UNDER THE READ. The tap's zoom is drawn over the board and may
 * cover the token's own button, so the zoom carries one too, hung under the
 * copy (main.ts's zoom decorator; zoom.ts keeps a `.zoomhang` on screen). The
 * zoom layer takes no pointer events and its copy is inert, so this one is not
 * clicked: ui/touch.ts asks `zoomGoHit` when the finger that lands on it lifts,
 * and calls the same handler as the board's button. */
export function zoomGoHtml(go: TapGo): string {
  return `<div class="zoomhang zoomgo"><span class="tapgo">${go.label}</span></div>`;
}

/** is (x, y) on the zoom's own button? */
export function zoomGoHit(x: number, y: number): boolean {
  if (typeof document === 'undefined') return false;
  const b = document.querySelector?.('#cardzoom .zoomgo .tapgo') as Element | null;
  const r = b?.getBoundingClientRect?.();
  return !!r && r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** the button, for the element whose key the held action names (else '') */
export function tapGoHtml(go: TapGo | null, key: string): string {
  if (!go || go.key !== key) return '';
  return `<button class="tapgo" data-btn="tapgo">${go.label}</button>`;
}
