/* THE RULES REVIEW PAGE: ANCHORING, AS PURE FUNCTIONS.
 *
 * A comment points at a passage the way the W3C Web Annotation model (and
 * Hypothesis) does it: the quoted text, a little context either side, and
 * where it started. The document is regenerated after every round, so a
 * comment never stores a DOM path or a character offset alone: it is found
 * again by its words, and the offset only breaks ties.
 *
 *   · `norm` is the one text space. An anchor is measured in the normalised
 *     text of its item (crdom.ts builds it off the DOM with the same rule), so
 *     the side that makes an anchor and the side that finds it again cannot
 *     disagree about what a character is.
 *   · `locate` finds a quote again, or says it has gone (null: the thread is
 *     OUTDATED and is shown at the top of its item with the old words struck).
 *   · `targetResolver` follows a renamed rule key, recognises a removed one,
 *     and says when a target has left the document altogether (an ORPHAN).
 *   · `placer` turns a link (`#r608.2b`, `#D-U12-3`) or a comment target into
 *     the tab and chapter that show it. The section is read off the number's
 *     own leading digits, never off a list.
 *   · `layoutMargin` stacks the margin's thread cards without overlap.
 *
 * No DOM here, so ui/test/438 can drive every branch under node.
 */
import type { CrAnchor, CrReviewDoc } from './crtypes.ts';

/** collapse every whitespace run to one space and trim. No case or typography
 * folding: that is `fold`'s job, and only as a second chance */
export const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** how much context an anchor keeps either side of its quote */
const CONTEXT = 32;
/** the longest quote the server accepts (crtypes CrAnchor) */
export const QUOTE_MAX = 500;

/**
 * The second chance, for punctuation churn only: curly quotes to straight,
 * the dashes to a hyphen, a no-break space to a space. Every replacement is
 * one UTF-16 unit for one, so an index into the folded text is an index into
 * the original.
 */
const fold = (s: string): string => s
  .replace(/[‘’‚‛′]/g, "'")
  .replace(/[“”„‟″]/g, '"')
  .replace(/[‒–—―−]/g, '-')
  .replace(/ /g, ' ');

/**
 * An anchor for `text.slice(start, end)`, `text` being an item's normalised
 * text. Spaces at either edge of the selection are dropped, and the quote is
 * cut at QUOTE_MAX. Null when nothing but spaces was selected.
 */
export function makeAnchor(text: string, start: number, end: number, edition: string, num?: string): CrAnchor | null {
  let s = Math.max(0, Math.min(start, text.length));
  let e = Math.max(s, Math.min(end, text.length));
  while (s < e && text[s] === ' ') s++;
  while (e > s && text[e - 1] === ' ') e--;
  e = Math.min(e, s + QUOTE_MAX);
  if (e <= s) return null;
  return {
    quote: text.slice(s, e),
    prefix: text.slice(Math.max(0, s - CONTEXT), s),
    suffix: text.slice(e, e + CONTEXT),
    start: s,
    edition: edition.slice(0, 80),
    ...(num ? { num } : {}),
  };
}

function indexesOf(hay: string, needle: string): number[] {
  const out: number[] = [];
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) out.push(i);
  return out;
}

/** how many characters at the END of `a` match the end of `b` */
function commonTail(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** how many characters at the START of `a` match the start of `b` */
function commonHead(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Find an anchor's quote in an item's normalised text. Exact first; then the
 * same search over folded text. One hit is the answer; several are told apart
 * by how much of the stored context still surrounds each, and only then by
 * distance from where the quote used to start. Null means the words are no
 * longer there: the thread is outdated, never silently moved.
 */
export function locate(text: string, a: Pick<CrAnchor, 'quote' | 'prefix' | 'suffix' | 'start'>): { start: number; end: number } | null {
  if (!a.quote) return null;
  let hay = text;
  let hits = indexesOf(hay, a.quote);
  let prefix = a.prefix;
  let suffix = a.suffix;
  if (!hits.length) {
    hay = fold(text);
    hits = indexesOf(hay, fold(a.quote));
    prefix = fold(prefix);
    suffix = fold(suffix);
  }
  if (!hits.length) return null;
  const len = a.quote.length;
  let best = hits[0]!;
  if (hits.length > 1) {
    let bestScore = -Infinity;
    for (const i of hits) {
      const score = commonTail(hay.slice(0, i), prefix) + commonHead(hay.slice(i + len), suffix)
        - Math.abs(i - a.start) / 1000;
      if (score > bestScore) { bestScore = score; best = i; }
    }
  }
  return { start: best, end: best + len };
}

/* ── targets ─────────────────────────────────────────────────────────────── */

/** live: on the page. removed: a tombstoned rule, shown at its tombstone.
 * orphan: no longer anywhere in the document */
export type CrTargetState = 'live' | 'removed' | 'orphan';

/**
 * Where a stored target lives today. Nothing in the journal is ever rewritten:
 * a renamed rule key is followed through the aliases each time it is shown.
 */
export function targetResolver(doc: Pick<CrReviewDoc, 'targets' | 'aliases' | 'removed'>): (target: string) => { target: string; state: CrTargetState } {
  const known = new Set<string>(doc.targets);
  return (target: string) => {
    let t = target;
    if (t.startsWith('rule:')) {
      let key = t.slice(5);
      // a chain of renames is followed to its end; a loop stops after a lap
      for (let hops = 0; hops < 32 && Object.prototype.hasOwnProperty.call(doc.aliases, key); hops++) {
        key = doc.aliases[key]!;
      }
      t = `rule:${key}`;
      if (Object.prototype.hasOwnProperty.call(doc.removed, key)) return { target: t, state: 'removed' };
    }
    return { target: t, state: known.has(t) ? 'live' : 'orphan' };
  };
}

/* ── places: which tab and chapter show a link or a target ───────────────── */

export type CrTab = 'doc' | 'annexD' | 'disc' | 'oq' | 'comments';

/** what the page has to paint to show something: a tab, the contents entry
 * within it (a chapter `ch6`, or a single part such as `glossary`), and the
 * element id to scroll to */
export interface CrPlace { tab: CrTab; view: string | null; anchor: string | null }

/** the section a rule number sits in: `608.2b` → `608`, `D3.1` → `D3` */
export function sectionOf(num: string): string | null {
  const m = /^(\d{3}|D\d+)(?![\d])/.exec(num);
  return m ? m[1]! : null;
}

/** render's own fixed element ids, for the links its prose and rail carry */
const RENDER_IDS: Record<string, CrPlace> = {
  'intro': { tab: 'doc', view: 'front', anchor: null },
  'annex-p': { tab: 'doc', view: 'annexP', anchor: null },
  'glossary': { tab: 'doc', view: 'glossary', anchor: null },
  'changelog': { tab: 'doc', view: 'changelog', anchor: null },
  'annex-d': { tab: 'annexD', view: 'chD', anchor: null },
  'discrepancies': { tab: 'disc', view: null, anchor: null },
};

export function placer(doc: Pick<CrReviewDoc, 'toc' | 'parts' | 'disc' | 'keys' | 'aliases'>): {
  ofRef: (ref: string) => CrPlace | null;
  ofTarget: (target: string) => CrPlace | null;
} {
  const tocIds = new Set(doc.toc.map(e => e.id));
  const partById = new Map(doc.parts.map(p => [p.id, p]));
  const discIds = new Set(doc.disc.map(d => d.id));
  const chapterView = (ch: string): string => `ch${ch}`;

  const ofRef = (raw: string): CrPlace | null => {
    const ref = raw.replace(/^#/, '');
    if (!ref) return null;
    if (tocIds.has(ref)) return { tab: ref === 'chD' ? 'annexD' : 'doc', view: ref, anchor: null };
    if (RENDER_IDS[ref]) return { ...RENDER_IDS[ref]! };
    if (/^r(\d{3}|D\d+)/.test(ref)) {
      const sec = sectionOf(ref.slice(1));
      const part = sec ? partById.get(`s${sec}`) : undefined;
      if (!part?.chapter) return null;
      return { tab: part.chapter === 'D' ? 'annexD' : 'doc', view: chapterView(part.chapter), anchor: ref };
    }
    // a discrepancy, or one of the ids a merged discrepancy is "also filed as"
    if (discIds.has(ref) || /^D-/.test(ref)) return { tab: 'disc', view: null, anchor: ref };
    // an Annex P finding
    if (/^F-/.test(ref)) return { tab: 'doc', view: 'annexP', anchor: ref };
    return null;
  };

  const ofTarget = (target: string): CrPlace | null => {
    const i = target.indexOf(':');
    const kind = i < 0 ? target : target.slice(0, i);
    const rest = i < 0 ? '' : target.slice(i + 1);
    switch (kind) {
      case 'front': case 'annexP': case 'changelog':
        return { tab: 'doc', view: kind, anchor: null };
      case 'annexD': return { tab: 'annexD', view: 'chD', anchor: null };
      case 'sec': return ofRef(`r${rest}`);
      case 'rule': {
        let key = rest;
        for (let hops = 0; hops < 32 && Object.prototype.hasOwnProperty.call(doc.aliases, key); hops++) key = doc.aliases[key]!;
        const num = doc.keys[key];
        return num ? ofRef(`r${num}`) : null;
      }
      case 'disc': return { tab: 'disc', view: null, anchor: rest };
      case 'finding': return { tab: 'doc', view: 'annexP', anchor: rest };
      case 'gloss': return { tab: 'doc', view: 'glossary', anchor: null };
      default: return null;
    }
  };

  return { ofRef, ofTarget };
}

/* ── the margin ──────────────────────────────────────────────────────────── */

/**
 * Stack the margin's cards: each wants to sit level with its passage (`y`),
 * and a card that would overlap the one above is pushed down below it. Order
 * is the order of `y` (input order breaks ties), so a card never jumps above
 * a passage that comes before its own.
 */
export function layoutMargin(items: readonly { id: string; y: number; h: number }[], gap = 8): Map<string, number> {
  const order = items.map((it, i) => ({ ...it, i })).sort((a, b) => a.y - b.y || a.i - b.i);
  const out = new Map<string, number>();
  let floor = -Infinity;
  for (const it of order) {
    const top = Math.max(it.y, floor);
    out.set(it.id, top);
    floor = top + it.h + gap;
  }
  return out;
}
