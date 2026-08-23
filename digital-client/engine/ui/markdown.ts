/* Report #82: "the judge's answer shows up with the asterisks and hashes still
 * in it." It does, because the answer IS markdown by design — the rules-bot
 * system prompt asks for "clean markdown" — and the client was escaping it and
 * printing it raw.
 *
 * This is a DELIBERATELY SMALL renderer, sized to what the bot actually emits.
 * Measured over the 62 logged answers in logs/responses.jsonl:
 *   bold 84% · italic 29% · `- ` bullets 21% · `## ` 15% · `### ` 3%
 *   `1. ` ordered 11% · `code` 10% · `> ` blockquote 6.5%
 *   links, tables, fenced code, `---`, `~~strike~~`: ZERO occurrences.
 *
 * Two rules make it safe by construction rather than by vigilance:
 *
 *  1. RAW TEXT ENTERS THE OUTPUT IN EXACTLY ONE PLACE — the `inline` hook,
 *     which defaults to `esc`. Every other character emitted here is a literal
 *     from the fixed tag set below. There is no second path to remember to
 *     escape, so a future edit cannot forget one.
 *
 *  2. NO ATTRIBUTE IS EVER EMITTED. Not href, not src, not style, not class.
 *     The tag set is closed: <strong> <em> <code> <h3> <h4> <ul> <ol> <li>
 *     <blockquote> <p> <br>. Link syntax is NOT implemented and must not be:
 *     zero logged answers use links, and a link is where a markdown renderer
 *     stops being a formatter and becomes an XSS surface (`javascript:` hrefs,
 *     `onerror=` smuggled through a title). Unrecognised syntax falls through
 *     as escaped literal text, which is exactly the pre-#82 behaviour.
 *
 * `## ` maps to <h3> and `### ` to <h4> because the overlay already owns h3 as
 * its own title scale — the answer's headings live under it, never beside it.
 *
 * The caller may pass a richer `inline` (main.ts passes `iconizeText`, so
 * [Switch1] and {Battle} come out as real icons). Such a hook is trusted to
 * escape what it is handed — iconizeText escapes FIRST by construction — and
 * owns whatever markup it emits; rule 2 above binds this module, not the hook.
 */
import { esc } from './util.ts';

/** every tag this module can emit — the closed set the tests sweep for */
export const MD_TAGS = [
  'strong', 'em', 'code', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'p', 'br',
] as const;

type Inline = (s: string) => string;

const BULLET = /^\s{0,6}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,6}\d{1,3}[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;

/** `**bold**` before `*italic*`, and code spans before either — a code span is
 * literal, so emphasis markers inside one are just characters. */
const INLINE_RE = /`([^`\n]+)`|\*\*([^\n]+?)\*\*|__([^\n]+?)__|\*([^*\n]+)\*|(?<![A-Za-z0-9])_([^_\n]+)_(?![A-Za-z0-9])/;

/** one run of text between block markers, with emphasis resolved */
function renderInline(src: string, inline: Inline, depth = 0): string {
  if (!src) return '';
  const m = depth < 4 ? INLINE_RE.exec(src) : null;
  if (!m) return inline(src);
  const [whole, code, bold1, bold2, it1, it2] = m;
  const head = inline(src.slice(0, m.index));
  const tail = renderInline(src.slice(m.index + whole.length), inline, depth);
  // a code span's body goes through the SAME hook — one seam, no exceptions
  const body = code !== undefined
    ? `<code>${inline(code)}</code>`
    : bold1 !== undefined || bold2 !== undefined
      ? `<strong>${renderInline((bold1 ?? bold2)!, inline, depth + 1)}</strong>`
      : `<em>${renderInline((it1 ?? it2)!, inline, depth + 1)}</em>`;
  return head + body + tail;
}

/** lines of one paragraph — a soft line break inside a paragraph is a <br>,
 * which is how the bot writes a two-line aside under a bullet */
const para = (lines: string[], inline: Inline): string =>
  `<p>${lines.map(l => renderInline(l.trim(), inline)).join('<br>')}</p>`;

/**
 * Render the small markdown subset the rules bot emits as a closed set of
 * attribute-free tags. Pure: same input, same output, no DOM, no globals.
 *
 * @param src   the raw markdown (never pre-escaped — see rule 1 above)
 * @param opts.inline the ONE place raw text becomes output; defaults to `esc`
 */
export function mdToHtml(src: string, opts?: { inline?: Inline }): string {
  return blocks(String(src ?? '').split(/\r?\n/), opts?.inline ?? esc, 0);
}

function blocks(lines: string[], inline: Inline, depth: number): string {
  const out: string[] = [];
  let buf: string[] = [];          // the paragraph being gathered
  const flush = (): void => {
    if (buf.length) out.push(para(buf, inline));
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) { flush(); continue; }

    const h = HEADING.exec(line);
    if (h) {
      flush();
      const tag = h[1]!.length <= 2 ? 'h3' : 'h4';
      out.push(`<${tag}>${renderInline(h[2]!.trim(), inline)}</${tag}>`);
      continue;
    }

    const q = QUOTE.exec(line);
    if (q) {
      flush();
      const quoted = [q[1]!];
      while (i + 1 < lines.length) {
        const nxt = QUOTE.exec(lines[i + 1]!);
        if (!nxt) break;
        quoted.push(nxt[1]!);
        i++;
      }
      // recursion is bounded: each level strips a '>' so the text strictly
      // shrinks, and depth caps it regardless
      out.push(`<blockquote>${
        depth < 3 ? blocks(quoted, inline, depth + 1) : para(quoted, inline)
      }</blockquote>`);
      continue;
    }

    const list = listAt(lines, i);
    if (list) {
      flush();
      out.push(`<${list.tag}>${
        list.items.map(t => `<li>${renderInline(t, inline)}</li>`).join('')
      }</${list.tag}>`);
      i = list.end;
      continue;
    }

    buf.push(line);
  }
  flush();
  return out.join('');
}

/** the run of list items starting at `i`, or null if none starts there. A
 * continuation line (indented, no marker) joins the item above it — the bot
 * wraps long bullets. */
function listAt(lines: string[], i: number): { tag: 'ul' | 'ol'; items: string[]; end: number } | null {
  const first = BULLET.exec(lines[i]!) ? BULLET : ORDERED.exec(lines[i]!) ? ORDERED : null;
  if (!first) return null;
  const tag = first === BULLET ? 'ul' : 'ol';
  const items: string[] = [];
  let end = i;
  for (let j = i; j < lines.length; j++) {
    const line = lines[j]!;
    const m = first.exec(line);
    if (m) { items.push(m[1]!.trim()); end = j; continue; }
    // A LOOSE LIST — blank line between items — is one list, not several. The
    // bot writes its numbered rules this way, and splitting them yielded four
    // <ol>s each restarting at "1.". Only a same-marker item resumes it.
    if (!line.trim()) {
      let k = j + 1;
      while (k < lines.length && !lines[k]!.trim()) k++;
      if (k < lines.length && first.test(lines[k]!)) { j = k - 1; continue; }
      break;
    }
    // a differently-marked item ends this list; so does a fresh block. An
    // indented continuation folds into the previous item.
    if (line.trim() && /^\s{2,}/.test(line) && items.length) {
      items[items.length - 1] += ` ${line.trim()}`;
      end = j;
      continue;
    }
    break;
  }
  return { tag, items, end };
}
