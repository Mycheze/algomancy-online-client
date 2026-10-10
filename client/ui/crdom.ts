/* THE RULES REVIEW PAGE: THE DOM HALF OF ANCHORING.
 *
 * cranchor.ts works on strings. This file is the only place that turns a DOM
 * item into its normalised text, a browser selection into offsets in that
 * text, and offsets back into a highlight. One text space, built one way:
 *
 *   · An item is an element carrying `data-crt`. Its text is every text node
 *     inside it EXCEPT those inside a nested item (a section heading's text is
 *     the heading, not the rules under it) and those inside the page's own
 *     decorations (`data-crui`: the ＋ and the 💬 counts), so a decoration
 *     coming or going can never move an anchor.
 *   · Whitespace runs collapse to one space and the ends are trimmed, which
 *     is exactly `cranchor.norm(textContent)` over those nodes. A collapsed
 *     <details> provenance block is included: it is in the DOM either way.
 *   · Highlights are made by SPLITTING text nodes and wrapping the middle in
 *     `<mark class="crhl">`, never by re-assembling HTML strings, so no comment
 *     text can ever reach the markup. Nested marks are how overlaps show.
 *
 * Only a browser can test this half (the review page's CDP pass); the pure
 * half is ui/test/438.
 */

/** one normalised character: the text node and offset it came from */
interface Ch { node: Text; off: number }

/** an item's normalised text and, per character, where it lives in the DOM */
export interface TextMap { text: string; chars: Ch[] }

/** is this text node part of `item`'s own text? */
function ownText(item: Element, n: Node): boolean {
  for (let el = n.parentElement; el && el !== item; el = el.parentElement) {
    if (el.hasAttribute('data-crui') || el.hasAttribute('data-crt')) return false;
  }
  return true;
}

const WS = /\s/;

export function textMap(item: Element): TextMap {
  const chars: Ch[] = [];
  let text = '';
  let pend: Ch | null = null;
  const doc = item.ownerDocument ?? document;
  const walker = doc.createTreeWalker(item, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (ownText(item, n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    const s = node.data;
    for (let off = 0; off < s.length; off++) {
      const c = s[off]!;
      if (WS.test(c)) {
        if (text && !pend) pend = { node, off };
        continue;
      }
      if (pend) { text += ' '; chars.push(pend); pend = null; }
      text += c;
      chars.push({ node, off });
    }
  }
  return { text, chars };
}

/** the index in `m.text` of the first character at or after a DOM point */
function indexAt(m: TextMap, container: Node, offset: number): number {
  const doc = container.ownerDocument ?? document;
  const r = doc.createRange();
  try { r.setStart(container, offset); } catch { return m.text.length; }
  // characters are in document order, so the comparison is monotonic
  let lo = 0;
  let hi = m.chars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const c = m.chars[mid]!;
    if (r.comparePoint(c.node, c.off) < 0) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * A browser range, as offsets into one item's text. A range that runs past
 * the item — or into an item nested in it — is cut at the item's end
 * (`clamped`), so a selection dragged across two rules comments on the first.
 */
export function rangeOffsets(item: Element, range: Range): { m: TextMap; start: number; end: number; clamped: boolean } {
  const m = textMap(item);
  const start = indexAt(m, range.startContainer, range.startOffset);
  // the end is inside the item only if no nested item stands between them
  const endEl = range.endContainer.nodeType === 1 ? range.endContainer as Element : range.endContainer.parentElement;
  const inside = !!endEl && endEl.closest('[data-crt]') === item;
  const end = inside ? indexAt(m, range.endContainer, range.endOffset) : m.text.length;
  return { m, start, end: Math.max(start, end), clamped: !inside };
}

/**
 * Wrap `[start, end)` of an item's text in `<mark class="crhl" data-cid>`.
 * The map is rebuilt first, because an earlier highlight split the nodes. A
 * whitespace-only piece is left alone: it may sit between table cells or list
 * items, where a <mark> would be invalid markup.
 */
export function wrapHighlight(item: Element, start: number, end: number, cid: string): void {
  const m = textMap(item);
  if (end <= start) return;
  const spans = new Map<Text, [number, number]>();
  for (let i = start; i < end && i < m.chars.length; i++) {
    const c = m.chars[i]!;
    const cur = spans.get(c.node);
    spans.set(c.node, cur ? [Math.min(cur[0], c.off), Math.max(cur[1], c.off + 1)] : [c.off, c.off + 1]);
  }
  const doc = item.ownerDocument ?? document;
  for (const [node, [a, b]] of spans) {
    if (!node.data.slice(a, b).trim()) continue;
    const mid = a > 0 ? node.splitText(a) : node;
    if (b - a < mid.data.length) mid.splitText(b - a);
    const mark = doc.createElement('mark');
    mark.className = 'crhl';
    mark.dataset['cid'] = cid;
    mid.parentNode?.insertBefore(mark, mid);
    mark.appendChild(mid);
  }
}

/** take every highlight and every decoration back out of a painted column */
export function clearDecorations(root: Element): void {
  for (const el of Array.from(root.querySelectorAll('[data-crui]'))) el.remove();
  const marks = Array.from(root.querySelectorAll('mark.crhl'));
  for (const mk of marks) {
    const parent = mk.parentNode;
    if (!parent) continue;
    while (mk.firstChild) parent.insertBefore(mk.firstChild, mk);
    parent.removeChild(mk);
  }
  if (marks.length) root.normalize();
}

/** the normalised text of one item inside a piece of render's HTML that is
 * not on the page: parsed into an inert <template>, never into the document */
export function detachedText(html: string, target: string): string | null {
  const t = document.createElement('template');
  t.innerHTML = html;
  const item = t.content.querySelector(`[data-crt="${CSS.escape(target)}"]`);
  return item ? textMap(item).text : null;
}
