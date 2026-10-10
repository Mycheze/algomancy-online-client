/* THE RULES REVIEW PAGE'S COMMENTS: the journal, its fold, and what each
 * reader is shown. Transport is api-crreview.ts; the wire types are
 * ui/crtypes.ts.
 *
 * ── ONE APPEND-ONLY FILE, LAST WRITE WINS PER COMMENT ───────────────────
 *
 * `crCommentsFile()` (var/cr-comments.jsonl) holds one JSON row per thing
 * somebody did: an add, an edit, a resolve or reopen, a delete. Nothing is
 * ever rewritten, so changing your mind is a new line, the file can be
 * replayed, and a corrupt line is skipped rather than fatal — the
 * report-marks.jsonl pattern (admin.ts `marks()`).
 *
 * ⚠ THE FOLD RE-CHECKS WHO MAY DO WHAT. The route already refused anything
 * not allowed, but this file lives on a box and can be edited by hand, so an
 * edit, delete, resolve or reopen whose author is not the comment's author
 * (and that is not flagged `asAdmin`) is dropped here too. The rules are the
 * same in both places because both call `mayChange`.
 *
 * ⚠ ACCOUNT IDS NEVER LEAVE THE SERVER. A row carries the author's id (that is
 * how authorship is checked); `viewFor` drops it and sends the name, the trust
 * marks, and three booleans the server computed for THIS caller. The page
 * draws its buttons from those booleans and from nothing else.
 */
import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { CrAnchor, CrAuthor, CrComment, CrReview, CrTarget } from '../ui/crtypes.ts';
import type { ReportedBy } from './report-fields.ts';
import { crCommentsFile } from './statepaths.ts';

/** one line of the journal */
export interface CrRow {
  v: 1;
  op: 'add' | 'edit' | 'resolve' | 'reopen' | 'delete';
  id: string;
  at: string;
  /** a snapshot of the account when it acted (report-fields `reportedBy`) */
  by: ReportedBy;
  /** add only */
  target?: CrTarget;
  parent?: string | null;
  anchor?: CrAnchor | null;
  /** add and edit */
  body?: string;
  kind?: 'answer';
  reading?: string;
  /** an admin acting on somebody else's comment (moderation) */
  asAdmin?: true;
}

/** a comment after the fold — the server's own view, ids included */
export interface CrThreadItem {
  id: string;
  target: CrTarget;
  parent: string | null;
  anchor: CrAnchor | null;
  body: string;
  by: ReportedBy;
  at: string;
  editedAt?: string;
  resolved?: { by: string; at: string };
  deleted?: true;
  kind?: 'answer';
  reading?: string;
}

/** who is asking, as far as permissions go */
export interface CrCaller { id: string; admin: boolean }

/** May `caller` edit or delete `c`? Its author, or an admin. */
export function mayChange(c: CrThreadItem, caller: CrCaller | null): boolean {
  return !!caller && !c.deleted && (c.by.id === caller.id || caller.admin);
}

/** May `caller` resolve or reopen `c`? A root's own author, or an admin. */
export function mayResolve(c: CrThreadItem, caller: CrCaller | null): boolean {
  return c.parent === null && mayChange(c, caller);
}

/* ── the file ─────────────────────────────────────────────────────────── */

/** the journal's size in bytes: the comments' revision. 0 when absent */
export function journalRev(): number {
  try { return statSync(crCommentsFile()).size; } catch { return 0; }
}

let cached: { file: string; rev: number; mtime: number; rows: CrRow[] } | null = null;

/** every row, in file order; unparseable lines skipped */
export function readJournal(): CrRow[] {
  const file = crCommentsFile();
  let rev = 0, mtime = 0;
  try { const s = statSync(file); rev = s.size; mtime = s.mtimeMs; } catch { return []; }
  if (cached && cached.file === file && cached.rev === rev && cached.mtime === mtime) return cached.rows;
  const rows: CrRow[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as CrRow;
      if (r && typeof r === 'object' && typeof r.id === 'string' && typeof r.op === 'string' && r.by && typeof r.by.id === 'string') rows.push(r);
    } catch { /* a torn or hand-mangled line: skip it, never fail the page */ }
  }
  cached = { file, rev, mtime, rows };
  return rows;
}

export function appendRow(row: CrRow): void {
  const file = crCommentsFile();
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(row) + '\n');
}

export const newCommentId = (): string => `c_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;

/* ── the fold ─────────────────────────────────────────────────────────── */

/** Replay the journal into comments, in the order they were added. */
export function fold(rows: readonly CrRow[]): Map<string, CrThreadItem> {
  const out = new Map<string, CrThreadItem>();
  for (const r of rows) {
    const actor: CrCaller = { id: r.by.id, admin: r.asAdmin === true };
    if (r.op === 'add') {
      if (out.has(r.id) || typeof r.target !== 'string' || typeof r.body !== 'string') continue;
      const parent = typeof r.parent === 'string' ? r.parent : null;
      if (parent !== null) {
        const p = out.get(parent);
        // a reply hangs off a live ROOT on the same target; threads are one deep
        if (!p || p.parent !== null || p.deleted || p.target !== r.target) continue;
      }
      out.set(r.id, {
        id: r.id, target: r.target, parent, anchor: parent === null ? (r.anchor ?? null) : null,
        body: r.body, by: r.by, at: r.at,
        ...(r.kind === 'answer' && parent === null ? { kind: 'answer' as const, reading: String(r.reading ?? 'other') } : {}),
      });
      continue;
    }
    const c = out.get(r.id);
    if (!c) continue;
    if (r.op === 'edit') {
      if (typeof r.body !== 'string' || !mayChange(c, actor)) continue;
      c.body = r.body;
      c.editedAt = r.at;
    } else if (r.op === 'delete') {
      if (!mayChange(c, actor)) continue;
      c.deleted = true;
      c.body = '';
      delete c.kind; delete c.reading; delete c.resolved;
    } else if (r.op === 'resolve') {
      if (!mayResolve(c, actor)) continue;
      c.resolved = { by: r.by.name, at: r.at };
    } else if (r.op === 'reopen') {
      if (!mayResolve(c, actor)) continue;
      delete c.resolved;
    }
  }
  return out;
}

/* ── what a reader is sent ────────────────────────────────────────────── */

const author = (by: ReportedBy): CrAuthor => ({
  name: by.name, ...(by.owner ? { owner: true as const } : {}), ...(by.judge ? { judge: by.judge } : {}),
});

/** The comments as `caller` sees them: no account ids; the three booleans
 * are this server's answer for this caller. `caller` null = signed out or a
 * guest, who may read and nothing else. */
export function viewFor(items: Map<string, CrThreadItem>, caller: CrCaller | null): CrComment[] {
  return [...items.values()].map(c => ({
    id: c.id, target: c.target, parent: c.parent, anchor: c.anchor, body: c.body,
    by: author(c.by), at: c.at,
    ...(c.editedAt ? { editedAt: c.editedAt } : {}),
    ...(c.resolved ? { resolved: c.resolved } : {}),
    ...(c.deleted ? { deleted: true as const } : {}),
    ...(c.kind ? { kind: c.kind, reading: c.reading ?? 'other' } : {}),
    mine: !!caller && c.by.id === caller.id,
    canEdit: mayChange(c, caller),
    canResolve: mayResolve(c, caller),
  }));
}

/* ── the comments as one markdown file (the download the next CR round reads) ── */

/** A body as a fenced block, the fence longer than any backtick run inside
 * it: whatever a commenter typed, it cannot forge a heading or an answer in
 * the file the next round of rules work reads. */
function fenced(text: string, info = 'text'): string {
  const run = Math.max(0, ...[...text.matchAll(/`+/g)].map(m => m[0].length));
  const fence = '`'.repeat(Math.max(3, run + 1));
  return `${fence}${info}\n${text}\n${fence}`;
}

const label = (by: ReportedBy): string => {
  const marks = [by.owner ? 'owner' : '', by.judge ? `judge L${by.judge}` : ''].filter(Boolean);
  return marks.length ? `${by.name} (${marks.join(', ')})` : by.name;
};

/** where a target sits now: its live key after a rename, its number, and
 * whether it is still in the document */
function placeOf(review: CrReview, target: string): { target: string; num: string | null; live: boolean; removed: boolean } {
  if (target.startsWith('rule:')) {
    const old = target.slice(5);
    const key = review.aliases[old] ?? old;
    const t = `rule:${key}`;
    return { target: t, num: review.keys[key] ?? null, live: review.targets.includes(t as CrTarget), removed: key in review.removed };
  }
  return { target, num: target.startsWith('sec:') ? target.slice(4) : null, live: review.targets.includes(target as CrTarget), removed: false };
}

/**
 * Every thread, in document order: the owner's answers first, then each
 * target's threads where the target sits in the document, then the ones whose
 * target has gone. Deleted comments are left out (a deleted root with live
 * replies stays, marked deleted, so the replies keep their context).
 */
export function commentsMarkdown(review: CrReview, items: Map<string, CrThreadItem>): string {
  const all = [...items.values()];
  const roots = all.filter(c => c.parent === null);
  const replies = (id: string): CrThreadItem[] => all.filter(c => c.parent === id && !c.deleted);
  const order = new Map(review.targets.map((t, i) => [t as string, i]));
  const rank = (c: CrThreadItem): number => order.get(placeOf(review, c.target).target) ?? Number.MAX_SAFE_INTEGER;
  const shown = roots.filter(c => !c.deleted || replies(c.id).length > 0)
    .sort((a, b) => rank(a) - rank(b) || a.at.localeCompare(b.at));

  const thread = (c: CrThreadItem): string[] => {
    const p = placeOf(review, c.target);
    const where = [p.num ? `**${p.num}**` : '', `\`${p.target}\``, p.removed ? '(rule removed)' : '', !p.live && !p.removed ? '(no longer in the document)' : '']
      .filter(Boolean).join(' ');
    const status = c.deleted ? 'deleted' : c.resolved ? `resolved by ${c.resolved.by} ${c.resolved.at}` : 'open';
    const out = [`### ${where}`, '', `- id: \`${c.id}\` · ${status}`, `- by ${label(c.by)}, ${c.at}${c.editedAt ? ` (edited ${c.editedAt})` : ''}`];
    if (c.kind === 'answer') out.push(`- **answer: reading ${c.reading ?? 'other'}**`);
    if (c.anchor) out.push(`- on: ${c.anchor.num ? `${c.anchor.num}, ` : ''}${c.anchor.edition}`, '', fenced(c.anchor.quote, 'quote'));
    out.push('', c.deleted ? '_(deleted)_' : fenced(c.body));
    for (const r of replies(c.id)) {
      out.push('', `#### reply by ${label(r.by)}, ${r.at}${r.editedAt ? ` (edited ${r.editedAt})` : ''}`, '', fenced(r.body));
    }
    out.push('');
    return out;
  };

  const answers = shown.filter(c => c.kind === 'answer' && !c.deleted);
  const live = shown.filter(c => c.kind !== 'answer' && placeOf(review, c.target).live);
  const gone = shown.filter(c => c.kind !== 'answer' && !placeOf(review, c.target).live);
  const lines = [
    `# ${review.title}: review comments`, '',
    `${review.edition.name} · ${shown.length} thread${shown.length === 1 ? '' : 's'} (${shown.filter(c => !c.resolved && !c.deleted).length} open)`, '',
  ];
  if (answers.length) lines.push('## Answers to the owner questions', '', ...answers.flatMap(thread));
  lines.push('## Comments, in document order', '', ...(live.length ? live.flatMap(thread) : ['_none_', '']));
  if (gone.length) lines.push('## No longer in the document', '', ...gone.flatMap(thread));
  return lines.join('\n');
}
