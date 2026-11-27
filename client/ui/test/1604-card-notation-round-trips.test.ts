/* 1604 · THE CARD EDITOR'S NOTATION ROUND-TRIPS EVERY CARD (ui/cardnotation.ts)
 *
 *  §1 for every card the editor opens, our row → Caleb's fields → our row is the row
 *  §2 the cards it opens read-only are exactly the pinned list, each with its reason
 *  §3 "Creature" never reaches the screen; the command says it, as FriendlyBot stores it
 *  §4 every type-line shape in the pool, in all three spellings
 *  §5 light and dark pips swap inside cost brackets only
 *  §6 the read-only reasons fire
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ORACLE_JSON } from '../../engine/scripts/paths.mjs';
import {
  EDITOR_FIELDS, ORACLE_FIELD, commandsFor, editable, editorFields, isUnitType, oracleValues, valueFromCommand,
  type OracleRow,
} from '../cardnotation.ts';

const ORACLE = JSON.parse(readFileSync(ORACLE_JSON, 'utf8')) as Record<string, OracleRow[]>;
const ROWS = Object.values(ORACLE).map(v => v[0]!);
const row = (name: string): OracleRow => ORACLE[name]![0]!;

/** Cards the editor opens read-only, and why. Empty: every card in the pool round-trips. */
const READ_ONLY: Record<string, string> = {};

test('§1 for every editable card, our row to the screen and back is the row, field for field', () => {
  let checked = 0;
  for (const r of ROWS) {
    if (editable(r)) continue;
    const screen = editorFields(r);
    const back = oracleValues(screen);
    for (const f of EDITOR_FIELDS) {
      const o = ORACLE_FIELD[f];
      if ((f === 'power' || f === 'toughness') && !isUnitType(r.type)) {
        assert.equal(screen[f], undefined, `${r.name}: ${f} shown on a card that is not a unit`);
        continue;
      }
      assert.equal(back[o], r[o], `${r.name}: ${o} ${JSON.stringify(r[o])} came back as ${JSON.stringify(back[o])}`);
      checked++;
    }
  }
  assert.ok(checked > 3500, `only ${checked} fields walked`);
});

test('§2 the read-only cards are exactly the pinned list', () => {
  const locked: Record<string, string> = {};
  for (const r of ROWS) {
    const why = editable(r);
    if (why) locked[r.name] = why;
  }
  assert.deepEqual(locked, READ_ONLY);
});

test('§3 Creature never reaches the screen, and every unit command says it', () => {
  for (const r of ROWS) {
    const screen = editorFields(r);
    for (const f of EDITOR_FIELDS) assert.doesNotMatch(screen[f] ?? '', /Creature/, `${r.name}: ${f} says Creature`);
    if (!isUnitType(r.type)) continue;
    assert.match(screen.type!, /Unit — /, `${r.name}: ${JSON.stringify(screen.type)}`);
    const [cmd] = commandsFor(r.name, { type: screen.type! });
    assert.match(cmd!.text, /\|type\|.*Creature — /, `${r.name}: ${cmd!.text}`);
    assert.doesNotMatch(cmd!.text, /Unit — /);
  }
});

/** [ours, on screen, in the command], one per type-line shape measured in the oracle. */
const SHAPES: readonly [string, string, string][] = [
  ['Cosmic Horror Unit', 'Unit — Cosmic Horror', 'Creature — Cosmic Horror'],
  ['{Haste} Alien Unit', '{Haste} Unit — Alien', '{Haste} Creature — Alien'],
  ['Golem Sprite {Virus} Unit', 'Unit — Golem Sprite {Virus}', 'Creature — Golem Sprite {Virus}'],
  ['[Augment] {Sluggish} Rock Beast {Virus} Unit', '[Augment] {Sluggish} Unit — Rock Beast {Virus}', '[Augment] {Sluggish} Creature — Rock Beast {Virus}'],
  ['{Virus} [Augment] {Swift}{Sluggish} Spirit Anima Unit', '{Virus} [Augment] {Swift}{Sluggish} Unit — Spirit Anima', '{Virus} [Augment] {Swift}{Sluggish} Creature — Spirit Anima'],
  ['{Battle} Squid Mimic Spell Unit', '{Battle} Unit — Squid Mimic Spell', '{Battle} Creature — Squid Mimic Spell'],
  ['{Feeble} Spirit Token Unit', '{Feeble} Unit — Spirit Token', '{Feeble} Creature — Spirit Token'],
  ['Token Unit', 'Unit — Token', 'Creature — Token'],
  ['{Battle} {Electric} Elemental Spell', '{Battle} {Electric} Elemental Spell', '{Battle} {Electric} Elemental Spell'],
  ['{Battle} {Burst} Spell Token', '{Battle} {Burst} Spell Token', '{Battle} {Burst} Spell Token'],
  ['[d] Dark Resource', '[k] Dark Resource', '[k] Dark Resource'],
  ['Stolen Card !Resource', 'Stolen Card !Resource', 'Stolen Card !Resource'],
  ['Help Card', 'Help Card', 'Help Card'],
];

test('§4 every type-line shape, in all three spellings', () => {
  const inPool = new Set(ROWS.map(r => r.type));
  for (const [ours, screen, command] of SHAPES) {
    assert.ok(inPool.has(ours), `${ours} is not a type line in the pool any more`);
    const r = ROWS.find(x => x.type === ours)!;
    assert.equal(editorFields(r).type, screen);
    assert.equal(oracleValues({ type: screen }).type, ours);
    assert.equal(commandsFor(r.name, { type: screen })[0]!.text, `$modify ${r.name.toLowerCase()}|type|${command}`);
    assert.deepEqual(valueFromCommand('type', command), { field: 'type', value: ours });
  }
  // Caleb's own command, and the line the scan prints
  assert.deepEqual(valueFromCommand('type', 'Creature — Bedlam Alien'), { field: 'type', value: 'Bedlam Alien Unit' });
  assert.deepEqual(valueFromCommand('Type', '{Battle} Creature — Ghost Spell'), { field: 'type', value: '{Battle} Ghost Spell Unit' });
});

test('§5 light and dark pips swap inside cost brackets only', () => {
  assert.equal(editorFields(row('Murkstalker')).cost, 'wk');
  assert.equal(editorFields(row('1v1 Turn Structure')).cost, '');
  assert.equal(oracleValues({ cost: '' }).cost, 'empty');
  for (const [name, ours, his] of [
    ['Angel of Anguish', '[1ld]', '[1wk]'], ['Calming Force', '[3ll]', '[3ww]'],
    ['Shib', '[4lb]', '[4wb]'], ['Exhume', '[d]', '[k]'],
  ] as const) {
    const text = editorFields(row(name)).text!;
    assert.ok(row(name).text.includes(ours) && text.includes(his) && !text.includes(ours), `${name}: ${text}`);
  }
  const words = 'Reveal [two] cards, [once] [Switch1] lead the old dark wood. [x] [Augment] [1]';
  assert.equal(editorFields({ ...row('Exhume'), text: words }).text, words);
  assert.equal(oracleValues({ text: words }).text, words);
  assert.equal(oracleValues({ text: 'Pay [2wk] or [k]: draw.' }).text, 'Pay [2ld] or [d]: draw.');
});

test('§6 a card whose notation does not come back opens read-only, with a reason', () => {
  const base = row('Murkstalker');
  assert.equal(editable(base), null);
  assert.match(editable({ ...base, text: 'Pay [keg].' })!, /notation/);
  assert.match(editable({ ...base, cost: 'lq' })!, /affinity/);
  assert.match(editable({ ...base, cost: 'pr' })!, /affinity/);
  assert.match(editable({ ...base, type: '{Haste} Unit' })!, /type line/);
  assert.match(editable({ ...base, total_cost: 2 as unknown as string })!, /incomplete/);
});
