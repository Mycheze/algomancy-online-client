/* 1462 — a seated player's page does not reload onto a newer bundle while the game is live. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { client } from './ui-driver.ts';

const ui = await client();
const { installBuildCheck } = await import('../build.ts');

test('seated in a live game, the newer bundle waits', () => {
  let reloads = 0;
  (location as unknown as { reload: () => void }).reload = () => { reloads++; };
  installBuildCheck({ own: 'aaaaaaaaaaaa' });
  const state = new Harness(1).state;
  const joined = { t: 'joined', seat: 0, view: state, log: [], legal: [], peers: [true, true], names: ['Ann', 'Bo'] };
  ui.push(joined);
  ui.push({ ...joined, build: 'bbbbbbbbbbbb' });
  assert.equal(reloads, 0);
});
