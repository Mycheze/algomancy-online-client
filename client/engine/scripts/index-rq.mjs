// index-rq.mjs — copy the designer's messages that a comprehensive rule cites
// out of the FLAT rules-questions channel and into the committed snapshot
// (RQ_SNAPSHOT), verbatim, each with the message it replies to and the
// messages just before it. `npm run rq:index -- <messageId>…`.
//
// Why a snapshot of a few messages, not an index of the channel: the export is
// gitignored, 67 MB and lives only in the main checkout, and the channel is
// Q&A chat (31k messages), not write-ups — index-raq.mjs leaves it out on
// purpose. A rule cites one of Caleb's messages there as `RQ <messageId>`
// (sources.designer[]); cr:check resolves that against this snapshot and
// checks the quote verbatim, exactly as it checks a RAQ claim.
//
//   node engine/scripts/index-rq.mjs <id> [<id>…]   add these messages (or re-read them)
//   node engine/scripts/index-rq.mjs --refresh      re-read every message already held
//     --export <file>   the channel export (default: the rules-questions file in RULINGS_EXPORTS)
//     --out <file>      the snapshot (default: RQ_SNAPSHOT)
//
// It REFUSES — writes nothing, exits 1 — when any id is not in the export, or
// was written by anyone but the designer: other players are not authority, and
// a player's message is in the snapshot only as the context of his answer.
// Re-run --refresh after `bot/pipeline/export_rulings.sh`: a message Caleb
// edited changes its textHash, and every rule quoting it reads stale.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { RULINGS_EXPORTS, RQ_SNAPSHOT } from './paths.mjs';
import { DESIGNER_AUTHOR } from './cr/schema.mjs';

/** the rules-questions channel's Discord id (its export file ends `[<id>].json`) */
export const RULES_QUESTIONS_CHANNEL = '1064279804741955646';
/** how far `before` reaches: at most this many messages, none older than a day */
const BEFORE_MAX = 8;
const BEFORE_WINDOW_MS = 24 * 3600 * 1000;
/** a call to the channel's card bot (`$card Plague Bellower`): context, never the question */
const BOT_COMMAND = /^\$\w+\b/;

const ctx = (m) => ({ id: m.id, timestamp: m.timestamp, author: m.author?.name ?? '(unknown)', content: m.content ?? '' });
const byId = (a, b) => (a.id.length - b.id.length) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The snapshot row for message `id` of `messages` (the export's array, in
 * channel order), or {refused} saying why it cannot be one.
 */
export function rowFor(messages, index, id) {
  const i = index.get(id);
  if (i === undefined) return { refused: `${id} is not in the rules-questions export` };
  const m = messages[i];
  if (m.author?.isBot || m.author?.name !== DESIGNER_AUTHOR) {
    return { refused: `${id} was written by ${m.author?.name ?? '(unknown)'}, not ${DESIGNER_AUTHOR}: other players are not authority ("${String(m.content ?? '').slice(0, 80)}")` };
  }
  const ref = m.reference?.messageId;
  const replyTo = !ref ? null : index.has(ref) ? ctx(messages[index.get(ref)]) : { id: ref, missing: true };
  const before = [];
  const t0 = Date.parse(m.timestamp);
  for (let j = i - 1; j >= 0 && before.length < BEFORE_MAX; j--) {
    const p = messages[j];
    if (t0 - Date.parse(p.timestamp) > BEFORE_WINDOW_MS) break;
    if (p.author?.isBot) continue;
    before.unshift(ctx(p));
    // stop at the question, or the remark, he was answering — a `$card <name>` bot call
    // only shows a card, so the walk goes on past it to the words before it
    if (p.author?.name !== DESIGNER_AUTHOR && !BOT_COMMAND.test(p.content ?? '')) break;
  }
  return { row: { id: m.id, timestamp: m.timestamp, edited: m.timestampEdited ?? null, author: m.author.name, content: m.content ?? '', replyTo, before } };
}

/** read the snapshot's rows (none when the file does not exist) */
export const readSnapshot = (file) => (existsSync(file)
  ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

function defaultExport() {
  if (!existsSync(RULINGS_EXPORTS)) return null;
  const f = readdirSync(RULINGS_EXPORTS).find((n) => n.endsWith(`[${RULES_QUESTIONS_CHANNEL}].json`));
  return f ? join(RULINGS_EXPORTS, f) : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { refresh: { type: 'boolean' }, export: { type: 'string' }, out: { type: 'string' } },
  });
  const out = values.out ?? RQ_SNAPSHOT;
  const file = values.export ?? defaultExport();
  if (!file || !existsSync(file)) {
    console.error(`✗ the rules-questions export is not here (${file ?? `${RULINGS_EXPORTS}/…[${RULES_QUESTIONS_CHANNEL}].json`}). `
      + 'It is gitignored and lives only in the main checkout; run this there, link it in, or pass --export.');
    process.exit(1);
  }
  const held = readSnapshot(out);
  const ids = [...new Set([...positionals, ...(values.refresh ? held.map((r) => r.id) : [])])];
  const bad = ids.filter((id) => !/^\d{15,20}$/.test(id));
  if (!ids.length || bad.length) {
    console.error(bad.length ? `✗ not a Discord message id: ${bad.join(', ')}` : 'usage: index-rq.mjs <messageId>… | --refresh');
    process.exit(1);
  }
  const d = JSON.parse(readFileSync(file, 'utf8'));
  if (String(d.channel?.id) !== RULES_QUESTIONS_CHANNEL) {
    console.error(`✗ ${file} is channel ${d.channel?.id} (${d.channel?.name}), not rules-questions (${RULES_QUESTIONS_CHANNEL})`);
    process.exit(1);
  }
  const messages = d.messages ?? [];
  const index = new Map(messages.map((m, i) => [m.id, i]));
  const rows = new Map(held.map((r) => [r.id, r]));
  const refused = [];
  const changed = [];
  for (const id of ids) {
    const r = rowFor(messages, index, id);
    if (r.refused) { refused.push(r.refused); continue; }
    const was = rows.get(id);
    if (!was) changed.push(`  + ${id}  ${r.row.timestamp.slice(0, 10)}  "${r.row.content.slice(0, 70).replace(/\s+/g, ' ')}"`);
    else if (was.content !== r.row.content) changed.push(`  ~ ${id}  its content CHANGED upstream: every rule quoting it reads stale`);
    rows.set(id, r.row);
  }
  if (refused.length) {
    for (const x of refused) console.error(`✗ ${x}`);
    console.error(`refused ${refused.length} of ${ids.length}; nothing written`);
    process.exit(1);
  }
  const all = [...rows.values()].sort(byId);
  writeFileSync(out, all.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`${all.length} rules-questions messages → ${out}`);
  for (const c of changed) console.log(c);
}
