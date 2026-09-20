/* CARD NAMES IN PROSE, turned into something you can hover.
 *
 * WHY THIS IS NOT IN ui/markdown.ts. That module states two invariants and
 * they are the reason it is safe: raw text enters the output in exactly one
 * place, and NO ATTRIBUTE IS EVER EMITTED — "Link syntax is NOT implemented
 * and must not be: a link is where a markdown renderer stops being a formatter
 * and becomes an XSS surface." Nothing here weakens that. This is the `inline`
 * hook it already documents ("The caller may pass a richer `inline` … Such a
 * hook is trusted to escape what it is handed … and owns whatever markup it
 * emits; rule 2 above binds this module, not the hook"), which is how main.ts
 * already passes `iconizeText`. `[Text](Name)` is not in markdown.ts's
 * INLINE_RE, so it falls through untouched and is parsed here.
 *
 * THE ONE ATTRIBUTE, AND WHY IT IS SAFE. Every link carries `data-prev`, and
 * the value is ALWAYS the name `rowFor` handed back — never the writer's
 * string. A target the card index does not recognise produces no link at all,
 * just the escaped literal text. So the attribute's value set is the card
 * pool, which is a fixed list in this build, and no input can widen it. That
 * is the same discipline as markdown.ts's rule 2 rather than an exception to
 * it: the tag set is closed, the attribute set is closed, and the one value
 * that varies was vouched for by the index.
 *
 * A deck description is the first user text this client renders on OTHER
 * people's screens, so that distinction is the whole security argument and
 * test/213 sweeps the output to hold it.
 *
 * THE SINGLE-WORD PROBLEM. 140 of the pool's names are one word, and some are
 * rules vocabulary — Battle, Trash, Cache, Rot, Debt, Augment, Graft. Linking
 * those on sight would fire on every third sentence of a strategy primer. The
 * fix is DERIVED, not a hand-written stoplist: a one-word name that is also a
 * glossary term does not auto-link, and ui/glossary.ts already carries that
 * table (its GlossEntry even has an `re` field for "terms that are also
 * ordinary English", so this is the same problem that file already solved).
 * A stoplist would be right today and wrong the next time a card is printed.
 *
 * Case-sensitivity does the rest of the work: prose says "we fight early", the
 * card is `Fight`. Anybody who means the card can always say so explicitly.
 *
 * PURE AND DOM-FREE, so test/213 can run it under node --test.
 */
import { GLOSSARY } from './glossary.ts';
import { allRows, rowFor } from './cardindex.ts';
import { esc } from './util.ts';

/** `[Any Text](Actual Card Name)`. Kept off the shared matcher's hot path as
 * its own alternative so it wins wherever it appears. */
const EXPLICIT = String.raw`\[([^\]\n]*)\]\(([^)\n]+)\)`;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** the one-word names that must not auto-link, derived from the glossary */
function reservedWords(): Set<string> {
  return new Set(GLOSSARY.map(g => g.term.toLowerCase()));
}

/**
 * Which names are scanned for bare, longest first.
 *
 * `playable` and `class: card` together: a description that says "Crystal"
 * means the noun far more often than the token, and a Cardback is not a thing
 * anybody writes about. Both are still reachable with the explicit form, which
 * accepts any name the index knows.
 */
function bareNames(): string[] {
  const reserved = reservedWords();
  return allRows()
    .filter(r => r.playable && r.cls === 'card')
    .map(r => r.name)
    .filter(n => n.includes(' ') || !reserved.has(n.toLowerCase()))
    // longest first: JS alternation is leftmost-FIRST, not longest, so
    // "Wraith" would otherwise win inside "Wraith of the Deep"
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
}

let MATCHER: RegExp | null = null;

/** Built once — 480-odd alternatives is a big regex and a cheap one, but not
 * one to rebuild per paragraph. */
function matcher(): RegExp {
  if (MATCHER) return MATCHER;
  const names = bareNames().map(escapeRe).join('|');
  // The lookarounds do what \b cannot: a name may end in a letter, a digit, an
  // apostrophe or a hyphen, and \b around "Hooba-Bot" would match inside
  // "Hooba-Bots". Letters and digits on either side veto the match; punctuation
  // and whitespace do not.
  MATCHER = new RegExp(`${EXPLICIT}|(?<![A-Za-z0-9])(?:${names})(?![A-Za-z0-9])`, 'g');
  return MATCHER;
}

/* No reset seam for the cache: the two tables it is built from (the card index
 * and the glossary) are static in a build, so there is no moment at which a
 * rebuild would produce a different regex. 147's dead-helper check removed the
 * one that was here on exactly that reasoning. */

const link = (name: string, text: string, opts: LinkOpts): string =>
  `<a class="cardlink" data-prev="${esc(name)}"${opts.art ? ' data-prevart=""' : ''}${
    opts.focusBtn ? ` data-btn="${esc(opts.focusBtn)}" data-card="${esc(name)}"` : ''}>${esc(text)}</a>`;

export interface LinkOpts {
  /** the host's `data-btn` for pinning a card, if it has one. Without it the
   * links still hover — that is main.ts's document-level `data-prev` handler,
   * which no page has to opt into — they just do not pin. */
  focusBtn?: string;
  /**
   * Hover shows the CARD, not its rules text.
   *
   * The default long-hover box is the printed text box, which is the right
   * answer on a board: you are looking at a card you can already see and want
   * the wording. In prose it is the wrong one — the owner, 2026-09-20: *"The
   * hover effect on card names in the deck description should show the card
   * image, not the text box."* Somebody reading a primer does not know what
   * the card LOOKS like, and the picture answers "which one is that" in a
   * glance where a paragraph of rules text does not.
   *
   * ⚠ THE EMITTED ATTRIBUTE IS VALUELESS, and that is the whole of why it is
   * safe. This module's security argument (see the header) is that every
   * attribute it writes has a closed value set; `data-prevart=""` has a value
   * set of one, so it widens nothing. test/213 sweeps for exactly this.
   */
  art?: boolean;
}

/**
 * An `inline` hook for ui/markdown.ts that turns card names into hover links.
 *
 * Returns the hook rather than being one, because the button prefix belongs to
 * whichever page is rendering: `deck-focus` on the deck page, `meta-focus` on
 * the metagame list. See markdown.ts's header for the contract this satisfies.
 */
export function cardLinker(opts: LinkOpts = {}): (s: string) => string {
  return (src: string): string => {
    if (!src) return '';
    const re = matcher();
    re.lastIndex = 0;
    let out = '';
    let at = 0;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      // EVERY character outside a match goes through esc, here and only here
      out += esc(src.slice(at, m.index));
      at = m.index + m[0].length;
      const [whole, text, target] = m;
      if (target !== undefined) {
        // the explicit form: any name the index knows, of any class
        const row = rowFor(target.trim());
        out += row ? link(row.name, text ?? '', opts) : esc(whole);
      } else {
        // a bare name — already known to be in the pool, since the matcher is
        // built from it, but ask anyway so the attribute's value comes from
        // the index rather than from the input
        const row = rowFor(whole);
        out += row ? link(row.name, whole, opts) : esc(whole);
      }
    }
    return out + esc(src.slice(at));
  };
}

/**
 * The first sentences of a description, for the collapsed state.
 *
 * Clipping happens on the SOURCE and produces source, not markup: cutting
 * rendered HTML at a character count is how a renderer starts emitting half a
 * tag. It stops at a sentence end where it can and at a word boundary where it
 * cannot, and it never reports a clip it did not make — a description shorter
 * than the budget comes back whole, with `clipped: false`, so the caller knows
 * not to offer a "more" button that would reveal nothing.
 */
export function clipDescription(src: string, budget = 220): { text: string; clipped: boolean } {
  const s = String(src ?? '').trim();
  if (s.length <= budget) return { text: s, clipped: false };
  const head = s.slice(0, budget);
  // the last sentence end that leaves something worth reading
  const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (stop > budget * 0.4) return { text: s.slice(0, stop + 1), clipped: true };
  const space = head.lastIndexOf(' ');
  return { text: (space > 0 ? head.slice(0, space) : head) + '…', clipped: true };
}

/**
 * A description reduced to one line of plain prose — the metagame list's
 * snippet, and nothing else.
 *
 * A row on that list is one line high, so it cannot render markdown; it printed
 * the SOURCE instead and a description that opened with a heading came out as
 * "## How it works This deck leans on". Stripping the markers is the whole job:
 * this is not a renderer and must never become one, because a one-line summary
 * that can emit a tag is a one-line summary that can emit the wrong tag.
 *
 * It returns TEXT, never markup. The caller escapes it, the same as any other
 * string it interpolates.
 */
export function descSummary(src: string, budget = 150): string {
  const flat = String(src ?? '')
    .replace(/```[\s\S]*?```/g, ' ')             // fenced code, whole
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')          // heading marks
    .replace(/^\s{0,6}[-*+]\s+/gm, '')           // bullets
    .replace(/^\s{0,6}\d{1,3}[.)]\s+/gm, '')     // ordered items
    .replace(/^\s{0,3}>\s?/gm, '')               // quote marks
    .replace(/\[([^\]\n]*)\]\(([^)\n]+)\)/g, (_, text: string, target: string) =>
      // an explicit card link reads as its TEXT, or as the card when the text
      // is empty — which is what a reader of the rendered version would see
      (text.trim() || target.trim()))
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*([^\n]+?)\*\*|__([^\n]+?)__/g, (_, a: string, b: string) => a ?? b)
    .replace(/(?<![A-Za-z0-9])[*_]([^*_\n]+)[*_](?![A-Za-z0-9])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length <= budget ? flat : clipDescription(flat, budget).text;
}
