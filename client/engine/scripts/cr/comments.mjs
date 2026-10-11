/**
 * THE REVIEW COMMENTS, FOR THE PROCESS THAT APPLIES THEM
 * (data/comprehensive-rules/README.md, "How to apply a review comment").
 *
 *   npm --prefix client run cr:comments -- [open] [--box | --file <jsonl>] [--all] [--json]
 *   npm --prefix client run cr:comments -- reply   <id> (--body <text> | --body-file <f>) (--box | --server <url>) [--dry-run]
 *   npm --prefix client run cr:comments -- resolve <id> (--box | --server <url>) [--dry-run]
 *   npm --prefix client run cr:comments -- reopen  <id> (--box | --server <url>) [--dry-run]
 *
 * `open` (the default) prints every OPEN thread (`--all`: resolved ones too)
 * with what a reviewer needs beside it: the target's live number and key,
 * its unit file, its CURRENT text, the quote the commenter anchored on and
 * whether that quote is still in the text, and every finding, discrepancy,
 * rule and glossary row that shares the target's rule key. That last list is
 * where the sweep STARTS, not where it ends: the README says how to widen it.
 *
 * ── WHERE THE COMMENTS COME FROM ─────────────────────────────────────────
 *
 * The journal is the game server's var/cr-comments.jsonl (statepaths.ts
 * crCommentsFile()). `--file` reads any copy of it; with neither flag, the
 * local one. `--box` copies the deploy box's journal over ssh (paths.mjs
 * `remote()`, the issues.jsonl fetch's route) into build/comments/ and reads
 * that. Over ssh and not over HTTP, on purpose: the raw rows carry account
 * ids, ssh to the box is already the operator's door, and a read route would
 * be one more way for those ids to leave the server. The parse and the fold
 * are the server's own (`readJournal`, `fold` in crreview.ts), not copies, so
 * this script cannot disagree with the page about what is open.
 *
 * ── HOW IT ANSWERS ───────────────────────────────────────────────────────
 *
 * `reply`, `resolve` and `reopen` write as the Rules editor (crreview.ts
 * RULES_EDITOR), never as anybody's account, through `POST /api/cr/editor`,
 * which only the bot token opens (api-crreview.ts). Over HTTP and not by
 * appending to the file, because the server validates the op and the file is
 * the server's. `--server <url>` sends the token from ALGO_BOT_TOKEN here;
 * `--box` runs curl ON the box, against its loopback game server, with the
 * box's own .env, so the token never leaves the box. `--dry-run` prints what
 * would be sent and sends nothing.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { CR_BUILD_DIR, DEPLOY_GAME_URL, DEPLOY_HOST, DEPLOY_ROOT, REPO_ROOT, remote } from '../paths.mjs';
import { fold, readJournal } from '../../../server/crreview.ts';
import { crCommentsFile } from '../../../server/statepaths.ts';
import { indexLedger } from './ledger.mjs';
import { loadInputs } from './render.mjs';
import { norm } from './schema.mjs';

/* ── pure: threads ─────────────────────────────────────────────────────── */

/**
 * The threads of a folded journal: each live root with its live replies, in
 * the order they were written. `all` keeps resolved roots; deleted roots are
 * never threads (a deleted root's replies have no question left to answer).
 */
export function threadsOf(items, { all = false } = {}) {
  const list = [...items.values()];
  return list
    .filter((c) => c.parent === null && !c.deleted && (all || !c.resolved))
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((root) => ({ root, replies: list.filter((c) => c.parent === root.id && !c.deleted).sort((a, b) => a.at.localeCompare(b.at)) }));
}


/* ── pure: a thread's live context ─────────────────────────────────────── */

/** the key a rule has NOW: a ledger alias {from: the numbered key, to: its new name} is followed forward */
export function liveKey(ledger, key) {
  const seen = new Set();
  let k = key;
  for (let a; (a = ledger.aliases.find((x) => x.from === k)) && !seen.has(k);) { seen.add(k); k = a.to; }
  return k;
}

const unitOf = (inputs, row) => { const f = inputs.fileOf?.get(row); return f ? basename(f, '.json') : null; };
/** the row's file under data/comprehensive-rules/ (loadInputs labels the rules files bare) */
const fileOf = (inputs, row) => { const f = inputs.fileOf?.get(row); return f ? (f.includes('/') ? f : `rules/${f}`) : null; };
const refsKey = (r, key, num) =>
  (r.see ?? []).some((s) => s === key || (num && s === num)) ||
  new RegExp(`\\brule ${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(r.text ?? '');

/**
 * What a reviewer needs beside one comment. `inputs` is render.mjs
 * loadInputs(). The target's rule key is the rule itself for `rule:`, and the
 * row's `rule` for `finding:` and `disc:`; everything sharing that key — or,
 * for a finding, citing the finding — is listed under `related`.
 */
export function contextFor(root, inputs) {
  const L = indexLedger(inputs.ledger);
  const target = String(root.target);
  const out = { target, kind: target.split(':')[0], anchor: null, related: { rules: [], findings: [], discrepancies: [], glossary: [] } };
  let key = null, text = null;

  if (target.startsWith('rule:')) {
    const asked = target.slice(5);
    key = liveKey(inputs.ledger, asked);
    const entry = L.entryOf(key);
    const rec = inputs.records.find((r) => r.key === key);
    Object.assign(out, { key, renamedFrom: key !== asked ? asked : undefined, num: L.numOf(key) ?? null, removed: !!entry?.removed, unit: rec ? unitOf(inputs, rec) : null, file: rec ? fileOf(inputs, rec) : null });
    text = rec?.text ?? null;
    out.text = text;
  } else if (target.startsWith('finding:')) {
    const id = target.slice(8);
    const f = inputs.findings.find((x) => x.id === id) ?? inputs.findings.find((x) => (x.dupes ?? []).includes(id));
    if (f) {
      key = f.rule ?? null;
      Object.assign(out, { id, row: f, unit: unitOf(inputs, f), file: fileOf(inputs, f), keptAs: f.id !== id ? f.id : undefined });
      text = [f.title, f.summary].filter(Boolean).join(' ');
      out.text = text;
    } else Object.assign(out, { id, missing: true });
  } else if (target.startsWith('disc:')) {
    const id = target.slice(5);
    const d = inputs.discrepancies.find((x) => x.id === id) ?? inputs.discrepancies.find((x) => (x.seeAlso ?? []).some((s) => s.id === id));
    if (d) {
      key = d.rule ?? null;
      Object.assign(out, { id, row: d, unit: unitOf(inputs, d), file: fileOf(inputs, d), keptAs: d.id !== id ? d.id : undefined });
      text = [d.summary, d.question?.ask, d.resolution].filter(Boolean).join(' ');
      out.text = text;
    } else Object.assign(out, { id, missing: true });
  } else {
    out.text = null;   // a section heading, the front matter, an annex: no record to compare against
  }

  if (key && !target.startsWith('rule:')) {
    const rec = inputs.records.find((r) => r.key === key);
    out.rule = { key, num: L.numOf(key) ?? null, unit: rec ? unitOf(inputs, rec) : null, text: rec?.text ?? null };
  }

  if (root.anchor) {
    const quote = root.anchor.quote;
    const why = [];
    if (text === null) why.push('no record text to look in');
    else if (!norm(text).includes(norm(quote))) why.push('the quote is no longer in the text');
    if (root.anchor.num && out.num && root.anchor.num !== out.num) why.push(`renumbered ${root.anchor.num} → ${out.num}`);
    out.anchor = { quote, num: root.anchor.num ?? null, edition: root.anchor.edition, outdated: why.length > 0, why };
  }

  if (key) {
    const num = L.numOf(key);
    const findingIds = new Set(inputs.findings.filter((f) => f.rule === key).map((f) => f.id));
    const self = inputs.records.find((r) => r.key === key);
    for (const id of self?.engineDiffers ?? []) findingIds.add(id);
    if (out.kind === 'finding' && out.row) findingIds.add(out.row.id);
    out.related.findings = inputs.findings.filter((f) => findingIds.has(f.id))
      .map((f) => ({ id: f.id, unit: unitOf(inputs, f), title: f.title, ct: f.ct ?? null, dupes: f.dupes ?? [] }));
    out.related.discrepancies = inputs.discrepancies
      .filter((d) => d.rule === key || (d.seeAlso ?? []).some((s) => s.rule === key))
      .map((d) => ({ id: d.id, unit: unitOf(inputs, d), tier: d.tier, summary: d.summary }));
    out.related.rules = inputs.records
      .filter((r) => r.key !== key && (refsKey(r, key, num) || (r.engineDiffers ?? []).some((id) => findingIds.has(id))))
      .map((r) => ({ key: r.key, num: L.numOf(r.key) ?? null, unit: unitOf(inputs, r), text: r.text, engineDiffers: r.engineDiffers ?? [] }));
    out.related.glossary = inputs.glossary.filter((g) => (g.see ?? []).includes(key))
      .map((g) => ({ term: g.term, text: g.text }));
  }
  return out;
}

/* ── printing ──────────────────────────────────────────────────────────── */

const who = (by) => `${by.name}${by.owner ? ' (owner' + (by.judge ? `, judge L${by.judge})` : ')') : by.judge ? ` (judge L${by.judge})` : ''}`;
const wrap = (s, pad = '      ') => String(s ?? '').replace(/\s+/g, ' ').trim().replace(/(.{1,96})(\s|$)/g, `${pad}$1\n`).trimEnd();

export function formatThread({ root, replies }, ctx) {
  const L = [];
  const where = ctx.kind === 'rule'
    ? `rule ${ctx.num ?? '(unnumbered)'} ${ctx.key}${ctx.renamedFrom ? ` (was ${ctx.renamedFrom})` : ''}${ctx.removed ? ' [REMOVED]' : ''}`
    : ctx.id ? `${ctx.kind} ${ctx.id}${ctx.keptAs ? ` (merged into ${ctx.keptAs})` : ''}${ctx.missing ? ' [NOT FOUND in the records]' : ''}` : ctx.target;
  L.push(`━━ ${root.id} · ${root.resolved ? `resolved by ${root.resolved.by}` : 'OPEN'} · ${where}${ctx.unit ? ` · ${ctx.unit}` : ''}`);
  L.push(`   by ${who(root.by)}, ${root.at}${root.editedAt ? ` (edited ${root.editedAt})` : ''}${root.kind === 'answer' ? ` · ANSWER: reading ${root.reading}` : ''}`);
  if (ctx.anchor) {
    L.push(`   on: "${ctx.anchor.quote}"${ctx.anchor.num ? ` (${ctx.anchor.num}, ${ctx.anchor.edition})` : ` (${ctx.anchor.edition})`}`);
    L.push(`   anchor: ${ctx.anchor.outdated ? `OUTDATED — ${ctx.anchor.why.join('; ')}` : 'still in the current text'}`);
  }
  L.push('   comment:', wrap(root.body));
  for (const r of replies) L.push(`   reply by ${who(r.by)}, ${r.at}:`, wrap(r.body));
  if (ctx.text) L.push('   current text:', wrap(ctx.text));
  const q = ctx.row?.question;
  if (q) {
    L.push(`   owner question: ${q.ask ?? ''}`);
    for (const r of q.readings ?? []) L.push(`     reading ${r.label}${r.label === root.reading ? '  ◀ ANSWERED' : ''}:`, wrap(r.text, '        '), ...(r.table ? [wrap(`at the table: ${r.table}`, '        ')] : []));
    if (q.follows) L.push(`     the document follows: ${q.follows}`);
  }
  if (ctx.file) L.push(`   file: data/comprehensive-rules/${ctx.file}`);
  if (ctx.rule) L.push(`   its rule: ${ctx.rule.num ?? '(unnumbered)'} ${ctx.rule.key} (${ctx.rule.unit})`, wrap(ctx.rule.text));
  const R = ctx.related;
  if (R.rules.length) L.push(`   rules that cite it or share its findings (${R.rules.length}):`, ...R.rules.map((r) => `     ${r.num ?? '-'} ${r.key} (${r.unit})${r.engineDiffers.length ? ` [engine differs: ${r.engineDiffers.join(', ')}]` : ''}`));
  if (R.findings.length) L.push(`   findings on the key (${R.findings.length}):`, ...R.findings.map((f) => `     ${f.id} (${f.unit})${f.ct ? ` ${f.ct}` : ''}${f.dupes.length ? ` dupes ${f.dupes.join(', ')}` : ''}: ${f.title}`));
  if (R.discrepancies.length) L.push(`   discrepancies on the key (${R.discrepancies.length}):`, ...R.discrepancies.map((d) => `     ${d.id} (${d.unit}, tier ${d.tier}): ${d.summary.slice(0, 140)}${d.summary.length > 140 ? '…' : ''}`));
  if (R.glossary.length) L.push(`   glossary rows pointing at it (${R.glossary.length}):`, ...R.glossary.map((g) => `     ${g.term}: ${g.text}`));
  return L.join('\n');
}

/* ── the journal: which copy ───────────────────────────────────────────── */

/** copy the box's journal into build/comments/ and return the local path */
function fetchFromBox() {
  const dir = join(CR_BUILD_DIR, 'comments');
  mkdirSync(dir, { recursive: true });
  const local = join(dir, `cr-comments-${new Date().toISOString().slice(0, 10)}.jsonl`);
  execFileSync('scp', ['-q', remote(crCommentsFile()), local], { stdio: ['ignore', 'inherit', 'inherit'] });
  return local;
}

/** fold the journal at `file` with the server's own reader */
export function loadThreads(file, opts) {
  const before = process.env['ALGO_CR_COMMENTS_FILE'];
  process.env['ALGO_CR_COMMENTS_FILE'] = file;
  try { return threadsOf(fold(readJournal()), opts); } finally {
    if (before === undefined) delete process.env['ALGO_CR_COMMENTS_FILE']; else process.env['ALGO_CR_COMMENTS_FILE'] = before;
  }
}

/* ── writing, as the Rules editor ──────────────────────────────────────── */

/** the request a write sends; pure, so the test and --dry-run see the same thing */
export function editorRequest(op, id, body) {
  if (!['reply', 'resolve', 'reopen'].includes(op)) throw new Error(`op: reply, resolve or reopen, not ${op}`);
  if (!/^c_[a-z0-9]+_[0-9a-f]+$/.test(String(id))) throw new Error(`id: a comment id (c_…), not ${id}`);
  if (op === 'reply' && !String(body ?? '').trim()) throw new Error('reply: a body is required');
  return { path: '/api/cr/editor', payload: { op, id, ...(op === 'reply' ? { body } : {}) } };
}

/** send it to a server this machine can reach, with ALGO_BOT_TOKEN from here */
export async function sendToServer(server, req, token = process.env['ALGO_BOT_TOKEN'] ?? '') {
  if (!token) throw new Error('ALGO_BOT_TOKEN is not set: the editor door does not exist without it');
  const res = await fetch(new URL(req.path, server), {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-algo-bot': token }, body: JSON.stringify(req.payload),
  });
  const text = await res.text();
  let answer; try { answer = JSON.parse(text); } catch { answer = { ok: false, error: text.slice(0, 200) }; }
  return { status: res.status, answer };
}

/** run curl ON the box, against its loopback server, with the box's .env: the token stays there */
function sendViaBox(req) {
  const script = `set -a && . ${DEPLOY_ROOT}/.env && set +a && curl -sS -w '\\n%{http_code}' -X POST`
    + ` -H 'content-type: application/json' -H "x-algo-bot: $ALGO_BOT_TOKEN" --data-binary @- ${DEPLOY_GAME_URL}${req.path}`;
  const out = execFileSync('ssh', [DEPLOY_HOST, script], { input: JSON.stringify(req.payload), encoding: 'utf8' }).trimEnd();
  const nl = out.lastIndexOf('\n');
  const status = Number(out.slice(nl + 1));
  let answer; try { answer = JSON.parse(out.slice(0, nl)); } catch { answer = { ok: false, error: out.slice(0, 200) }; }
  return { status, answer };
}

/* ── main ──────────────────────────────────────────────────────────────── */

async function main(argv) {
  const { values: v, positionals: pos } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      file: { type: 'string' }, box: { type: 'boolean' }, server: { type: 'string' }, all: { type: 'boolean' },
      json: { type: 'boolean' }, body: { type: 'string' }, 'body-file': { type: 'string' }, 'dry-run': { type: 'boolean' },
    },
  });
  const cmd = pos[0] ?? 'open';

  if (cmd === 'open') {
    if (v.box && v.file) throw new Error('--box or --file, not both');
    const file = v.box ? fetchFromBox() : v.file ?? crCommentsFile();
    const threads = loadThreads(file, { all: !!v.all });
    const inputs = loadInputs();
    const rows = threads.map((t) => ({ ...t, context: contextFor(t.root, inputs) }));
    if (v.json) {
      // names and marks only: the journal's account ids stay in the journal
      const named = (c) => ({ ...c, by: { name: c.by.name, owner: c.by.owner, judge: c.by.judge } });
      const out = rows.map(({ root, replies, context }) => ({ root: named(root), replies: replies.map(named), context }));
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      return;
    }
    const shown = relative(REPO_ROOT, file).startsWith('..') ? file : relative(REPO_ROOT, file);
    console.log(`${shown}: ${rows.length} ${v.all ? '' : 'open '}thread${rows.length === 1 ? '' : 's'}\n`);
    for (const r of rows) console.log(formatThread(r, r.context) + '\n');
    return;
  }

  if (cmd === 'reply' || cmd === 'resolve' || cmd === 'reopen') {
    const body = cmd === 'reply' ? (v['body-file'] ? readFileSync(v['body-file'], 'utf8').trim() : v.body) : undefined;
    const req = editorRequest(cmd, pos[1], body);
    if (!!v.box === !!v.server) throw new Error('say where: --box (the deploy box, over ssh) or --server <url>');
    if (v['dry-run']) { console.log(JSON.stringify({ to: v.box ? `${DEPLOY_HOST} → ${DEPLOY_GAME_URL}` : v.server, ...req }, null, 2)); return; }
    const { status, answer } = v.box ? sendViaBox(req) : await sendToServer(v.server, req);
    console.log(JSON.stringify({ status, ...answer }, null, 2));
    if (!answer.ok) process.exitCode = 1;
    return;
  }
  throw new Error(`unknown command ${cmd}: open, reply, resolve or reopen`);
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}

