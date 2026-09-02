/* GET /api/cardsearch — the card query language, over HTTP.
 *
 * ── WHY THIS FILE IMPORTS FROM ui/ ───────────────────────────────────
 *
 * This is the first `server/ -> ui/` import in the repo, and it is deliberate.
 * The Discord bot needs the same `el:fire mana<=3` the browser's card page
 * understands, and the bot is Python: it cannot import a TypeScript parser. So
 * either the grammar is reimplemented in Python — two grammars that WILL drift,
 * with a shared corpus needed to prove they agree — or the one implementation
 * grows a caller. It grows a caller.
 *
 * ui/cardsearch.ts, ui/cardindex.ts and ui/cardsynonyms.ts are pure and
 * DOM-free; cardindex.ts's own header says that is the whole point of them.
 * Nothing enforced it until now — ui/tsconfig.json has `"lib": [..., "DOM"]`,
 * so a stray `document` there would have compiled. THIS server's tsconfig has
 * `"lib": ["ES2022"]` and no DOM, so importing the trio here compiles it
 * without DOM for the first time and the claim becomes a build error instead
 * of a comment. 282-dom-free-trio.test.ts holds the line from the other side.
 *
 * MOVE THE TRIO TO `client/search/` WHEN, AND NOT BEFORE: a THIRD project
 * needs it, or one of the three genuinely needs a DOM type. Counted at the
 * time of writing, the move is 17 import edits across ui/ plus 9 engine tests,
 * plus backlog.ts's `touches`, CLAUDE.md and a fifth tsconfig — too much blast
 * radius in a tree other sessions edit live, for one consumer. What makes it
 * cheap when it comes: ui/ -> search/ is a SAME-DEPTH sibling move, so every
 * `../engine/src/...` specifier inside the three files stays byte-identical.
 * Only the importers change.
 *
 * ── WHAT THE PAYLOAD PROMISES ────────────────────────────────────────
 *
 * `total` is the UNSLICED match count and `returned` is what came back.
 * SearchResult.total's own docstring warns that a caller which slices must not
 * report the slice; this endpoint is the first caller that slices, so the two
 * numbers are separate fields rather than one ambiguous one.
 *
 * `errors` is surfaced, never swallowed. The parser is tolerant by design — it
 * auto-closes an unfinished quote or paren and records what it guessed — so a
 * client that showed results for `o:"draw a ca` without saying it guessed would
 * be answering a different question than the one it was asked.
 *
 * `art` is composed HERE. CardRow.image is a bare filename and this server
 * already serves /data/cards/<file> (main.ts), so composing the URL server-side
 * is what keeps a second caller from re-deriving a path. ui/assets.ts's
 * ART_BASE is deliberately relative and its depth is load-bearing twice; a
 * consumer handed an absolute `art` never has to go near it.
 *
 * Public, no token. The same rows already ship inside ui/bundle.js to every
 * visitor, so gating this would be theatre.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from './api-util.ts';
import { search } from '../ui/cardsearch.ts';
import type { CardRow } from '../ui/cardindex.ts';

/** How many cards one request may return, whatever it asks for. */
export const MAX_LIMIT = 50;
export const DEFAULT_LIMIT = 10;

/** One card, flattened to what a card embed or a list row actually prints. */
export interface CardSearchCard {
  name: string;
  /** the whole printed type line, subtypes included */
  type: string;
  supertype: string;
  subtypes: string[];
  /** printed affinity pips, e.g. "rr" */
  cost: string;
  mana: number;
  isX: boolean;
  pow: number;
  tou: number;
  /** element identity, e.g. ['fire','wood'] */
  elements: string[];
  text: string;
  attrs: string[];
  kind: string;
  timing: string;
  cls: string;
  set: string;
  /** bare filename, as CardRow.image already is */
  image: string;
  /** …and the URL this server serves it at. Composed once, here. */
  art: string;
  hasArt: boolean;
  playable: boolean;
  rulings: number;
}

export interface CardSearchPayload {
  ok: true;
  /** the query as asked, echoed so a caller can quote what it actually ran */
  query: string;
  /** every row that matched, BEFORE the limit */
  total: number;
  /** how many are in `cards` */
  returned: number;
  /** true when an implicit `class:card` narrowed the result */
  implicitCards: boolean;
  /** what the tolerant parser had to guess at, if anything */
  errors: { at: number; message: string }[];
  cards: CardSearchCard[];
}

const project = (r: CardRow): CardSearchCard => ({
  name: r.name,
  type: r.type,
  supertype: r.supertype,
  subtypes: r.subtypes,
  cost: r.cost,
  mana: r.mana,
  isX: r.isX,
  pow: r.power,
  tou: r.toughness,
  elements: r.factions,
  text: r.text,
  attrs: r.attrs,
  kind: r.kind,
  timing: r.timing,
  cls: r.cls,
  set: r.set,
  image: r.image,
  art: '/data/cards/' + r.image,
  hasArt: r.hasArt,
  playable: r.playable,
  rulings: r.rulings,
});

/** Clamp a caller's `limit` into something this endpoint will actually serve. */
export function clampLimit(raw: string | null): number {
  if (raw === null || raw.trim() === '') return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(n)));
}

/**
 * Run a query and shape the answer. Pure — no request, no response, no I/O
 * beyond the memoised card index — so a test can assert the payload without
 * spawning a server.
 */
export function cardSearchPayload(
  q: string,
  opts: { limit?: number; implicit?: boolean } = {},
): CardSearchPayload {
  const limit = Math.max(1, Math.min(MAX_LIMIT, opts.limit ?? DEFAULT_LIMIT));
  const result = search(q, { implicit: opts.implicit !== false });
  const cards = result.rows.slice(0, limit).map(project);
  return {
    ok: true,
    query: q,
    total: result.total,
    returned: cards.length,
    implicitCards: result.implicitCards,
    errors: result.query.errors.map(e => ({ at: e.at, message: e.message })),
    cards,
  };
}

/** Handle the card-search route. True when the request was ours. */
export function cardSearchRoutes(
  _req: IncomingMessage, res: ServerResponse, path: string, url: URL,
): boolean {
  if (path !== '/api/cardsearch') return false;
  const q = url.searchParams.get('q') ?? '';
  const limit = clampLimit(url.searchParams.get('limit'));
  // implicit=0 evaluates the query exactly as written, tokens and markers and
  // all. Anything else (absent included) keeps the browser's default.
  const implicit = url.searchParams.get('implicit') !== '0';
  json(res, cardSearchPayload(q, { limit, implicit }));
  return true;
}
