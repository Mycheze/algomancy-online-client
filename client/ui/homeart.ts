/* THE HOME SCREEN'S ART (owner, 2026-11-07: "more colour… card images",
 * after Caleb's early mockups, which put full-bleed card art behind every
 * panel).
 *
 * Every picture here is a card scan already in data/cards/ (Caleb's art,
 * data/NOTICE.md), cropped by CSS to the painting between the name bar and
 * the text box. Nothing is copied or re-encoded; the browser has most of
 * these cached from the table anyway.
 *
 * The picks are TASTE, not data, so they are written down once here:
 * - the page's backdrop is a resource card: the viewer's favourite element's
 *   orb, or the purple Shard orb that matches the app's own colour;
 * - Draft and Constructed are a RANDOM card each, drawn once per page load
 *   (owner, 2026-11-07: a fixed crop of a portrait card "just looks random",
 *   so let it be random — a new painting every visit). Drawn once, not per
 *   paint: the home repaints every few seconds (the queue poll);
 * - League, Challenge and Matchmaking each have one, and a challenge week may
 *   name its own (CHALLENGE_ART, by the challenge's id; an unnamed week gets
 *   one of CHALLENGE_POOL, the same one every time for the same id).
 * A card that is renamed or removed only loses its picture: test 1170 holds
 * every name here to a scan on disk.
 */
import { artUrl } from './assets.ts';
import { allRows } from './cardindex.ts';

/** a card's scan, as data/cards/ names it: spaces become hyphens */
export const scanOf = (card: string): string => artUrl(card.replace(/ /g, '-') + '.jpg');

/** a picture as the page draws it: the scan's URL, the card it is from, and
 * where to centre a wide crop of it (CSS object-position's y, in %) */
export interface ArtPick { src: string; card: string; focusY: number }
/** the curated panels' crop: the upper middle of the painting */
const DEFAULT_FOCUS = 30;
export const artPick = (card: string, focusY = DEFAULT_FOCUS): ArtPick => ({ src: scanOf(card), card, focusY });

/** The y to centre a wide crop on a card's painting: the middle of the band
 * between the name bar (the top ~11% of every scan) and the rules box
 * (`textTop`, read off each scan; ~0.78 when unknown). `visible` is about how
 * much of the card's height a mode tile shows (a 3:1 box over a 0.72 card). */
export function focusOn(textTop: number | null, visible = 0.25): number {
  const mid = (0.11 + (textTop ?? 0.78)) / 2;
  const p = (mid - visible / 2) / (1 - visible);
  return Math.round(Math.max(0, Math.min(1, p)) * 100);
}

/** every card a mode tile may draw: real, deck-legal cards with a painting —
 * no tokens, resources, help cards or markers (cardindex's own classes) */
export function modeArtPool(): { card: string; image: string; textTop: number | null }[] {
  return allRows().filter(r => r.cls === 'card' && r.playable && r.hasArt && !!r.image)
    .map(r => ({ card: r.name, image: r.image, textTop: r.textTop }));
}

/** two different cards from the pool. `rand` is injectable for the tests. */
export function drawModeArt(rand: () => number = Math.random): { draft: ArtPick; constructed: ArtPick } {
  const pool = modeArtPool();
  if (pool.length < 2) return { draft: artPick(FALLBACK_MODE_ART.draft), constructed: artPick(FALLBACK_MODE_ART.constructed) };
  const i = Math.floor(rand() * pool.length) % pool.length;
  let j = Math.floor(rand() * (pool.length - 1)) % (pool.length - 1);
  if (j >= i) j++;
  const pick = (k: number): ArtPick => ({ src: artUrl(pool[k]!.image), card: pool[k]!.card, focusY: focusOn(pool[k]!.textTop) });
  return { draft: pick(i), constructed: pick(j) };
}

let drawn: { draft: ArtPick; constructed: ArtPick } | null = null;
/** this page load's two tiles: drawn on the first ask, then the same every paint */
export function modeArt(): { draft: ArtPick; constructed: ArtPick } {
  return drawn ??= drawModeArt();
}

/** each element's resource card — the orb paintings */
export const RESOURCE_ART: Record<string, string> = {
  fire: 'Fire Resource', water: 'Water Resource', earth: 'Earth Resource', wood: 'Wood Resource',
  metal: 'Metal Resource', light: 'Light Resource', dark: 'Dark Resource',
};
/** the backdrop when no favourite element is set: purple, like the app */
export const DEFAULT_BACKDROP = 'Shard Resource';

/** the tiles' pictures if the card index somehow has no cards to draw from */
export const FALLBACK_MODE_ART = { draft: 'Arcane Echo', constructed: 'Sandstone Defender' } as const;
export const LEAGUE_ART = 'Crystal';
export const QUEUE_ART = 'Fight';

/** a week's own picture, by challenge id (server/challenges.ts) */
export const CHALLENGE_ART: Record<string, string> = {
  '2026-10-25-crowd': 'Colony of the Interworld',
  '2026-11-01-tokens': 'Collective Creation',
  '2026-11-08-giant': 'Towering Colossus',
  '2026-11-15-counters': 'Accumulated Nucleation',
  '2026-11-15-set': 'Prismatic Observer',
  '2026-11-22-draw': 'Scholar of the Void',
  '2026-11-29-owngoal': 'Throw off a Cliff',
  '2026-12-06-oneshot': 'Fireball',
  '2026-12-13-health': 'Life Channel',
  '2026-12-20-grafts': 'Self Assembly',
  '2026-12-27-spree': 'Tithe Enforcer',
  '2027-01-03-stack': 'Buffer Overflow',
  '2027-01-10-doubleko': 'Battle',
};
/** a week nobody named a picture for draws one of these, by its id */
export const CHALLENGE_POOL = ['Skybreaker', 'Cosmic Reversal', 'Meteor Shower', 'Temporal Rift', 'Arcane Concentrator', 'Galactic Germination'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export const challengeArtCard = (id: string): string =>
  CHALLENGE_ART[id] ?? CHALLENGE_POOL[hash(id) % CHALLENGE_POOL.length]!;

/** the backdrop's card for a favourite element (null / unknown: the default) */
export const backdropCard = (favorite: string | null | undefined): string =>
  (favorite && RESOURCE_ART[favorite]) || DEFAULT_BACKDROP;

/** every card name this module can return — test 1170 checks each has a scan */
export const ALL_HOME_ART: readonly string[] = [
  ...Object.values(RESOURCE_ART), DEFAULT_BACKDROP, ...Object.values(FALLBACK_MODE_ART), LEAGUE_ART, QUEUE_ART,
  ...Object.values(CHALLENGE_ART), ...CHALLENGE_POOL,
];
