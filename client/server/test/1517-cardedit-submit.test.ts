/* 1517 — submitting a card edit (POST /api/cardedit/edits) and what it writes.
 *
 * §1 refusals: an unlinked designer, a stale base, a `|`, nothing changed (also a change of
 *    notation only), an unknown card, and a second open edit on one card
 * §2 a good submit answers the commands and writes the record in the §3 shape
 * §3 the row route: the raw oracle row, its hash, read-only and the open edit
 * §4 cancel until a command is seen posted; then a new edit may start; who sees whose edits
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ORACLE_JSON } from '../../engine/scripts/paths.mjs';
import { editorFields, type OracleRow } from '../../ui/cardnotation.ts';
import { LINK_FIRST, isEditId, rowHash } from '../cardedit.ts';
import { cardEditsDir } from '../statepaths.ts';
import { account, bodyReq, botPost, page, silentReq } from './cardedit-fixture.ts';

const UNLINKED = account('Una', { designer: true });
const DEE = account('Dee', { designer: true, discord: '111' });
const OTHER = account('Otto', { designer: true, discord: '222' });
const ADMIN = account('Ops', { admin: true, discord: '333' });

const RAW = (JSON.parse(readFileSync(ORACLE_JSON, 'utf8')) as Record<string, OracleRow[]>)['Murkstalker']![0]!;
const HASH = rowHash(RAW);
const screen = (change: Record<string, string>): Record<string, string> =>
  ({ ...editorFields(RAW) as Record<string, string>, ...change });
const submit = (token: string, body: unknown) => page(bodyReq(token, body), '/api/cardedit/edits');

test('1517 §1 the submit refusals', async () => {
  const ok = { card: 'Murkstalker', rowHash: HASH, fields: screen({ 'total cost': '3' }) };
  const unlinked = await submit(UNLINKED, ok);
  assert.deepEqual([unlinked.status, unlinked.body['error']], [400, LINK_FIRST], 'unlinked: told to link first');
  assert.match(LINK_FIRST, /\/link/);

  const stale = await submit(DEE, { ...ok, rowHash: 'f'.repeat(40) });
  assert.equal(stale.status, 409, 'a stale base');
  assert.match(String(stale.body['error']), /has changed since you opened it/);

  const pipe = await submit(DEE, { ...ok, fields: screen({ text: 'Each opponent loses 1 life | and more.' }) });
  assert.equal(pipe.status, 400);
  assert.match(String(pipe.body['error']), /can't contain \|/);

  const same = await submit(DEE, { ...ok, fields: screen({}) });
  assert.deepEqual([same.status, same.body['error']], [400, 'Nothing changed.']);
  const notation = await submit(DEE, { ...ok, fields: screen({ type: 'Creature — Cosmic Horror' }) });
  assert.deepEqual([notation.status, notation.body['error']], [400, 'Nothing changed.'], 'a change of notation alone is no change');

  const nocard = await submit(DEE, { ...ok, card: 'No Such Card' });
  assert.equal(nocard.status, 404);

  const first = await submit(DEE, ok);
  assert.equal(first.status, 200, first.raw);
  const second = await submit(DEE, { ...ok, fields: screen({ power: '3' }) });
  assert.equal(second.status, 409, 'a second open edit on the same card');
  assert.equal(second.body['error'], 'Murkstalker has an edit in progress.');
  const byAnother = await submit(OTHER, { ...ok, fields: screen({ power: '3' }) });
  assert.equal(byAnother.status, 409, 'whoever submits it');
  await page(bodyReq(DEE, {}), `/api/cardedit/edits/${String(first.body['id'])}/cancel`);
});

test('1517 §2 a good submit answers its commands and writes the record', async () => {
  const r = await submit(DEE, { card: 'Murkstalker', rowHash: HASH, fields: screen({ 'total cost': '3', power: '4' }) });
  assert.equal(r.status, 200, r.raw);
  const id = String(r.body['id']);
  assert.ok(isEditId(id) && /^ce-\d{8}-murkstalker-[0-9a-f]{4}$/.test(id), id);
  assert.deepEqual(r.body, {
    ok: true, id, road: 'fast', why: [], status: 'submitted',
    commands: [
      { text: '$modify murkstalker|total cost|3', field: 'total cost' },
      { text: '$modify murkstalker|power|4', field: 'power' },
    ],
  });
  const rec = JSON.parse(readFileSync(join(cardEditsDir(), `${id}.json`), 'utf8')) as Record<string, unknown>;
  assert.deepEqual(Object.keys(rec).sort(),
    ['after', 'base', 'by', 'card', 'commands', 'createdAt', 'diff', 'edit', 'events', 'id', 'road', 'v', 'why'].sort());
  assert.deepEqual(rec['by'], { account: (rec['by'] as { account: string }).account, name: 'Dee', discord: '111' });
  assert.deepEqual(rec['base'], { rowHash: HASH, row: RAW });
  assert.deepEqual(rec['edit'], { 'total cost': '3', power: '4' });
  assert.deepEqual(rec['after'], { total_cost: '3', power: '4' });
  assert.deepEqual(rec['diff'], [{ field: 'total_cost', from: '2', to: '3' }, { field: 'power', from: '2', to: '4' }]);
  assert.deepEqual((rec['commands'] as unknown[])[0], { text: '$modify murkstalker|total cost|3', field: 'total cost', posted: null, reply: null });
  assert.deepEqual((rec['events'] as { what: string }[]).map(e => e.what), ['submitted']);

  const detail = await page(silentReq('GET', DEE).req, `/api/cardedit/edits/${id}`);
  assert.equal(detail.body['status'], 'submitted');
  assert.equal(detail.body['summary'], 'cost 2 → 3, power 2 → 4');
  await page(bodyReq(DEE, {}), `/api/cardedit/edits/${id}/cancel`);
});

test('1517 §3 the row route serves the raw oracle row, its hash and the open edit', async () => {
  const before = await page(silentReq('GET', DEE).req, '/api/cardedit/row?card=murkstalker');
  assert.deepEqual(before.body, { ok: true, card: 'Murkstalker', row: RAW, rowHash: HASH, readOnly: null, open: null });
  const r = await submit(DEE, { card: 'Murkstalker', rowHash: HASH, fields: screen({ toughness: '3' }) });
  const after = await page(silentReq('GET', OTHER).req, '/api/cardedit/row?card=Murkstalker');
  assert.equal(after.body['open'], r.body['id'], 'the open edit, whoever asks');
  await page(bodyReq(DEE, {}), `/api/cardedit/edits/${String(r.body['id'])}/cancel`);
  const missing = await page(silentReq('GET', DEE).req, '/api/cardedit/row?card=Nothing%20Here');
  assert.equal(missing.status, 404);
});

test('1517 §4 cancel until a command is posted; the author and admins see an edit, nobody else', async () => {
  const fields = screen({ 'total cost': '1' });
  const a = await submit(DEE, { card: 'Murkstalker', rowHash: HASH, fields });
  const id = String(a.body['id']);
  assert.equal((await page(silentReq('GET', OTHER).req, `/api/cardedit/edits/${id}`)).status, 404, 'another designer');
  assert.equal((await page(silentReq('GET', ADMIN).req, `/api/cardedit/edits/${id}`)).body['id'], id, 'an admin');
  const mine = (await page(silentReq('GET', DEE).req, '/api/cardedit/edits')).body['edits'] as { id: string }[];
  const all = (await page(silentReq('GET', ADMIN).req, '/api/cardedit/edits')).body['edits'] as { id: string; by: { name: string } }[];
  const theirs = (await page(silentReq('GET', OTHER).req, '/api/cardedit/edits')).body['edits'] as unknown[];
  assert.equal(mine[0]!.id, id, 'newest first');
  assert.ok(all.length >= mine.length && all.every(e => e.by.name === 'Dee'));
  assert.deepEqual(theirs, []);

  const c = await page(bodyReq(DEE, {}), `/api/cardedit/edits/${id}/cancel`);
  assert.equal(c.body['status'], 'cancelled');
  const again = await submit(DEE, { card: 'Murkstalker', rowHash: HASH, fields });
  assert.equal(again.status, 200, 'a cancelled edit is not in progress');
  const id2 = String(again.body['id']);
  const seen = await botPost('/api/bot/cardedit/seen', { id: id2, i: 0, messageId: 'm1', channelId: 'c1', content: '$modify murkstalker|total cost|1', at: '2026-11-27T18:03:00Z' });
  assert.equal(seen.status, 200, seen.raw);
  const late = await page(bodyReq(DEE, {}), `/api/cardedit/edits/${id2}/cancel`);
  assert.equal(late.status, 409, 'posted: too late to cancel');
});
