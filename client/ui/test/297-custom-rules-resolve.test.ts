/* BL-43 — custom rules: turning what the creator chose into a deal.
 *
 * ui/customrules.ts runs twice for every custom room — on the home screen for
 * the live preview, and on the server for the answer that counts — and it
 * runs ONCE per room: the deal it produces is what every later re-deal reads.
 * So it is tested here on its own, against the real catalogue.
 *
 * The owner asked that "Simple cards only" be its own control, not a preset of
 * the card filter. §4 holds both halves of that: the two reach the same cards
 * by different roads, and they stay different rules.
 *
 * Titles carry no apostrophes: ledger guards cite them by substring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BEGINNER_RULES, checkCustomRules, elementSets, MAX_QUERY_LENGTH, poolCheck, resolveCustomRules,
  rulesSummary, sanitizeCustomRules, STANDARD_RULES, type CustomRules,
} from '../customrules.ts';
import { rowFor } from '../cardindex.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { draftPool } from '../../engine/src/draftdeal.ts';

const rules = (over: Partial<CustomRules>): CustomRules => ({ ...STANDARD_RULES, ...over });
const excludedBy = (r: CustomRules): string[] => resolveCustomRules(r).deal?.excluded ?? [];
const nonSimple = (): string[] => DECK_LIST.filter(n => rowFor(n)?.complexityLc !== 'simple');

test('BL-43 resolve §1 every deck card has a catalogue row, and the pool has both simple and complex cards', () => {
  assert.deepEqual(DECK_LIST.filter(n => !rowFor(n)), [], 'a deck card without a row would be silently excluded by Simple cards only');
  const values = new Set(DECK_LIST.map(n => rowFor(n)!.complexityLc));
  assert.ok(values.has('simple') && values.has('complex'), `complexity values: ${[...values].join(', ')}`);
});

test('BL-43 resolve §2 sanitizeCustomRules: the standard game is null, knobs clamp, bans and filter are cleaned', () => {
  assert.equal(sanitizeCustomRules(undefined), null);
  assert.equal(sanitizeCustomRules('beginner'), null);
  assert.equal(sanitizeCustomRules(STANDARD_RULES), null);
  assert.equal(sanitizeCustomRules({ ...STANDARD_RULES, preset: 'beginner' }), null, 'a preset name alone does not make a game custom');
  assert.deepEqual(sanitizeCustomRules(BEGINNER_RULES), BEGINNER_RULES);
  assert.equal(sanitizeCustomRules(rules({ packSize: 40 }))!.packSize, 15);
  const [a, b] = [DECK_LIST[3]!, DECK_LIST[9]!];
  assert.deepEqual(sanitizeCustomRules(rules({ bans: [b, 'Not A Card', a, b] }))!.bans, [b, a], 'unknown dropped, duplicates collapsed, order kept');
  assert.equal(sanitizeCustomRules(rules({ bans: ['Not A Card'] })), null, 'a ban on nothing is no rule');
  assert.equal(sanitizeCustomRules(rules({ query: '  e:fire  ' }))!.query, 'e:fire');
  assert.equal(sanitizeCustomRules(rules({ query: 'x'.repeat(1000) }))!.query.length, MAX_QUERY_LENGTH);
});

test('BL-43 resolve §3 Simple cards only leaves out exactly the cards that are not simple', () => {
  const out = excludedBy(rules({ simpleOnly: true }));
  assert.ok(out.length > 0 && out.length < DECK_LIST.length, `non-vacuous: ${out.length} of ${DECK_LIST.length} left out`);
  assert.deepEqual(out, nonSimple());
});

test('BL-43 resolve §4 Simple cards only and the filter rarity:simple reach the same cards but stay separate rules', () => {
  const toggle = rules({ simpleOnly: true });
  const filter = rules({ query: 'rarity:simple' });
  assert.deepEqual(excludedBy(filter), excludedBy(toggle), 'two independent roads to the same pool');
  assert.deepEqual(rulesSummary(toggle), ['Simple cards only']);
  assert.deepEqual(rulesSummary(filter), ['Card filter: rarity:simple']);
});

test('BL-43 resolve §5 bans and the card filter add up', () => {
  const lightdark = DECK_LIST.filter(n => rowFor(n)!.release === 'lightdark');
  const ban = DECK_LIST.find(n => rowFor(n)!.release !== 'lightdark')!;
  const out = excludedBy(rules({ query: '-set:lightdark', bans: [ban] }));
  assert.equal(out.length, lightdark.length + 1);
  assert.ok(out.includes(ban) && lightdark.every(n => out.includes(n)));
});

test('BL-43 resolve §6 a card filter the parser had to guess at is refused, not guessed', () => {
  for (const query of ['(fire', 'zzz:1']) {
    const r = resolveCustomRules(rules({ query }));
    assert.ok(r.errors.length > 0, `${query} reports an error`);
    const verdict = checkCustomRules(rules({ query }));
    assert.match(verdict.error ?? '', /^Card filter:/, `${query} is refused with the reason`);
  }
});

test('BL-43 resolve §7 the beginner preset clears the floor for every pair, and fire + wood has 86 cards', () => {
  const { deal } = resolveCustomRules(BEGINNER_RULES);
  assert.ok(deal);
  const sizes = elementSets(2).map(els => draftPool(els, deal).length);
  assert.equal(sizes.length, 21);
  const check = poolCheck(deal);
  assert.equal(check.floor, 44);
  assert.ok(check.ok, check.message);
  assert.equal(check.worst.size, Math.min(...sizes));
  assert.ok(sizes.every(s => s >= check.floor));
  assert.equal(poolCheck(deal, ['wood', 'fire']).worst.size, 86);
  assert.equal(checkCustomRules(BEGINNER_RULES).error, undefined);
});

test('BL-43 resolve §8 too small a pool is refused with a message that names the fix', () => {
  const tight = rules({ elements: 2, simpleOnly: true });   // packs of 10: needs 64
  const open = checkCustomRules(tight);
  assert.equal(open.check?.floor, 64);
  assert.ok(open.check && !open.check.ok);
  assert.match(open.error ?? '', /would leave only \d+ cards and these rules need 64\. Choose the elements now/);
  assert.equal(checkCustomRules(tight, ['fire', 'wood']).error, undefined, 'fixing fire + wood (86) is enough');

  const hopeless = checkCustomRules(rules({ elements: 2, simpleOnly: true, packSize: 15, openingHand: 15 }));
  assert.match(hopeless.error ?? '', /^No choice of 2 elements leaves enough cards/);
});

test('BL-43 resolve §9 the standard deal passes its own check for every trio', () => {
  const check = poolCheck(undefined);
  assert.ok(check.ok);
  assert.equal(check.floor, 64);
  assert.equal(elementSets(3).length, 35);
  assert.deepEqual(checkCustomRules(STANDARD_RULES), { rules: null });
});

test('BL-43 resolve §10 the summary lists only what changed', () => {
  assert.deepEqual(rulesSummary(BEGINNER_RULES), ['2 elements', 'Packs of 5', 'Simple cards only']);
  assert.deepEqual(
    rulesSummary(rules({ startingLife: 20, draftDraw: 1, openingHand: 4, bans: [DECK_LIST[0]!] })),
    ['Opening hand of 4', 'Draw 1 a turn', '20 starting life', `Banned: ${DECK_LIST[0]}`],
  );
});
