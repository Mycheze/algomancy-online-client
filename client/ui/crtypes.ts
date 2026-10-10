/* THE RULES REVIEW PAGE: THE CONTRACT BETWEEN ITS THREE HALVES. Types only.
 *
 *   engine/scripts/cr/render.mjs  buildReview()  → CrReview      (in-process)
 *   server/api-crreview.ts        GET /api/cr/*  → CrReviewDoc, CrCommentsReply, downloads
 *   ui/crreview.ts                the page: paints CrReviewDoc, decorates it with CrComment
 *
 * Nothing here is a file on disk. The review data is NOT committed: the game
 * server calls `buildReview()` on the committed records, the same code paths
 * that write the .md/.html/.txt editions, and caches the result by the mtimes
 * of `CrReview.inputs`. So the page and the published document cannot say two
 * different things.
 *
 * The server imports this module the way it imports ./customrules.ts. It must
 * stay free of any runtime code, so either side can import it with
 * `import type` and nothing else.
 */

/* ── what a comment can point at ──────────────────────────────────────────── */

/**
 * A commentable item in the document. Every item the page can comment on
 * carries `data-crt="<target>"` on its root element in the part HTML, and
 * `CrReviewDoc.targets` lists every one of them.
 *
 * A rule is addressed by its permanent KEY, never its number: keys survive
 * renumbering, and a renamed key is followed through `aliases`.
 */
export type CrTarget =
  | 'front' | 'annexP' | 'changelog'
  | `sec:${string}`        // a section heading: `sec:608`, `sec:D3`
  | `rule:${string}`       // a rule (or a tombstone): `rule:combat.damage.split.unsplit`
  | `gloss:${string}`      // a glossary row, by its record key
  | `disc:${string}`       // a discrepancy item: `disc:D-U12-1`
  | `finding:${string}`;   // an Annex P finding: `finding:F-U12-3`

/* ── the document, as the page receives it (GET /api/cr/review) ───────────── */

export interface CrEdition { name: string; effective: string; engineCommit: string }

/** one entry in the contents rail. `id` is a chapter (`ch1`…`ch9`, `chD` for
 * Annex D) or a part id for the parts that are not in a chapter */
export interface CrTocEntry {
  id: string;
  title: string;
  /** a chapter's sections, in document order; absent for a single-part entry */
  sections?: { num: string; title: string; part: string }[];
}

export type CrPartKind = 'front' | 'section' | 'annexP' | 'glossary' | 'changelog';

/**
 * One paintable piece of the document: a section (`s608`, `sD3`), or one of
 * `front`, `annexP`, `glossary`, `changelog`. `html` is the renderer's own
 * fragment, with `data-crt` added to each commentable item and nothing else
 * changed. It is trusted only because the renderer escapes every record
 * string; the page injects it as-is and never splices comment text into it.
 */
export interface CrPart {
  id: string;
  kind: CrPartKind;
  /** a section's number: `608`, `D3` */
  num?: string;
  /** a section's chapter: `6`, `D` */
  chapter?: string;
  title: string;
  html: string;
}

/** a discrepancy item, for the Discrepancies and Owner questions tabs */
export interface CrDiscItem {
  id: string;
  tier: 1 | 2 | 3 | 4;
  /** the live rule number it is filed against, or the raw ref if none resolves */
  rule: string;
  html: string;
}

/** the Owner questions tab: the first tier, grouped and ordered exactly as
 * owner-questions.md is */
export interface CrOwnerTopic {
  topic: string;
  items: {
    /** the discrepancy id; its comment target is `disc:<id>` */
    id: string;
    /** the number owner-questions.md prints (1-based, across topics) */
    n: number;
    /** the reading labels, in order (`A`, `B`, …): the one-click answer
     * buttons, plus an "Other" that carries a written answer */
    readings: string[];
  }[];
}

/** GET /api/cr/review */
export interface CrReviewDoc {
  v: 1;
  title: string;
  subtitle: string;
  edition: CrEdition;
  toc: CrTocEntry[];
  parts: CrPart[];
  disc: CrDiscItem[];
  ownerQuestions: CrOwnerTopic[];
  /** every `data-crt` value across `parts` and `disc`, exactly once each */
  targets: CrTarget[];
  /** every ledger entry, live and tombstoned: rule key → its number */
  keys: Record<string, string>;
  /** the tombstones: rule key → its number */
  removed: Record<string, string>;
  /** renamed keys: old key → new key (the ledger aliases) */
  aliases: Record<string, string>;
}

/* ── what buildReview() returns: the wire document plus the server's half ─── */

/** a part with the text the downloads need. Kept on the server: the page
 * never receives `md` or `txt` */
export interface CrPartFull extends CrPart {
  /** exactly the bytes this part contributes to the .md edition */
  md: string;
  /** the part as the .txt edition prints it */
  txt: string;
}

/** the whole-document downloads, by the name the download route takes */
export type CrWholeFile = 'doc' | 'html' | 'txt' | 'annexD' | 'disc' | 'oq' | 'changelog';

/**
 * `buildReview()` in engine/scripts/cr/render.mjs. Pure apart from reading the
 * committed inputs. The server sends the `CrReviewDoc` part of it (each part
 * without `md` and `txt`) to the page, and serves the rest as downloads.
 */
export interface CrReview extends Omit<CrReviewDoc, 'parts'> {
  parts: CrPartFull[];
  /** the renderer's standalone HTML page with `{{TITLE}}` and `{{BODY}}` left
   * to fill: a section or chapter downloaded as .html is this, filled */
  shell: string;
  /** the whole-document editions, byte for byte what `cr:render` writes */
  files: Record<CrWholeFile, { name: string; text: string }>;
  /** how many rule numbers this build had to allocate that the committed
   * ledger does not hold. Not 0 means the committed document is stale
   * (`npm --prefix client run cr:render`); the page still works */
  born: number;
  /** absolute paths of every file the build read: the server caches the
   * result until one of their mtimes changes */
  inputs: string[];
}

/* ── comments ─────────────────────────────────────────────────────────────── */

/**
 * Where in its target a comment points (the TextQuote + TextPosition model).
 * Offsets and text are measured in the target's normalised text: its
 * `textContent` with every whitespace run collapsed to one space, trimmed.
 * Null on a reply and on a whole-item comment.
 */
export interface CrAnchor {
  /** the selected text, 1–500 chars */
  quote: string;
  /** up to 64 chars before and after it, to tell repeats apart */
  prefix: string;
  suffix: string;
  /** where the quote started, a tiebreak only */
  start: number;
  /** the edition it was made against (`CrEdition.name`), ≤ 80 chars */
  edition: string;
  /** the rule's number when it was made, for the comments export and for an
   * orphan whose target has gone */
  num?: string;
}

/** an author as everyone sees it: a name and the trust marks, never an id */
export interface CrAuthor { name: string; owner?: true; judge?: 1 | 2 | 3 }

/**
 * One comment as the page receives it. Account ids never leave the server;
 * `mine`, `canEdit` and `canResolve` are the server's answers for the caller,
 * and the page draws buttons from them and from nothing else.
 */
export interface CrComment {
  id: string;
  target: CrTarget;
  /** the root this replies to; threads are one level deep */
  parent: string | null;
  anchor: CrAnchor | null;
  /** plain text, rendered escaped; '' once deleted */
  body: string;
  by: CrAuthor;
  at: string;
  editedAt?: string;
  /** roots only */
  resolved?: { by: string; at: string };
  deleted?: true;
  /** an admin's answer to an owner question (target `disc:<id>`): the
   * reading label it chose, or 'other' with the answer in `body` */
  kind?: 'answer';
  reading?: string;
  mine: boolean;
  canEdit: boolean;
  canResolve: boolean;
}

/** who the server thinks is reading. Any named account may comment; a guest
 * or a signed-out reader may not. `admin` draws the answer buttons and the
 * raw export link — the server checks again on every request */
export interface CrYou {
  name: string | null;
  canComment: boolean;
  why?: 'signed-out' | 'guest';
  admin?: true;
}

/** POST /api/cr/comment, the request body */
export type CrOp =
  | { op: 'add'; target: CrTarget; parent?: string | null; anchor?: CrAnchor | null; body: string;
      kind?: 'answer'; reading?: string }
  | { op: 'edit'; id: string; body: string }
  | { op: 'resolve' | 'reopen' | 'delete'; id: string };

/** GET /api/cr/comments[?rev=N]. `rev` is the journal's size: the same rev
 * means nothing changed, and the reply says only that */
export type CrCommentsReply =
  | { ok: true; rev: number; you: CrYou; comments: CrComment[] }
  | { ok: true; rev: number; unchanged: true }
  | { ok: false; error: string };

/** POST /api/cr/comment, the reply */
export type CrOpReply =
  | { ok: true; rev: number; comment: CrComment }
  | { ok: false; error: string };

/* ── downloads (GET /api/cr/download?part=P&fmt=F), served as attachments ─── */

/** `all`, the separate files, a chapter (`ch:6`, `ch:D`), a section
 * (`sec:608`, `sec:D3`), or the comments */
export type CrDownloadPart =
  | 'all' | 'annexD' | 'disc' | 'oq' | 'changelog' | 'comments'
  | `ch:${string}` | `sec:${string}`;

/** `jsonl` is the raw comments journal, admins only */
export type CrDownloadFormat = 'md' | 'txt' | 'html' | 'jsonl';
