// index-raq.mjs — write the committed index of every rulings THREAD in the
// Discord export (RULINGS_EXPORTS → RAQ_SNAPSHOT). `npm run raq:index`.
//
// The export itself is gitignored and lives only in the main checkout, so
// nothing offline can check the RAQ register against it. This index is the
// committed copy the register IS checked against (engine/test/386), the same
// arrangement as the playtest-issues snapshot. Re-run it after every
// `bot/pipeline/export_rulings.sh`: a new thread then fails 386 until someone
// has read it against the engine.
//
// Threads only — the RAQ forum and the rules-questions threads. The flat
// rules-questions chat is a different shape (Q&A pairs, not write-ups) and is
// not indexed here.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { RULINGS_EXPORTS, RAQ_SNAPSHOT } from './paths.mjs';

if (!existsSync(RULINGS_EXPORTS)) {
  console.error(`✗ ${RULINGS_EXPORTS} does not exist. It is gitignored and lives only in the main `
    + 'checkout; run this there (or link it into your worktree).');
  process.exit(1);
}

const DESIGNER = 'calebgannon';
/** "[Solved] Graft 101" → "Solved"; "[Solved & Expanding?] …" → "Solved & Expanding?"; none → "" */
const markerOf = title => (/^\[([^\]]*)\]/.exec(title)?.[1] ?? '');

const rows = [];
for (const file of readdirSync(RULINGS_EXPORTS).filter(f => f.endsWith('.json')).sort()) {
  const d = JSON.parse(readFileSync(join(RULINGS_EXPORTS, file), 'utf8'));
  if (d.channel?.type !== 'GuildPublicThread') continue;
  const msgs = (d.messages ?? []).filter(m => !m.author?.isBot);
  const stamps = msgs.map(m => m.timestamp).sort();
  const authors = [...new Set(msgs.map(m => m.author?.name).filter(Boolean))].sort();
  rows.push({
    id: d.channel.id,
    title: d.channel.name,
    category: d.channel.category,
    marker: markerOf(d.channel.name),
    messages: msgs.length,
    first: stamps[0]?.slice(0, 10) ?? null,
    last: stamps[stamps.length - 1]?.slice(0, 10) ?? null,
    authors,
    designer: authors.includes(DESIGNER),
    images: msgs.reduce((n, m) => n + (m.attachments?.length ?? 0), 0),
    file,
  });
}
rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const before = existsSync(RAQ_SNAPSHOT)
  ? new Set(readFileSync(RAQ_SNAPSHOT, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id))
  : new Set();
writeFileSync(RAQ_SNAPSHOT, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const added = rows.filter(r => !before.has(r.id));
console.log(`${rows.length} threads indexed → ${RAQ_SNAPSHOT}`);
for (const r of added) console.log(`  + ${r.id}  ${r.title}  (${r.messages} messages${r.designer ? ', Caleb posted' : ''})`);
