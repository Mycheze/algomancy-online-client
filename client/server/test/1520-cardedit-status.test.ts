/* 1520 — statusOf: an edit, the runner's rows and the build's trailers give one status (§7).
 * Pure: every case is a hand-built record, nothing is read off disk.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_ANSWER_NOTE, statusOf, type CardEdit, type EditCommand, type EditEvent, type RunnerRow } from '../cardedit.ts';
import type { OracleRow } from '../../ui/cardnotation.ts';

const ID = 'ce-20261127-murkstalker-7f3a';
const POSTED = { messageId: 'm', channelId: 'c', content: '$modify murkstalker|total cost|3', at: 't' };
const ANSWERED = { at: 't', fileName: 'x.jpg' };
const cmd = (posted: boolean, reply: EditCommand['reply'] = null): EditCommand =>
  ({ text: '$modify murkstalker|total cost|3', field: 'total cost', posted: posted ? POSTED : null, reply });

function edit(commands: EditCommand[], more: { road?: 'fast' | 'steward'; why?: string[]; events?: EditEvent[] } = {}): CardEdit {
  return {
    v: 1, id: ID, card: 'Murkstalker', by: { account: 'a', name: 'Caleb', discord: '1' }, createdAt: 't',
    base: { rowHash: 'h', row: {} as OracleRow }, edit: {}, after: {}, diff: [],
    road: more.road ?? 'fast', why: more.why ?? [], commands,
    events: [{ at: 't', what: 'submitted' }, ...(more.events ?? [])],
  };
}
const rows = (...steps: [RunnerRow['step'], string?][]): RunnerRow[] =>
  steps.map(([step, why]) => ({ at: 't', step, ...(why ? { why } : {}) }));
const ev = (what: string, extra: Record<string, unknown> = {}): EditEvent => ({ at: 't', what, ...extra });

const CASES: [string, CardEdit, RunnerRow[], string[], ReturnType<typeof statusOf>][] = [
  ['nothing posted', edit([cmd(false), cmd(false)]), [], [], { status: 'submitted' }],
  ['one of two posted', edit([cmd(true), cmd(false)], { events: [ev('posted')] }), [], [], { status: 'waiting' }],
  ['posted, unanswered', edit([cmd(true)], { events: [ev('posted')] }), [], [], { status: 'waiting' }],
  ['FriendlyBot silent', edit([cmd(true, { at: 't', noAnswer: true })], { events: [ev('posted'), ev('no-answer')] }), [], [],
    { status: 'waiting', note: NO_ANSWER_NOTE }],
  ['FriendlyBot failed', edit([cmd(true, { at: 't', error: 'Something went wrong' })], { events: [ev('posted'), ev('reply-error', { error: 'Something went wrong' })] }), [], [],
    { status: 'waiting', note: 'FriendlyBot said "Something went wrong": post the command again.' }],
  ['the wrong card', edit([cmd(true)], { events: [ev('posted'), ev('wrong-card', { file: 'Blights_End' })] }), [], [],
    { status: 'waiting', note: 'FriendlyBot changed a different card: Blights End' }],
  ['re-posted after the wrong card', edit([cmd(true)], { events: [ev('wrong-card', { file: 'Blights_End' }), ev('posted')] }), [], [], { status: 'waiting' }],
  ['all caught, fast, no runner yet', edit([cmd(true, ANSWERED)]), [], [], { status: 'applying', note: 'waiting for the home box' }],
  ['picked', edit([cmd(true, ANSWERED)]), rows(['picked']), [], { status: 'applying', note: 'testing' }],
  ['landed, not yet deployed here', edit([cmd(true, ANSWERED)]), rows(['picked'], ['landed']), [], { status: 'applying', note: 'passed the tests: live with the next deploy' }],
  ['a follow-up row changes nothing', edit([cmd(true, ANSWERED)]), rows(['picked'], ['followup', 'prose names it']), [], { status: 'applying', note: 'testing' }],
  ['gate red, handed over', edit([cmd(true, ANSWERED)]), rows(['picked'], ['gate-red'], ['to-steward', 'a test pins its cost']), [],
    { status: 'steward', note: 'queued for the steward: a test pins its cost' }],
  ['steward road', edit([cmd(true, ANSWERED)], { road: 'steward', why: ['the text changed'] }), [], [],
    { status: 'steward', note: 'queued for the steward: the text changed' }],
  ['steward road waits for its pictures first', edit([cmd(true)], { road: 'steward', why: ['the text changed'] }), [], [], { status: 'waiting' }],
  ['live', edit([cmd(true, ANSWERED)]), rows(['picked'], ['landed']), [ID], { status: 'live' }],
  ['a steward edit goes live the same way', edit([cmd(true, ANSWERED)], { road: 'steward', why: ['the text changed'] }), rows(['to-steward']), [ID], { status: 'live' }],
  ['another edit live', edit([cmd(true, ANSWERED)]), [], ['ce-20261127-murkstalker-0000'], { status: 'applying', note: 'waiting for the home box' }],
  ['cancelled', edit([cmd(false)], { events: [ev('cancelled')] }), [], [], { status: 'cancelled' }],
];

test('1520 statusOf, one case per row of the status table', () => {
  for (const [name, e, r, liveIds, want] of CASES) {
    assert.deepEqual(statusOf(e, r, liveIds), want, name);
    assert.deepEqual(statusOf(e, r, new Set(liveIds)), want, `${name}: a set of ids answers the same`);
  }
});
