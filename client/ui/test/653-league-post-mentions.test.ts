/* The organizer's "Post for Discord" names each player by their Discord name
 * as an @mention, so pasting it pings them (owner, 2026-10-25: "so that I
 * don't need to go manually through").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postText } from '../league.ts';

type View = Parameters<typeof postText>[0];
const person = (name: string, contact: string | null) => ({ id: name, name, contact });
function week(contacts: [string | null, string | null]): View {
  return {
    id: 's', name: 'October 2026', phase: 1, label: 'Week 1 of 3', weeks: 3, perWeek: 3, lateUntil: 2,
    signupOpens: '2026-10-04T07:00:00Z', start: '2026-10-11T07:00:00Z', auto: true, hold: false, hidden: false,
    phases: [{ phase: 2, label: 'Week 2 of 3', at: '2026-10-18T07:00:00Z' }],
    entrants: [], standings: [], champion: null, me: null,
    matches: [{ id: 'm', week: 1, final: false, result: null, room: null,
      a: person('Gember', contacts[0]), b: person('Ann', contacts[1]) }],
  } as unknown as View;
}

test('⭐ the week\'s post @mentions each player by their Discord name', () => {
  const post = postText(week(['gember', 'ann.s']), 'https://x');
  assert.match(post, /• \*\*Gember\*\* \(@gember\) vs \*\*Ann\*\* \(@ann\.s\)/);
});

test('a Discord name typed with its @ gets one, not two; no name, no mention', () => {
  const post = postText(week(['@gember', null]), 'https://x');
  assert.match(post, /\(@gember\)/);
  assert.doesNotMatch(post, /@@/);
  assert.match(post, /vs \*\*Ann\*\*$/m, 'a player with no Discord name is just their name');
});
