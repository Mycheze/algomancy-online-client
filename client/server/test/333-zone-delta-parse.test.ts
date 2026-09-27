/* CARD STATS §4 — READING THE R191 REFS BACK.
 *
 * Every saved game since R191 carries one reference key per action, and its
 * tail — the zone delta — names in card names what the action moved through
 * the actor's own zones. For a game that predates the card log and no longer
 * replays, that text is the only record of what was played, picked and
 * recycled that no rules change can move (cardledger.ts, the `refs` rung).
 * The format is frozen by the files already on disk; these are real strings
 * off the deployment's games.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRef, parseZoneDelta } from '../zonedelta.ts';

test('a draft commit: what went back to the pack, what was taken, what was given', () => {
  const p = parseRef('draftCommit|6:"Colony of the Interworld",7:"Insatiable Want",9:"Pallid Gorger",10:"Burn the Blight",11:"Suppression Field",12:"Download",13:"Buffer Overflow",14:"Exhume",15:"Cthyrian Rector",3:"Finality"|-1h:Finality,+1h:Refuse Reclaimer');
  assert.equal(p.type, 'draftCommit');
  assert.equal(p.named.length, 10);
  assert.deepEqual(p.indexed[9], [3, 'Finality']);
  assert.deepEqual(p.delta, [{ k: -1, z: 'h', card: 'Finality' }, { k: 1, z: 'h', card: 'Refuse Reclaimer' }]);
});

test('plays, recycles, bottoms and mods name their card', () => {
  assert.deepEqual(parseRef('recycleForResource|2:"Cthyrian Culler"|metal|-1h:Cthyrian Culler').named, ['Cthyrian Culler']);
  assert.deepEqual(parseRef('playCard|2:"Eldritch Dreamtender"|-|-1h:Eldritch Dreamtender').named, ['Eldritch Dreamtender']);
  assert.deepEqual(parseRef('augment|hand|3:"Vroot"|t35#1|-|-1h:Vroot').named, ['Vroot']);
  assert.deepEqual(parseRef('graft|bin|2:"Technological Superiority"|t37#1|0|-1b:Technological Superiority').delta,
    [{ k: -1, z: 'b', card: 'Technological Superiority' }]);
  assert.deepEqual(parseRef('bottomCards|5:"Wither and Bloom",1:"Reforge the Dead"|-1h:Reforge the Dead,-1h:Wither and Bloom').named,
    ['Wither and Bloom', 'Reforge the Dead']);
});

test('actions that name no card, and multiplicities above one', () => {
  const pass = parseRef('passPriority|');
  assert.deepEqual([pass.type, pass.named, pass.delta], ['passPriority', [], []]);
  const d = parseRef('decide|assignDamage|3|default — share front-to-back (1 to Robot, 1 to Flzzz)/|+1b:Murkstalker,+1b:Skittering Blight');
  assert.deepEqual(d.named, [], 'a decision\'s label is not a card, even when it has a colon in it');
  assert.equal(d.delta.length, 2);
  assert.deepEqual(parseZoneDelta('+2h:Jelly,-1b:Jelly'), [{ k: 2, z: 'h', card: 'Jelly' }, { k: -1, z: 'b', card: 'Jelly' }]);
});

test('a cache entry is JSON, commas and all, and still splits cleanly', () => {
  const tail = '-1h:Lonely Forager,+1c:{"card":"Lonely Forager","uid":41,"prophecy":{"a":1,"b":2}},+1h:Recall';
  assert.deepEqual(parseZoneDelta(tail), [
    { k: -1, z: 'h', card: 'Lonely Forager' },
    { k: 1, z: 'c', card: 'Lonely Forager' },
    { k: 1, z: 'h', card: 'Recall' },
  ]);
});
