/* 1521 — the runner's side of the store: cardedit-runner-row.ts and index.json.
 *
 * §1 the script refuses a bad id, an unknown step and an edit that does not exist,
 *    writing nothing, and appends one row for a good call
 * §2 index.json lists exactly the edits ready for the home box, oldest first: every
 *    command answered, not cancelled, not yet landed or handed to the steward
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeEdit, type CardEdit, type EditCommand } from '../cardedit.ts';
import type { OracleRow } from '../../ui/cardnotation.ts';
import { cardEditsDir } from '../statepaths.ts';
import './cardedit-fixture.ts';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'cardedit-runner-row.ts');
const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], {
  encoding: 'utf8', env: { ...process.env, ALGO_CARD_EDITS_DIR: cardEditsDir() },
});
const index = (): unknown => JSON.parse(readFileSync(join(cardEditsDir(), 'index.json'), 'utf8'));
const runnerFile = (id: string): string => join(cardEditsDir(), `${id}.runner.jsonl`);

const caught: EditCommand = { text: 't', field: 'power', posted: { messageId: 'm', channelId: 'c', content: 't', at: 't' }, reply: { at: 't', fileName: 'f.jpg' } };
const waiting: EditCommand = { ...caught, reply: null };
function edit(id: string, createdAt: string, commands: EditCommand[], extra: Partial<CardEdit> = {}): CardEdit {
  const e: CardEdit = {
    v: 1, id, card: 'Murkstalker', by: { account: 'a', name: 'Caleb', discord: '1' }, createdAt,
    base: { rowHash: 'h', row: {} as OracleRow }, edit: {}, after: {}, diff: [], road: 'fast', why: [],
    commands, events: [{ at: createdAt, what: 'submitted' }], ...extra,
  };
  writeEdit(e);
  return e;
}

const READY = 'ce-20261127-murkstalker-aaaa';
const STEWARD = 'ce-20261126-good-whale-bbbb';

const PICTURES = [{ at: 't', what: 'picture', which: 'before' }, { at: 't', what: 'picture', which: 'after' }];

test('1521 §1 the runner-row script refuses what it does not know and appends what it does', () => {
  edit(READY, '2026-11-27T10:00:00Z', [caught], { events: [{ at: 't', what: 'submitted' }, ...PICTURES] });
  for (const [args, why] of [
    [['../etc-passwd', 'picked'], /not an edit id/],
    [['ce-20261127-Murkstalker-aaaa', 'picked'], /not an edit id/],
    [['ce-20261127-murkstalker-aaaa;rm', 'picked'], /not an edit id/],
    [[READY, 'shipped'], /not a step/],
    [[READY], /not a step/],
    [['ce-20261127-nobody-0000', 'picked'], /no such edit/],
  ] as [string[], RegExp][]) {
    const r = run(...args);
    assert.equal(r.status, 2, `${args.join(' ')}: refused (${r.stderr})`);
    assert.match(r.stderr, why);
  }
  assert.equal(existsSync(runnerFile(READY)), false, 'nothing written by a refusal');
  const ok = run(READY, 'picked');
  assert.equal(ok.status, 0, ok.stderr);
  const gateRed = run(READY, 'gate-red', 'a test', 'pins its cost');
  assert.equal(gateRed.status, 0, gateRed.stderr);
  const lines = readFileSync(runnerFile(READY), 'utf8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>);
  assert.deepEqual(lines.map(l => [l['step'], l['why']]), [['picked', undefined], ['gate-red', 'a test pins its cost']]);
  assert.ok(lines.every(l => typeof l['at'] === 'string' && !Number.isNaN(Date.parse(String(l['at'])))));
});

test('1521 §2 index.json is the edits ready for the home box, oldest first', () => {
  const complexity: EditCommand = { ...caught, field: 'complexity', reply: { at: 't', echo: 'Set the complexity of good whale to Complex' } };
  edit(STEWARD, '2026-11-26T10:00:00Z', [complexity], { card: 'Good Whale', road: 'steward', why: ['the complexity changed'] });
  edit('ce-20261127-dune-drifter-cccc', '2026-11-27T11:00:00Z', [caught, waiting], { card: 'Dune Drifter' });
  edit('ce-20261127-air-plant-dddd', '2026-11-27T12:00:00Z', [caught], { card: 'Air Plant', events: [{ at: 't', what: 'cancelled' }] });
  edit('ce-20261127-angel-of-anguish-eeee', '2026-11-27T13:00:00Z', [{ ...caught, posted: null, reply: null }], { card: 'Angel of Anguish' });
  assert.deepEqual(index(), {
    v: 1,
    edits: [
      { id: STEWARD, card: 'Good Whale', road: 'steward', pictures: false },
      { id: READY, card: 'Murkstalker', road: 'fast', pictures: true },
    ],
  }, 'a command still waiting, a cancelled edit and an unposted one are left out; a complexity edit needs no picture');
  assert.equal(run(STEWARD, 'to-steward', 'the text changed').status, 0);
  assert.equal(run(READY, 'landed').status, 0);
  assert.deepEqual(index(), { v: 1, edits: [] }, 'handed to the steward, and landed, leave it');
});
