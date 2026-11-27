/**
 * The card editor's classifier, for the apply job (bot/pipeline/apply_card_edit.py).
 *
 *   node client/engine/scripts/card-edit-cli.mjs <edit.json> <oracle.json>
 *
 * Prints one JSON object: the edit's diff against the CURRENT oracle row, its road, the
 * update line, and `problems` (each a player-facing sentence; empty when the job may go on).
 * The job is Python and the rules are client/ui/cardnotation.ts, so the job asks here
 * rather than spelling any of them twice.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffRow, parseCommand, road, updateLine, valueFromCommand } from '../../ui/cardnotation.ts';

const NUMBER = /^(?:\d+|X)$/;

/** What stops `edit` from being applied to `row`, beyond its road. */
export function problemsOf(edit, row) {
  const out = [];
  for (const c of edit.commands ?? []) {
    // the server stores what the bot saw, { messageId, channelId, content, at }; content is what FriendlyBot applied
    const posted = c.posted?.content;
    if (typeof posted !== 'string') { out.push(`the command for ${c.field} was never seen posted`); continue; }
    const p = parseCommand(posted);
    const v = p && p.verb === 'modify' ? valueFromCommand(p.field, p.value) : null;
    if (p && p.verb !== 'modify') out.push('a complexity command was posted');
    else if (!v) out.push(`FriendlyBot would not read the posted command "${posted.slice(0, 80)}"`);
    else if (edit.after?.[v.field] !== v.value) out.push(`the posted ${v.field} is ${v.value}, the edit says ${edit.after?.[v.field]}`);
  }
  for (const f of ['total_cost', 'power', 'toughness']) {
    const v = edit.after?.[f];
    if (v !== undefined && !NUMBER.test(v)) out.push(`the new ${f} "${v}" is not a number or X`);
  }
  if (row && edit.base?.row && JSON.stringify(edit.base.row) !== JSON.stringify(row)) {
    out.push(`${edit.card} changed since the edit was made`);
  }
  return out;
}

export function classify(edit, oracle) {
  const row = oracle[edit.card]?.[0];
  if (!row) return { card: edit.card, diff: [], road: 'steward', why: [], updateLine: '', problems: [`${edit.card} is not in the oracle`] };
  const diff = diffRow(row, edit.after ?? {});
  const r = road(diff);
  const problems = problemsOf(edit, row);
  if (!diff.length) problems.push('the edit changes nothing in the row');
  return { card: edit.card, diff, road: r.road, why: r.why, updateLine: updateLine(edit.card, diff), problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [editPath, oraclePath] = process.argv.slice(2);
  if (!editPath || !oraclePath) {
    console.error('usage: card-edit-cli.mjs <edit.json> <oracle.json>');
    process.exit(2);
  }
  const edit = JSON.parse(readFileSync(editPath, 'utf8'));
  const oracle = JSON.parse(readFileSync(oraclePath, 'utf8'));
  process.stdout.write(JSON.stringify(classify(edit, oracle)) + '\n');
}
