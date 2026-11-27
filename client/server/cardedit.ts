/* THE CARD EDITOR'S REQUESTS: the store, and the status read off it.
 *
 * One edit is three writers' worth of files under cardEditsDir(), and no file
 * has two writers (client/docs/card-editor.md §3):
 *
 *   <id>.json            this server: the request, the commands, what the bot saw
 *   <id>/before.jpg      this server: FriendlyBot's card before the edit
 *   <id>/after.jpg       this server: FriendlyBot's newest render of it
 *   <id>.runner.jsonl    the home box's runner, over ssh (cardedit-runner-row.ts)
 *   index.json           the edits ready for the runner, rebuilt from the files
 *
 * Nothing is cached but the oracle and the live list, which are the running
 * build's and cannot change under this process. Every request re-reads the
 * edit from disk, so the runner's rows and this server's writes never race.
 * The status is a pure function of the edit, the runner's rows and the build.
 */
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { ORACLE_JSON } from '../engine/scripts/paths.mjs';
import {
  EDITOR_FIELDS, attachmentFileKey, changedFields, commandsFor, diffRow, editorFieldOf, editorFields,
  friendlyBotFileKey, oracleValues, parseCommand, road, validateEdit, valueFromCommand,
  type DiffEntry, type EditorField, type EditorFields, type OracleRow, type OracleValues, type Road,
} from '../ui/cardnotation.ts';
import type { Account } from './accounts.ts';
import { repoDir } from './engine-version.ts';
import { cardEditsDir } from './statepaths.ts';

/* -- the record ------------------------------------------------------------ */

/** A command as our bot saw it posted: the content is what FriendlyBot applied. */
export interface Posted { messageId: string; channelId: string; content: string; at: string }
/** FriendlyBot's answer to a command: its pictures (stored beside the record), or why there were none. */
export interface Reply { at: string; echo?: string; fileName?: string; error?: string; noAnswer?: true }

export interface EditCommand { text: string; field: EditorField; posted: Posted | null; reply: Reply | null }
export interface EditEvent { at: string; what: string; [detail: string]: unknown }

export interface CardEdit {
  v: 1;
  id: string;
  card: string;
  by: { account: string; name: string; discord: string };
  createdAt: string;
  base: { rowHash: string; row: OracleRow };
  /** his fields as he submitted them, only the changed ones */
  edit: EditorFields;
  /** the change in our row's notation, re-derived from what was posted */
  after: OracleValues;
  diff: DiffEntry[];
  road: Road;
  why: string[];
  commands: EditCommand[];
  events: EditEvent[];
}

export const RUNNER_STEPS = ['picked', 'gate-red', 'landed', 'deployed', 'to-steward', 'followup'] as const;
export type RunnerStep = typeof RUNNER_STEPS[number];
export interface RunnerRow { at: string; step: RunnerStep; why?: string }

/** Runner steps after which the home box is done with an edit. */
const RUNNER_DONE: ReadonlySet<string> = new Set(['landed', 'deployed', 'to-steward']);

/* -- ids and hashes -------------------------------------------------------- */

const EDIT_ID = /^ce-\d{8}-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{4}$/;

/** An edit id: only [a-z0-9-], so it is safe as a file name and on an ssh command line. */
export function isEditId(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 64 && EDIT_ID.test(s);
}

export function cardSlug(card: string): string {
  const slug = card.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40).replace(/^-+|-+$/g, '');
  return slug || 'card';
}

/** `ce-YYYYMMDD-<card slug>-<4 hex>`, dated in UTC. */
export function newEditId(card: string, now = new Date(), hex = randomBytes(2).toString('hex')): string {
  return `ce-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${cardSlug(card)}-${hex}`;
}

/** JSON with every object's keys sorted, so equal rows hash equal whatever order they were read in. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter(k => o[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export const rowHash = (row: unknown): string => createHash('sha1').update(canonicalJson(row)).digest('hex');

/* -- the running build: its oracle and its Card-Edit trailers --------------- */

let oracle: Record<string, OracleRow[]> | null = null;

/** The running build's raw oracle row for a card (exact name, then any case), read once per process. */
export function oracleRow(card: string): OracleRow | undefined {
  oracle ??= JSON.parse(readFileSync(ORACLE_JSON, 'utf8')) as Record<string, OracleRow[]>;
  const exact = oracle[card]?.[0];
  if (exact) return exact;
  const lower = card.toLowerCase();
  const key = Object.keys(oracle).find(k => k.toLowerCase() === lower);
  return key ? oracle[key]?.[0] : undefined;
}

/** Testing seam: stand in an oracle (null goes back to the file). */
export function useOracle(o: Record<string, OracleRow[]> | null): void { oracle = o; }

let live: ReadonlySet<string> | null = null;

/** The edit ids this build's history carries as `Card-Edit:` trailers. Read once per process
 * (about 30 ms on this repo): the code is loaded, so the answer cannot change under it. */
export function liveEditIds(): ReadonlySet<string> {
  if (live) return live;
  try {
    const out = execFileSync('git', ['-C', repoDir(), 'log', '--format=%(trailers:key=Card-Edit,valueonly)', 'HEAD'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
    });
    live = new Set(out.split('\n').map(s => s.trim()).filter(isEditId));
  } catch {
    live = new Set();
  }
  return live;
}

/** Testing seam: stand in the build's trailers (null reads git again). */
export function useLiveEditIds(ids: Iterable<string> | null): void { live = ids ? new Set(ids) : null; }

/* -- the status ------------------------------------------------------------ */

export type EditStatus = 'submitted' | 'waiting' | 'applying' | 'steward' | 'live' | 'cancelled';
export interface StatusNote { status: EditStatus; note?: string }

export const NO_ANSWER_NOTE = "FriendlyBot hasn't answered: is it running? Post the command again.";

/** FriendlyBot answers `$simple`/`$complex` with one line of text and no picture. */
export const drawsPicture = (c: Pick<EditCommand, 'field'>): boolean => c.field !== 'complexity';

/** Posted and answered: with pictures, or for a complexity command with its one line. */
export const isAnswered = (c: EditCommand): boolean =>
  c.posted !== null && c.reply !== null && (c.reply.fileName !== undefined || (!drawsPicture(c) && c.reply.echo !== undefined));

/** Every command posted and answered: the edit is ready for the home box. */
export const allAnswered = (e: CardEdit): boolean => e.commands.length > 0 && e.commands.every(isAnswered);

export const POSTED_LATE = 'posted after the change was picked up: make a new edit';

const isCancelled = (e: CardEdit): boolean => e.events.some(ev => ev.what === 'cancelled');

/** Where an edit stands (card-editor.md §7), with a short note for the player when one helps. */
export function statusOf(
  edit: CardEdit, rows: readonly RunnerRow[], liveIds: ReadonlySet<string> | readonly string[],
): StatusNote {
  const isLive = liveIds instanceof Set ? liveIds.has(edit.id) : (liveIds as readonly string[]).includes(edit.id);
  // a command posted after the runner took the edit changed FriendlyBot's card, not ours
  const late = edit.events.some(ev => ev.what === 'posted-late') ? { note: POSTED_LATE } : {};
  if (isLive) return { status: 'live', ...late };
  if (isCancelled(edit)) return { status: 'cancelled' };
  if (!edit.commands.some(c => c.posted)) return { status: 'submitted' };
  if (!allAnswered(edit)) {
    const last = [...edit.events].reverse()
      .find(ev => ['posted', 'reply', 'no-answer', 'reply-error', 'wrong-card'].includes(ev.what));
    if (last?.what === 'wrong-card') {
      return { status: 'waiting', note: `FriendlyBot changed a different card: ${String(last['file']).replace(/_/g, ' ')}` };
    }
    if (last?.what === 'no-answer') return { status: 'waiting', note: NO_ANSWER_NOTE };
    if (last?.what === 'reply-error') {
      return { status: 'waiting', note: `FriendlyBot said "${String(last['error'])}": post the command again.` };
    }
    return { status: 'waiting' };
  }
  const handed = [...rows].reverse().find(r => r.step === 'to-steward');
  if (handed) return { status: 'steward', note: `queued for the steward: ${handed.why || 'the tests went red'}`, ...late };
  if (edit.road === 'steward') return { status: 'steward', note: `queued for the steward: ${edit.why.join('; ')}`, ...late };
  const steps = new Set(rows.map(r => r.step));
  if (steps.has('landed') || steps.has('deployed')) return { status: 'applying', note: 'passed the tests: live with the next deploy', ...late };
  if (steps.has('picked') || steps.has('gate-red')) return { status: 'applying', note: 'testing', ...late };
  return { status: 'applying', note: 'waiting for the home box' };
}

/** Still the card's edit in progress: a second edit to the card waits for it (§3). */
export const isOpen = (s: EditStatus): boolean => s === 'submitted' || s === 'waiting' || s === 'applying';

/* -- the store --------------------------------------------------------------- */

const editFile = (id: string): string => join(cardEditsDir(), `${id}.json`);
const runnerFile = (id: string): string => join(cardEditsDir(), `${id}.runner.jsonl`);
export const indexFile = (): string => join(cardEditsDir(), 'index.json');
export type Picture = 'before' | 'after';
export const picturePath = (id: string, which: Picture): string => join(cardEditsDir(), id, `${which}.jpg`);

/** temp + rename, the temp named for this process so the runner's script and the server never share one */
function writeAtomic(file: string, data: string | Buffer): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

export function readEdit(id: string): CardEdit | undefined {
  if (!isEditId(id)) return undefined;
  try { return JSON.parse(readFileSync(editFile(id), 'utf8')) as CardEdit; } catch { return undefined; }
}

/** Every edit on disk, oldest first. */
export function allEdits(): CardEdit[] {
  let names: string[];
  try { names = readdirSync(cardEditsDir()); } catch { return []; }
  return names.map(n => /^(ce-[a-z0-9-]+)\.json$/.exec(n)?.[1]).filter(isEditId)
    .map(readEdit).filter((e): e is CardEdit => e !== undefined)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** The runner's rows for an edit; a torn or unknown line is skipped, never fatal. */
export function runnerRows(id: string): RunnerRow[] {
  let text: string;
  try { text = readFileSync(runnerFile(id), 'utf8'); } catch { return []; }
  const rows: RunnerRow[] = [];
  for (const line of text.split('\n')) {
    try {
      const r = JSON.parse(line) as RunnerRow;
      if (r && (RUNNER_STEPS as readonly string[]).includes(r.step)) rows.push(r);
    } catch { /* a torn last line */ }
  }
  return rows;
}

export function writeEdit(edit: CardEdit): void {
  mkdirSync(cardEditsDir(), { recursive: true });
  writeAtomic(editFile(edit.id), JSON.stringify(edit, null, 1) + '\n');
  rewriteIndex();
}

export function statusNow(edit: CardEdit): StatusNote {
  return statusOf(edit, runnerRows(edit.id), liveEditIds());
}

/** `pictures`: FriendlyBot's before.jpg and after.jpg are stored. False only for an edit whose
 * every command is a complexity command, which FriendlyBot answers without a picture. */
export interface IndexEntry { id: string; card: string; road: Road; pictures: boolean }
export interface CardEditIndex { v: 1; edits: IndexEntry[] }

/** The edits the runner may take, oldest first: every command answered, not cancelled, and not yet
 * landed or handed to the steward. Built from the files alone, so either writer may rebuild it. */
export function indexEntries(): IndexEntry[] {
  return allEdits()
    .filter(e => !isCancelled(e) && allAnswered(e) && !runnerRows(e.id).some(r => RUNNER_DONE.has(r.step)))
    .map(e => ({ id: e.id, card: e.card, road: e.road, pictures: hasPictures(e) }));
}

/** Both of FriendlyBot's pictures are stored for this edit. */
export const hasPictures = (e: CardEdit): boolean =>
  (['before', 'after'] as const).every(w => e.events.some(ev => ev.what === 'picture' && ev['which'] === w));

export function rewriteIndex(): void {
  mkdirSync(cardEditsDir(), { recursive: true });
  const text = JSON.stringify({ v: 1, edits: indexEntries() } satisfies CardEditIndex) + '\n';
  let old = '';
  try { old = readFileSync(indexFile(), 'utf8'); } catch { /* first write */ }
  if (old !== text) writeAtomic(indexFile(), text);
}

/** The runner's report: one row appended, then the index rebuilt. */
export function appendRunnerRow(id: string, step: RunnerStep, why?: string, now = new Date()): RunnerRow {
  const row: RunnerRow = { at: now.toISOString(), step, ...(why ? { why } : {}) };
  appendFileSync(runnerFile(id), JSON.stringify(row) + '\n');
  rewriteIndex();
  return row;
}

/* -- submit ---------------------------------------------------------------- */

export type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const refuse = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

export const LINK_FIRST = 'Link your Discord account first: press Link Discord on your profile, then type the /link command it gives you in Discord.';

/** The on-screen fields a request body may carry: known names, string values. */
export function screenFields(raw: unknown): EditorFields {
  const out: EditorFields = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const f of EDITOR_FIELDS) {
    const v = (raw as Record<string, unknown>)[f];
    if (typeof v === 'string') out[f] = v.slice(0, 4000);
  }
  return out;
}

/** The edit's open sibling on the same card, if any. */
export function openEditFor(card: string): CardEdit | undefined {
  return allEdits().find(e => e.card === card && isOpen(statusNow(e).status));
}

export function submitEdit(
  me: Account, body: { card?: unknown; rowHash?: unknown; fields?: unknown }, now = new Date(),
): Outcome<CardEdit> {
  const row = typeof body.card === 'string' ? oracleRow(body.card) : undefined;
  if (!row) return refuse(404, 'No such card.');
  const card = row.name;
  if (body.rowHash !== rowHash(row)) return refuse(409, `${card} has changed since you opened it. Reload it and edit again.`);
  const discord = me.linked?.discord?.id;
  if (!discord) return refuse(400, LINK_FIRST);
  const screen = screenFields(body.fields);
  const problems = validateEdit(row, screen);
  if (problems.length) return refuse(400, problems.join(' '));
  const edit = changedFields(row, screen);
  const after = oracleValues(edit);
  const diff = diffRow(row, after);
  if (!diff.length) return refuse(400, 'Nothing changed.');
  if (openEditFor(card)) return refuse(409, `${card} has an edit in progress.`);
  let id = newEditId(card, now);
  while (existsSync(editFile(id))) id = newEditId(card, now);
  const r = road(diff);
  const record: CardEdit = {
    v: 1, id, card,
    by: { account: me.id, name: me.username, discord },
    createdAt: now.toISOString(),
    base: { rowHash: rowHash(row), row },
    edit, after, diff, road: r.road, why: r.why,
    commands: commandsFor(card, edit).map(c => ({ text: c.text, field: c.field, posted: null, reply: null })),
    events: [{ at: now.toISOString(), what: 'submitted' }],
  };
  writeEdit(record);
  return { ok: true, value: record };
}

export function cancelEdit(edit: CardEdit, now = new Date()): Outcome<CardEdit> {
  const s = statusNow(edit).status;
  if (s === 'cancelled') return { ok: true, value: edit };
  if (s !== 'submitted') return refuse(409, 'A command has been posted, so this edit can no longer be cancelled.');
  edit.events.push({ at: now.toISOString(), what: 'cancelled' });
  writeEdit(edit);
  return { ok: true, value: edit };
}

/* -- what the bot reports -------------------------------------------------- */

/** after, diff, road and why from the submitted fields, overridden by every command as posted. */
export function rederive(edit: CardEdit): void {
  const after: OracleValues = oracleValues(edit.edit);
  for (const c of edit.commands) {
    const p = c.posted && parseCommand(c.posted.content);
    const v = p && valueFromCommand(p.field, p.value);
    if (v) after[v.field] = v.value;
  }
  edit.after = after;
  edit.diff = diffRow(edit.base.row, after);
  const r = road(edit.diff);
  edit.road = r.road;
  edit.why = r.why;
}

/** What the bot polls: every edit the home box has not taken yet, answered or not, because
 * Caleb may re-post a command with a new value after FriendlyBot answered it. */
export function pendingEdits(): CardEdit[] {
  const liveIds = liveEditIds();
  return allEdits().filter(e => !isCancelled(e) && !liveIds.has(e.id) && runnerRows(e.id).length === 0);
}

const commandAt = (edit: CardEdit, i: unknown): EditCommand | undefined =>
  Number.isInteger(i) ? edit.commands[i as number] : undefined;

/** Is ISO time `a` before `b`? Parsed, because the bot's and a test's spellings differ. */
const earlier = (a: string, b: string): boolean => Date.parse(a) < Date.parse(b);
/** Does the body carry the message's own Discord time? Only then can it be ordered against another. */
const stamped = (b: { at?: unknown }): boolean => typeof b.at === 'string';

export interface SeenBody { i?: unknown; messageId?: unknown; channelId?: unknown; content?: unknown; at?: unknown }

/** A command seen posted. The posted value is what FriendlyBot applied, so the road can change. */
export function recordSeen(edit: CardEdit, b: SeenBody, now = new Date()): Outcome<CardEdit> {
  const c = commandAt(edit, b.i);
  if (!c) return refuse(400, 'no such command');
  if (typeof b.content !== 'string' || typeof b.messageId !== 'string' || typeof b.channelId !== 'string') {
    return refuse(400, 'messageId, channelId and content are required');
  }
  const s = statusNow(edit).status;
  if (s === 'live' || s === 'cancelled') return refuse(409, `the edit is ${s}`);
  const parsed = parseCommand(b.content);
  const field = parsed && (parsed.verb === 'modify' ? editorFieldOf(parsed.field) : 'complexity');
  if (field !== c.field) return refuse(409, `that message does not set ${c.field}`);
  const at = typeof b.at === 'string' ? b.at : now.toISOString();
  const before = c.posted;
  // the bot replays its channel after a restart: the posting held, or an earlier one, changes nothing
  if (before && (before.messageId === b.messageId ? before.content === b.content : stamped(b) && earlier(at, before.at))) {
    return { ok: true, value: edit };
  }
  if (runnerRows(edit.id).length) {
    // the home box is applying the value posted before: the same value again changes nothing,
    // and a new one is only remembered, because it reached FriendlyBot's card and not ours
    if (before?.content === b.content) return { ok: true, value: edit };
    if (!edit.events.some(ev => ev.what === 'posted-late' && ev['messageId'] === b.messageId)) {
      edit.events.push({ at: now.toISOString(), what: 'posted-late', i: b.i, messageId: b.messageId, content: b.content.slice(0, 2500) });
      writeEdit(edit);
    }
    return refuse(409, POSTED_LATE);
  }
  // a re-post of the same value keeps FriendlyBot's earlier answer; a new value, or a retry after a failure, waits for a new one
  if (c.reply && (before?.content !== b.content || !isAnswered(c))) c.reply = null;
  c.posted = { messageId: b.messageId, channelId: b.channelId, content: b.content, at };
  if (before?.messageId !== b.messageId || before.content !== b.content) {
    edit.events.push({ at: now.toISOString(), what: 'posted', i: b.i, messageId: b.messageId });
  }
  const was = edit.road;
  rederive(edit);
  if (edit.road !== was) edit.events.push({ at: now.toISOString(), what: 'reclassified', from: was, to: edit.road });
  writeEdit(edit);
  return { ok: true, value: edit };
}

export interface ReplyBody {
  i?: unknown; at?: unknown; echo?: unknown; fileName?: unknown; before?: unknown; after?: unknown;
  error?: unknown; noAnswer?: unknown;
}

/** One picture's base64, or null when it is not a JPEG of a sane size. */
function jpeg(b64: unknown): Buffer | null {
  if (typeof b64 !== 'string') return null;
  const buf = Buffer.from(b64, 'base64');
  return buf.length > 3 && buf.length <= PICTURE_BYTES && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff ? buf : null;
}

/** one picture's cap; a FriendlyBot render is about 200 KB */
export const PICTURE_BYTES = 1.5 * 1024 * 1024;
/** the reply route's body cap: two pictures in base64 and the rest */
export const REPLY_BODY_BYTES = 4 * 1024 * 1024;

/** when the answers behind the stored picture were given */
const pictureAts = (edit: CardEdit, which: Picture): string[] =>
  edit.events.filter(ev => ev.what === 'picture' && ev['which'] === which).map(ev => String(ev['replyAt']));

/** FriendlyBot's answer to a posted command. Refused unless its picture names the edit's card:
 * a loose name match can land on another card, and this is the one place that shows it. */
export function recordReply(edit: CardEdit, b: ReplyBody, now = new Date()): Outcome<CardEdit> {
  const c = commandAt(edit, b.i);
  if (!c) return refuse(400, 'no such command');
  if (!c.posted) return refuse(409, 'that command has not been seen posted');
  const at = typeof b.at === 'string' ? b.at : now.toISOString();
  const stamp = now.toISOString();
  if (b.noAnswer === true || typeof b.error === 'string') {
    // a later failure never undoes an answer already caught: the card did change
    if (!isAnswered(c)) {
      c.reply = b.noAnswer === true ? { at, noAnswer: true } : { at, error: String(b.error).slice(0, 500) };
      edit.events.push(b.noAnswer === true
        ? { at: stamp, what: 'no-answer', i: b.i }
        : { at: stamp, what: 'reply-error', i: b.i, error: c.reply.error });
      writeEdit(edit);
    }
    return { ok: true, value: edit };
  }
  // a replay: the answer held, or one older than it or than the posting it would answer, changes nothing
  if (stamped(b) && ((isAnswered(c) && !earlier(c.reply!.at, at)) || earlier(at, c.posted.at))) return { ok: true, value: edit };
  if (!drawsPicture(c) && typeof b.fileName !== 'string') return complexityAnswer(edit, c, b, at, stamp);
  if (typeof b.fileName !== 'string') return refuse(400, 'fileName is required');
  const key = attachmentFileKey(b.fileName);
  if (key !== friendlyBotFileKey(edit.card)) {
    if (!edit.events.some(ev => ev.what === 'wrong-card' && ev['i'] === b.i && ev['replyAt'] === at)) {
      edit.events.push({ at: stamp, what: 'wrong-card', i: b.i, file: key ?? b.fileName.slice(0, 200), replyAt: at });
      writeEdit(edit);
    }
    return refuse(409, `FriendlyBot changed a different card: ${(key ?? b.fileName).replace(/_/g, ' ')}`);
  }
  const before = jpeg(b.before);
  const after = jpeg(b.after);
  if (!before || !after) return refuse(400, 'before and after must be JPEG pictures, base64');
  mkdirSync(join(cardEditsDir(), edit.id), { recursive: true });
  // before: FriendlyBot's card before the edit, so the earliest answer to the first command that draws one
  if (b.i === edit.commands.findIndex(drawsPicture) && pictureAts(edit, 'before').every(t => at < t)) {
    writeAtomic(picturePath(edit.id, 'before'), before);
    edit.events.push({ at: stamp, what: 'picture', which: 'before', replyAt: at });
  }
  // after: each render carries every change so far, so the newest answer to any command
  if (pictureAts(edit, 'after').every(t => at >= t)) {
    writeAtomic(picturePath(edit.id, 'after'), after);
    edit.events.push({ at: stamp, what: 'picture', which: 'after', replyAt: at });
  }
  c.reply = { at, ...(typeof b.echo === 'string' ? { echo: b.echo.slice(0, 2500) } : {}), fileName: b.fileName.slice(0, 300) };
  edit.events.push({ at: stamp, what: 'reply', i: b.i });
  writeEdit(edit);
  return { ok: true, value: edit };
}

const COMPLEXITY_ECHO = /^Set the complexity of .+ to (Simple|Complex)\s*$/s;

/** FriendlyBot's one-line answer to `$simple`/`$complex`; it must name the value posted. */
function complexityAnswer(edit: CardEdit, c: EditCommand, b: ReplyBody, at: string, stamp: string): Outcome<CardEdit> {
  const said = typeof b.echo === 'string' ? COMPLEXITY_ECHO.exec(b.echo)?.[1] : undefined;
  const posted = parseCommand(c.posted!.content)?.value;
  if (!said || said !== posted) return refuse(409, `that answer does not set the complexity to ${posted ?? '?'}`);
  c.reply = { at, echo: String(b.echo).slice(0, 2500) };
  edit.events.push({ at: stamp, what: 'reply', i: b.i });
  writeEdit(edit);
  return { ok: true, value: edit };
}

/* -- what the page is shown ------------------------------------------------ */

const WORD: Readonly<Record<string, string>> = {
  total_cost: 'cost', cost: 'affinity', power: 'power', toughness: 'toughness',
  type: 'type', text: 'text', image: 'art', complexity: 'complexity', name: 'name',
};
const NUMBERS = new Set(['total_cost', 'power', 'toughness']);

/** "cost 3 → 2, art": what changed, in his words, for the list of edits. */
export function diffSummary(edit: CardEdit): string {
  const his = (pips: unknown): string => editorFields({ ...edit.base.row, cost: String(pips) }).cost || 'none';
  return edit.diff.filter(d => WORD[d.field]).map(d => {
    if (NUMBERS.has(d.field)) return `${WORD[d.field]} ${String(d.from)} → ${String(d.to)}`;
    if (d.field === 'cost') return `affinity ${his(d.from)} → ${his(d.to)}`;
    if (d.field === 'complexity') return `${String(d.to)}`;
    return WORD[d.field]!;
  }).join(', ');
}

/** May this account see this edit? Its author, and every admin. */
export const mayRead = (me: Account, edit: CardEdit): boolean => me.admin === true || edit.by.account === me.id;
