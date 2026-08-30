/**
 * "I have down time — what should I do?"
 *
 * The backlog is a data structure, not a document, so the answer to that
 * question is a query rather than a read-through. This is that query.
 *
 *   node report.ts              the ready list, shortest first
 *   node report.ts --all        every entry, grouped by status
 *   node report.ts --asks       only the questions waiting on the owner
 *   node report.ts BL-19        one entry, in full, ready to work from
 *   node report.ts reset-blocks same, by slug
 *
 * The ready list deliberately excludes XL entries and anything with an open
 * `asks`: a down-time slot is the wrong place to start a project or to guess
 * at a decision the owner has not made.
 */
import { BACKLOG, type Entry } from './backlog.ts';

const byId = new Map(BACKLOG.map(e => [e.id, e]));
const SIZE_ORDER: Record<Entry['size'], number> = { S: 0, M: 1, L: 2, XL: 3 };

function blockers(e: Entry): string[] {
  return (e.deps ?? []).filter(d => byId.get(d)?.status !== 'done');
}

function isReady(e: Entry): boolean {
  return e.status === 'open'
    && !(e.asks && e.asks.length)
    && e.size !== 'XL'
    && blockers(e).length === 0;
}

function bullets(label: string, lines: readonly string[] | undefined): string {
  if (!lines || !lines.length) return '';
  return `\n${label}\n` + lines.map(l => `  · ${l}`).join('\n') + '\n';
}

/** everything an agent needs to start, without reading the source file */
function detail(e: Entry): string {
  const dep = (e.deps ?? []).map(d => `${d} (${byId.get(d)?.status ?? '?'})`).join(', ');
  return [
    `${e.id}  ${e.title}`,
    `${'─'.repeat(Math.min(72, e.title.length + e.id.length + 2))}`,
    `status ${e.status}   size ${e.size}   area ${e.area}   track ${e.track}   slug ${e.slug}`,
    dep ? `depends on ${dep}` : '',
    '',
    'THE OWNER SAID',
    `  "${e.said}"`,
    '',
    'WHICH MEANS',
    `  ${e.means}`,
    bullets('DONE WHEN', e.doneWhen),
    bullets('ALREADY DECIDED — do not re-open', e.decided),
    bullets('OPEN QUESTIONS — ask before building these parts', e.asks),
    bullets('TOUCHES', e.touches),
    e.notes ? `NOTES\n  ${e.notes}\n` : '',
    e.evidence ? `EVIDENCE\n  commit ${e.evidence.commit}\n  guards ${e.evidence.guards.join(', ')}\n` : '',
  ].filter(Boolean).join('\n');
}

function line(e: Entry): string {
  const flag = isReady(e) ? ' ' : e.size === 'XL' ? 'X' : (e.asks && e.asks.length) ? '?' : 'B';
  return `  ${flag} ${e.id} [${e.size}] ${e.title}`;
}

const arg = process.argv[2];

if (arg && !arg.startsWith('--')) {
  const hit = BACKLOG.find(e => e.id.toLowerCase() === arg.toLowerCase() || e.slug === arg);
  if (!hit) {
    console.error(`no backlog entry "${arg}". Try: node report.ts --all`);
    process.exit(1);
  }
  console.log('\n' + detail(hit));
} else if (arg === '--asks') {
  const waiting = BACKLOG.filter(e => e.asks && e.asks.length);
  console.log(`\n${waiting.reduce((n, e) => n + (e.asks?.length ?? 0), 0)} questions waiting on the owner, across ${waiting.length} entries:\n`);
  for (const e of waiting) {
    console.log(`${e.id} — ${e.title}`);
    for (const q of e.asks ?? []) console.log(`  · ${q}`);
    console.log('');
  }
} else if (arg === '--all') {
  for (const status of ['active', 'open', 'done', 'dropped'] as const) {
    const group = BACKLOG.filter(e => e.status === status);
    if (!group.length) continue;
    console.log(`\n${status.toUpperCase()} (${group.length})`);
    for (const e of group) console.log(line(e));
  }
  console.log('\n  legend:  (blank) ready   ? open questions   B blocked on a dep   X too big for a down-time slot\n');
} else {
  const ready = BACKLOG.filter(isReady).sort((a, b) => SIZE_ORDER[a.size] - SIZE_ORDER[b.size]);
  console.log(
    '\nREADY TO PICK UP — open, unblocked, nothing to ask, small enough to finish.'
    + '\nCard/engine work in ledgers/card-todo.ts still outranks all of it.\n',
  );
  for (const e of ready) console.log(line(e));
  console.log(`\n${ready.length} ready of ${BACKLOG.filter(e => e.status === 'open').length} open.`
    + '\nnode report.ts <BL-id|slug> for the full entry.  --all  --asks\n');
}
