/* 1626 — the apply job's classifier reads an edit exactly as the server wrote it.
 *
 * The edit is submitted, seen and answered through the real routes, and the record
 * they leave on disk goes to `card-edit-cli.mjs` as the apply job runs it: every
 * command counts as posted, and the diff and road are the submitted change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { editorFields } from '../../ui/cardnotation.ts';
import { oracleRow, rowHash } from '../cardedit.ts';
import { cardEditsDir } from '../statepaths.ts';
import { CARD_EDIT_CLI, ORACLE_JSON } from '../../engine/scripts/paths.mjs';
import { account, bodyReq, botPost, fbFile, jpegB64, page } from './cardedit-fixture.ts';

const CLI = CARD_EDIT_CLI;
const DEE = account('Dee', { designer: true, discord: '111' });
const ROW = oracleRow('Murkstalker')!;

test('1626 the apply job classifies a fast edit as the server stored it, with every command posted', async () => {
  const fields = { ...editorFields(ROW), 'total cost': '3', power: '3' };
  const sub = await page(bodyReq(DEE, { card: 'Murkstalker', rowHash: rowHash(ROW), fields }), '/api/cardedit/edits');
  assert.equal(sub.status, 200, sub.raw);
  const id = String(sub.body['id']);
  const commands = [['total cost', '$modify murkstalker|total cost|3'], ['power', '$modify murkstalker|power|3']];
  for (const [i, [field, content]] of commands.entries()) {
    const at = `2026-11-27T18:0${2 * i + 3}:00Z`;
    const seen = await botPost('/api/bot/cardedit/seen', { id, i, messageId: `m${i}`, channelId: 'c1', content, at });
    assert.equal(seen.status, 200, seen.raw);
    const reply = await botPost('/api/bot/cardedit/reply', {
      id, i, echo: `Modified murkstalker's ${field} from this`, fileName: fbFile('Murkstalker'),
      before: jpegB64(`B${i}`), after: jpegB64(`A${i}`), at: `2026-11-27T18:0${2 * i + 3}:10Z`,
    });
    assert.equal(reply.status, 200, reply.raw);
  }
  const file = join(cardEditsDir(), `${id}.json`);
  assert.ok(existsSync(file), 'the server wrote the edit record');

  const r = spawnSync(process.execPath, [CLI, file, ORACLE_JSON], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout) as { card: string; diff: { field: string; to: unknown }[]; road: string; problems: string[] };
  assert.deepEqual(out.problems, [], 'nothing stops the job');
  assert.equal(out.card, 'Murkstalker');
  assert.equal(out.road, 'fast');
  assert.deepEqual(out.diff.map(d => [d.field, d.to]).sort(), [['power', '3'], ['total_cost', '3']]);
});
