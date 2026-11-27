/* 1519 — the posted command is what FriendlyBot applied, so it decides the change.
 *
 * §1 a different number posted: after and diff follow it, the road stays fast
 * §2 a different affinity posted whose deck cannot be worked out: the road turns steward,
 *    and posting the generated value again turns it back
 * §3 a message that sets another field is refused and changes nothing
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editorFields } from '../../ui/cardnotation.ts';
import { oracleRow, readEdit, rowHash } from '../cardedit.ts';
import { account, bodyReq, botPost, fbFile, jpegB64, page } from './cardedit-fixture.ts';

const DEE = account('Dee', { designer: true, discord: '111' });

async function submit(card: string, change: Record<string, string>): Promise<string> {
  const row = oracleRow(card)!;
  const r = await page(bodyReq(DEE, { card, rowHash: rowHash(row), fields: { ...editorFields(row), ...change } }), '/api/cardedit/edits');
  assert.equal(r.status, 200, r.raw);
  return String(r.body['id']);
}
const seen = (id: string, content: string, messageId = 'm1') =>
  botPost('/api/bot/cardedit/seen', { id, i: 0, messageId, channelId: 'c1', content, at: '2026-11-27T18:03:00Z' });

test('1519 §1 a different number posted moves after and diff, and stays fast', async () => {
  const id = await submit('Murkstalker', { 'total cost': '3' });
  const r = await seen(id, '$modify Murkstalker|Total_Cost|4');
  assert.equal(r.body['road'], 'fast');
  const e = readEdit(id)!;
  assert.deepEqual(e.edit, { 'total cost': '3' }, 'the submission is kept as he made it');
  assert.equal(e.commands[0]!.posted!.content, '$modify Murkstalker|Total_Cost|4', 'the content as posted');
  assert.deepEqual(e.after, { total_cost: '4' });
  assert.deepEqual(e.diff, [{ field: 'total_cost', from: '2', to: '4' }]);
  const r2 = await botPost('/api/bot/cardedit/reply', { id, i: 0, fileName: fbFile('Murkstalker'), before: jpegB64('b'), after: jpegB64('a') });
  assert.equal(r2.body['status'], 'applying');
  assert.equal((await page(bodyReq(DEE, {}), `/api/cardedit/edits/${id}/cancel`)).status, 409, 'posted: no cancel');
});

test('1519 §2 a posted affinity whose deck cannot be worked out turns the road steward, and back', async () => {
  const id = await submit('Air Plant', { cost: 'wb' });
  assert.equal(readEdit(id)!.road, 'fast', 'Light and Water has a deck: fast as submitted');
  const r = await seen(id, '$modify air plant|cost|rb');
  assert.equal(r.body['road'], 'steward');
  const e = readEdit(id)!;
  assert.equal(e.after.cost, 'rb');
  assert.deepEqual(e.why, ["its deck can't be worked out from the new affinity"]);
  assert.ok(e.events.some(ev => ev.what === 'reclassified' && ev['from'] === 'fast' && ev['to'] === 'steward'));
  await botPost('/api/bot/cardedit/reply', { id, i: 0, fileName: fbFile('Air_Plant'), before: jpegB64('b'), after: jpegB64('a') });
  const shown = (await page(bodyReq(DEE, {}, 'GET'), `/api/cardedit/edits/${id}`)).body;
  assert.deepEqual([shown['status'], shown['note']], ['steward', "queued for the steward: its deck can't be worked out from the new affinity"]);

  const back = await seen(id, '$modify air plant|cost|wb', 'm2');
  assert.equal(back.body['road'], 'fast', 're-posting the generated value');
  assert.equal(back.body['status'], 'waiting', 'a new value waits for a new picture');
  assert.deepEqual(readEdit(id)!.why, []);
});

test('1519 §3 a message that sets another field is refused and changes nothing', async () => {
  const id = await submit('Good Whale', { power: '5' });
  const r = await seen(id, '$modify good whale|text|Each opponent loses 9 life.');
  assert.equal(r.status, 409);
  const e = readEdit(id)!;
  assert.equal(e.commands[0]!.posted, null);
  assert.equal(e.road, 'fast');
  assert.equal((await seen(id, 'not a command at all')).status, 409);
  assert.equal(readEdit(id)!.events.length, 1, 'nothing recorded');
});
