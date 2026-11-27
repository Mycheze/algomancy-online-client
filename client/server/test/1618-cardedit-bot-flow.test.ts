/* 1618 — an edit walked through the bot's routes, from submitted to live.
 *
 * §1 pending → seen → no answer → re-posted → answered → the wrong card refused →
 *    answered: waiting for FriendlyBot, then applying; the pictures and the index follow
 * §2 a repeated reply only updates; a reply for a command never seen is refused
 * §3 the runner's row says testing, and the build's Card-Edit trailer says live
 * §4 a reply carrying two full-size renders fits the route's body cap
 * §5 a new value re-posted after FriendlyBot answered waits for its own answer, and leaves
 *    the index meanwhile; once the home box has the edit, a new value is refused and noted
 * §6 a complexity command is answered with one line and no picture
 * §7 the bot's replay of its channel after a restart changes nothing, before pickup or after
 * §8 a designer with no linked Discord: pending says discord null, and the bot path completes
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { editorFields } from '../../ui/cardnotation.ts';
import { NO_ANSWER_NOTE, POSTED_LATE, appendRunnerRow, oracleRow, readEdit, rowHash, useLiveEditIds } from '../cardedit.ts';
import { cardEditsDir } from '../statepaths.ts';
import { account, bodyReq, botGet, botPost, fbFile, jpegB64, page, silentReq } from './cardedit-fixture.ts';

const DEE = account('Dee', { designer: true, discord: '111' });
const ROW = oracleRow('Murkstalker')!;
const status = async (id: string): Promise<{ status: unknown; note: unknown }> => {
  const d = (await page(silentReq('GET', DEE).req, `/api/cardedit/edits/${id}`)).body;
  return { status: d['status'], note: d['note'] };
};
const index = (): unknown => JSON.parse(readFileSync(join(cardEditsDir(), 'index.json'), 'utf8'));
const picture = (id: string, which: string): string => readFileSync(join(cardEditsDir(), id, `${which}.jpg`)).toString('base64');
const MURK = fbFile('Murkstalker');
let ID = '';

test('1618 §1 from submitted through waiting for FriendlyBot to applying', async () => {
  const fields = { ...editorFields(ROW), 'total cost': '3', power: '3' };
  const sub = await page(bodyReq(DEE, { card: 'Murkstalker', rowHash: rowHash(ROW), fields }), '/api/cardedit/edits');
  ID = String(sub.body['id']);
  assert.deepEqual(await status(ID), { status: 'submitted', note: null });

  const pending = await botGet('/api/bot/cardedit/pending');
  assert.deepEqual(pending.body, {
    ok: true,
    edits: [{
      id: ID, card: 'Murkstalker', discord: '111', since: (pending.body['edits'] as { since: string }[])[0]!.since,
      commands: [
        { i: 0, text: '$modify murkstalker|total cost|3', field: 'total cost', posted: false, done: false },
        { i: 1, text: '$modify murkstalker|power|3', field: 'power', posted: false, done: false },
      ],
    }],
  });

  const seen0 = { id: ID, i: 0, messageId: 'm1', channelId: 'c1', content: '$modify murkstalker|total cost|3', at: '2026-11-27T18:03:00Z' };
  assert.equal((await botPost('/api/bot/cardedit/seen', seen0)).status, 200);
  assert.deepEqual(await status(ID), { status: 'waiting', note: null });
  const p1 = (await botGet('/api/bot/cardedit/pending')).body['edits'] as Record<string, unknown>[];
  assert.equal(p1[0]!['channelHint'], 'c1');
  assert.deepEqual((p1[0]!['commands'] as { posted: boolean }[]).map(c => c.posted), [true, false]);

  await botPost('/api/bot/cardedit/reply', { id: ID, i: 0, noAnswer: true, at: '2026-11-27T18:04:00Z' });
  assert.deepEqual(await status(ID), { status: 'waiting', note: NO_ANSWER_NOTE });
  await botPost('/api/bot/cardedit/seen', { ...seen0, messageId: 'm2', at: '2026-11-27T18:05:00Z' });
  assert.deepEqual(await status(ID), { status: 'waiting', note: null }, 'a re-post clears the no-answer note');

  const r0 = await botPost('/api/bot/cardedit/reply', {
    id: ID, i: 0, echo: "Modified murkstalker's total cost from this", fileName: MURK,
    before: jpegB64('B0'), after: jpegB64('A0'), at: '2026-11-27T18:05:10Z',
  });
  assert.equal(r0.status, 200, r0.raw);
  assert.equal(picture(ID, 'before'), jpegB64('B0'));
  assert.equal(picture(ID, 'after'), jpegB64('A0'));
  assert.deepEqual(index(), { v: 1, edits: [] }, 'not ready while a command waits');

  await botPost('/api/bot/cardedit/seen', { id: ID, i: 1, messageId: 'm3', channelId: 'c1', content: '$modify murkstalker|power|3', at: '2026-11-27T18:06:00Z' });
  const wrong = await botPost('/api/bot/cardedit/reply', {
    id: ID, i: 1, fileName: fbFile('Blights_End'), before: jpegB64('X'), after: jpegB64('Y'), at: '2026-11-27T18:06:10Z',
  });
  assert.equal(wrong.status, 409, 'a reply for another card');
  assert.equal(wrong.body['error'], 'FriendlyBot changed a different card: Blights End');
  assert.deepEqual(await status(ID), { status: 'waiting', note: 'FriendlyBot changed a different card: Blights End' });
  assert.equal(picture(ID, 'after'), jpegB64('A0'), 'the wrong card stored nothing');

  const r1 = await botPost('/api/bot/cardedit/reply', {
    id: ID, i: 1, echo: "Modified murkstalker's power from this", fileName: MURK,
    before: jpegB64('B1'), after: jpegB64('A1'), at: '2026-11-27T18:06:30Z',
  });
  assert.deepEqual(r1.body, { ok: true, road: 'fast', status: 'applying', note: 'waiting for the home box' });
  assert.equal(picture(ID, 'before'), jpegB64('B0'), 'before: the first command\'s from-this');
  assert.equal(picture(ID, 'after'), jpegB64('A1'), 'after: the newest render');
  assert.deepEqual(index(), { v: 1, edits: [{ id: ID, card: 'Murkstalker', road: 'fast', pictures: true }] });
  const still = (await botGet('/api/bot/cardedit/pending')).body['edits'] as { id: string; commands: { posted: boolean; done: boolean }[] }[];
  assert.deepEqual(still.map(e => [e.id, e.commands.map(c => [c.posted, c.done])]), [[ID, [[true, true], [true, true]]]],
    'answered, and still watched until the home box takes it');

  const img = await page(silentReq('GET', DEE).req, `/api/cardedit/edits/${ID}/image/after`);
  assert.equal(img.type, 'image/jpeg');
  assert.equal(img.bytes.toString('base64'), jpegB64('A1'));
  const d = (await page(silentReq('GET', DEE).req, `/api/cardedit/edits/${ID}`)).body;
  assert.deepEqual(d['pictures'], { before: true, after: true });
  assert.deepEqual(d['commands'], [
    { text: '$modify murkstalker|total cost|3', field: 'total cost', posted: '$modify murkstalker|total cost|3', answered: true },
    { text: '$modify murkstalker|power|3', field: 'power', posted: '$modify murkstalker|power|3', answered: true },
  ]);
});

test('1618 §2 a repeated reply only updates; a reply before the command was seen is refused', async () => {
  const again = await botPost('/api/bot/cardedit/reply', {
    id: ID, i: 1, fileName: MURK, before: jpegB64('B1'), after: jpegB64('A1'), at: '2026-11-27T18:06:30Z',
  });
  assert.equal(again.body['status'], 'applying');
  const late = await botPost('/api/bot/cardedit/reply', { id: ID, i: 0, noAnswer: true, at: '2026-11-27T18:07:00Z' });
  assert.equal(late.body['status'], 'applying', 'a later silence does not undo a caught answer');
  assert.equal(picture(ID, 'after'), jpegB64('A1'));
  // the same first command posted again: FriendlyBot's from-this now already shows the edit
  await botPost('/api/bot/cardedit/seen', { id: ID, i: 0, messageId: 'm9', channelId: 'c1', content: '$modify murkstalker|total cost|3', at: '2026-11-27T18:08:00Z' });
  const repost = await botPost('/api/bot/cardedit/reply', {
    id: ID, i: 0, fileName: MURK, before: jpegB64('B0-again'), after: jpegB64('A0-again'), at: '2026-11-27T18:08:10Z',
  });
  assert.equal(repost.body['status'], 'applying', 'the same value keeps its answer');
  assert.equal(picture(ID, 'before'), jpegB64('B0'), 'before stays the card as it was before the edit');
  assert.equal(picture(ID, 'after'), jpegB64('A0-again'), 'after is the newest render, which carries every change');
  await botPost('/api/bot/cardedit/reply', {
    id: ID, i: 1, fileName: MURK, before: jpegB64('B1'), after: jpegB64('A1'), at: '2026-11-27T18:06:30Z',
  });
  assert.equal(picture(ID, 'after'), jpegB64('A0-again'), 'an older answer arriving late does not replace a newer render');
  const nobody = await botPost('/api/bot/cardedit/reply', { id: 'ce-20261127-murkstalker-0000', i: 0, noAnswer: true });
  assert.equal(nobody.status, 404);

  const fields = { ...editorFields(oracleRow('Good Whale')!), power: '8' };
  const other = await page(bodyReq(DEE, { card: 'Good Whale', rowHash: rowHash(oracleRow('Good Whale')), fields }), '/api/cardedit/edits');
  const early = await botPost('/api/bot/cardedit/reply', {
    id: other.body['id'], i: 0, fileName: fbFile('Good_Whale'), before: jpegB64('b'), after: jpegB64('a'),
  });
  assert.equal(early.status, 409, 'no command seen posted yet');
  const badPic = await botPost('/api/bot/cardedit/seen', { id: other.body['id'], i: 0, messageId: 'w1', channelId: 'c1', content: '$modify good whale|power|8' });
  assert.equal(badPic.status, 200);
  const notJpeg = await botPost('/api/bot/cardedit/reply', {
    id: other.body['id'], i: 0, fileName: fbFile('Good_Whale'), before: Buffer.from('GIF89a').toString('base64'), after: jpegB64('a'),
  });
  assert.equal(notJpeg.status, 400, 'only JPEG pictures');
});

test('1618 §3 the runner says testing, and the build carrying the trailer says live', async () => {
  appendRunnerRow(ID, 'picked');
  assert.deepEqual(await status(ID), { status: 'applying', note: 'testing' });
  assert.deepEqual(index(), { v: 1, edits: [{ id: ID, card: 'Murkstalker', road: 'fast', pictures: true }] }, 'picked stays in the index');
  const watched = (await botGet('/api/bot/cardedit/pending')).body['edits'] as { id: string }[];
  assert.ok(!watched.some(e => e.id === ID), 'taken by the home box: no longer watched');
  appendRunnerRow(ID, 'landed');
  assert.deepEqual(index(), { v: 1, edits: [] }, 'landed leaves it');
  useLiveEditIds([ID]);
  try {
    assert.deepEqual(await status(ID), { status: 'live', note: null });
    const row = await page(silentReq('GET', DEE).req, '/api/cardedit/row?card=Murkstalker');
    assert.equal(row.body['open'], null, 'a live edit is not in progress');
  } finally {
    useLiveEditIds([]);
  }
});

test('1618 §4 two full-size renders fit the reply route', async () => {
  const fields = { ...editorFields(oracleRow('Dune Drifter')!), toughness: '3' };
  const sub = await page(bodyReq(DEE, { card: 'Dune Drifter', rowHash: rowHash(oracleRow('Dune Drifter')), fields }), '/api/cardedit/edits');
  const id = sub.body['id'];
  await botPost('/api/bot/cardedit/seen', { id, i: 0, messageId: 'd1', channelId: 'c1', content: '$modify dune drifter|toughness|3' });
  const big = jpegB64('x'.repeat(300 * 1024));
  const r = await botPost('/api/bot/cardedit/reply', { id, i: 0, fileName: fbFile('Dune_Drifter'), before: big, after: big });
  assert.equal(r.status, 200, r.raw.slice(0, 200));
  assert.equal(r.body['status'], 'applying');
});

async function submitOn(card: string, change: Record<string, string>): Promise<string> {
  const row = oracleRow(card)!;
  const r = await page(bodyReq(DEE, { card, rowHash: rowHash(row), fields: { ...editorFields(row), ...change } }), '/api/cardedit/edits');
  assert.equal(r.status, 200, r.raw);
  return String(r.body['id']);
}
const inIndex = (id: string): boolean => (index() as { edits: { id: string }[] }).edits.some(e => e.id === id);
interface Pending { id: string; commands: { posted: boolean; done: boolean }[] }
const pendingOf = async (id: string): Promise<Pending | undefined> =>
  ((await botGet('/api/bot/cardedit/pending')).body['edits'] as Pending[]).find(e => e.id === id);
const flags = (p: Pending | undefined): [boolean, boolean][] => (p?.commands ?? []).map(c => [c.posted, c.done]);

test('1618 §5 a tweaked re-post after the answer waits for its own answer; after pickup it is refused', async () => {
  const id = await submitOn('Angel of Anguish', { 'total cost': '3' });
  const post = (messageId: string, value: string, at: string) => botPost('/api/bot/cardedit/seen',
    { id, i: 0, messageId, channelId: 'c1', content: `$modify angel of anguish|total cost|${value}`, at });
  const answer = (tag: string, at: string) => botPost('/api/bot/cardedit/reply',
    { id, i: 0, fileName: fbFile('Angel_of_Anguish'), before: jpegB64(`b${tag}`), after: jpegB64(`a${tag}`), at });
  await post('p1', '3', '2026-11-27T19:01:00Z');
  assert.equal((await answer('3', '2026-11-27T19:01:10Z')).body['status'], 'applying');
  assert.ok(inIndex(id));
  assert.deepEqual(flags(await pendingOf(id)), [[true, true]], 'answered, and still watched');

  const tweak = await post('p2', '5', '2026-11-27T19:02:00Z');
  assert.equal(tweak.status, 200);
  assert.equal(tweak.body['status'], 'waiting', 'the old answer was for the old value');
  assert.deepEqual(readEdit(id)!.after, { total_cost: '5' });
  assert.equal(inIndex(id), false, 'not offered to the home box while the new value waits');
  assert.deepEqual(flags(await pendingOf(id)), [[true, false]]);
  assert.equal((await answer('5', '2026-11-27T19:02:10Z')).body['status'], 'applying');
  assert.ok(inIndex(id));
  assert.equal((await post('p3', '5', '2026-11-27T19:03:00Z')).body['status'], 'applying', 'the same value again keeps its answer');

  appendRunnerRow(id, 'picked');
  assert.equal(await pendingOf(id), undefined, 'taken by the home box: no longer watched');
  const late = await post('p4', '6', '2026-11-27T19:04:00Z');
  assert.deepEqual([late.status, late.body['error']], [409, POSTED_LATE]);
  const e = readEdit(id)!;
  assert.deepEqual(e.after, { total_cost: '5' }, 'what the home box took is unchanged');
  assert.ok(e.events.some(ev => ev.what === 'posted-late' && ev['content'] === '$modify angel of anguish|total cost|6'));
  const shown = (await page(silentReq('GET', DEE).req, `/api/cardedit/edits/${id}`)).body;
  assert.deepEqual([shown['status'], shown['note']], ['applying', POSTED_LATE]);
  assert.equal((await post('p3', '5', '2026-11-27T19:03:00Z')).status, 200, 'a repeat of the value taken is harmless');
});

test('1618 §6 a complexity command is answered with its one line and needs no picture', async () => {
  const row = oracleRow('Arbiter of Armistice')!;
  const want = row.complexity === 'Simple' ? 'Complex' : 'Simple';
  const id = await submitOn('Arbiter of Armistice', { complexity: want });
  const verb = `$${want.toLowerCase()} arbiter of armistice`;
  assert.equal(readEdit(id)!.road, 'steward');
  assert.equal(readEdit(id)!.commands[0]!.text, verb);
  await botPost('/api/bot/cardedit/seen', { id, i: 0, messageId: 'x1', channelId: 'c1', content: verb, at: '2026-11-27T19:59:00Z' });
  const other = await botPost('/api/bot/cardedit/reply', { id, i: 0, echo: `Set the complexity of arbiter of armistice to ${row.complexity}`, at: '2026-11-27T20:00:00Z' });
  assert.equal(other.status, 409, 'an answer naming the other value');
  const r = await botPost('/api/bot/cardedit/reply', { id, i: 0, echo: `Set the complexity of arbiter of armistice to ${want}`, at: '2026-11-27T20:00:05Z' });
  assert.deepEqual(r.body, { ok: true, road: 'steward', status: 'steward', note: 'queued for the steward: the complexity changed' });
  assert.deepEqual((index() as { edits: { id: string }[] }).edits.find(x => x.id === id),
    { id, card: 'Arbiter of Armistice', road: 'steward', pictures: false });
  const d = (await page(silentReq('GET', DEE).req, `/api/cardedit/edits/${id}`)).body;
  assert.deepEqual(d['pictures'], { before: false, after: false });
  assert.equal((d['commands'] as { answered: boolean }[])[0]!.answered, true);
  assert.deepEqual(flags(await pendingOf(id)), [[true, true]]);

  const numbers = await submitOn('Abyssal Extortionist', { power: '9' });
  await botPost('/api/bot/cardedit/seen', { id: numbers, i: 0, messageId: 'x2', channelId: 'c1', content: '$modify abyssal extortionist|power|9' });
  const noPicture = await botPost('/api/bot/cardedit/reply', { id: numbers, i: 0, echo: 'Set the complexity of abyssal extortionist to Complex' });
  assert.equal(noPicture.status, 400, 'only a complexity command may be answered without a picture');
});

test('1618 §7 a restarted bot replaying the channel changes nothing, before pickup or after', async () => {
  const id = await submitOn('Amphivore', { toughness: '4' });
  const seen = (messageId: string, value: string, at: string) => botPost('/api/bot/cardedit/seen',
    { id, i: 0, messageId, channelId: 'c1', content: `$modify amphivore|toughness|${value}`, at });
  const answer = (tag: string, at: string, card = 'Amphivore') => botPost('/api/bot/cardedit/reply',
    { id, i: 0, fileName: fbFile(card), before: jpegB64(`b${tag}`), after: jpegB64(`a${tag}`), at });
  const silent = () => botPost('/api/bot/cardedit/reply', { id, i: 0, noAnswer: true, at: '2026-11-27T21:01:30Z' });
  const channel = [
    () => seen('q1', '4', '2026-11-27T21:01:00Z'), silent,
    () => seen('q2', '4', '2026-11-27T21:02:00Z'), () => answer('wrong', '2026-11-27T21:02:05Z', 'Blights_End'),
    () => seen('q3', '4', '2026-11-27T21:03:00Z'), () => answer('4', '2026-11-27T21:03:05Z'),
    () => seen('q4', '6', '2026-11-27T21:04:00Z'), () => answer('6', '2026-11-27T21:04:05Z'),
  ];
  for (const step of channel) await step();
  const held = JSON.stringify(readEdit(id));
  assert.equal(picture(id, 'after'), jpegB64('a6'));
  assert.deepEqual(await status(id), { status: 'applying', note: 'waiting for the home box' });

  for (const step of channel) await step();
  assert.equal(JSON.stringify(readEdit(id)), held, 'the replay added no event and moved no value');
  assert.equal(picture(id, 'before'), jpegB64('b4'));
  assert.equal(picture(id, 'after'), jpegB64('a6'));
  assert.deepEqual(await status(id), { status: 'applying', note: 'waiting for the home box' });

  appendRunnerRow(id, 'picked');
  for (const step of channel) await step();
  assert.equal(JSON.stringify(readEdit(id)), held, 'an earlier value replayed after pickup is not a late post');
  assert.deepEqual(await status(id), { status: 'applying', note: 'testing' });
});

test('1618 §8 an unlinked designer: pending carries discord null and the bot path completes', async () => {
  const UNA = account('Una', { designer: true });
  const row = oracleRow('Flamebreath Initiate')!;
  const sub = await page(bodyReq(UNA, { card: row.name, rowHash: rowHash(row), fields: { ...editorFields(row), toughness: '4' } }), '/api/cardedit/edits');
  assert.equal(sub.status, 200, sub.raw);
  const id = String(sub.body['id']);
  const listed = ((await botGet('/api/bot/cardedit/pending')).body['edits'] as Record<string, unknown>[]).find(e => e['id'] === id)!;
  assert.ok('discord' in listed, 'the key stays');
  assert.equal(listed['discord'], null);

  const seen = await botPost('/api/bot/cardedit/seen',
    { id, i: 0, messageId: 'u1', channelId: 'c1', content: '$modify flamebreath initiate|toughness|4', at: '2026-11-27T22:00:00Z' });
  assert.equal(seen.status, 200, seen.raw);
  const r = await botPost('/api/bot/cardedit/reply', {
    id, i: 0, echo: "Modified flamebreath initiate's toughness from this", fileName: fbFile('Flamebreath_Initiate'),
    before: jpegB64('bu'), after: jpegB64('au'), at: '2026-11-27T22:00:06Z',
  });
  assert.deepEqual(r.body, { ok: true, road: 'fast', status: 'applying', note: 'waiting for the home box' });
  assert.ok(inIndex(id), 'offered to the home box like any other');
  const d = (await page(silentReq('GET', UNA).req, `/api/cardedit/edits/${id}`)).body;
  assert.deepEqual([d['status'], d['pictures']], ['applying', { before: true, after: true }]);
});
