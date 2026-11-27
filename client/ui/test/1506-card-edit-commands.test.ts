/* 1506 · FRIENDLYBOT'S COMMANDS, MADE AND READ BACK (ui/cardnotation.ts; client/docs/friendlybot.md)
 *
 *  §1 the commands an edit makes, as Caleb types them
 *  §2 Caleb's own commands parse, the way FriendlyBot reads them
 *  §3 the messages FriendlyBot ignored parse to nothing
 *  §4 every field of every card survives command → posted → our row
 *  §5 what a submit refuses
 *  §6 the attachment name carries the card's real name
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ORACLE_JSON } from '../../engine/scripts/paths.mjs';
import {
  EDITOR_FIELDS, MAX_COMMAND_CHARS, ORACLE_FIELD, attachmentFileKey, commandsFor, editable, editorFieldOf,
  editorFields, friendlyBotFileKey, oracleValues, parseCommand, validateEdit, valueFromCommand, type OracleRow,
} from '../cardnotation.ts';

const ORACLE = JSON.parse(readFileSync(ORACLE_JSON, 'utf8')) as Record<string, OracleRow[]>;
const ROWS = Object.values(ORACLE).map(v => v[0]!);
const row = (name: string): OracleRow => ORACLE[name]![0]!;
const texts = (card: string, changed: Parameters<typeof commandsFor>[1]): string[] =>
  commandsFor(card, changed).map(c => c.text);

test('§1 the commands an edit makes', () => {
  assert.deepEqual(texts('Murkstalker', { 'total cost': '2' }), ['$modify murkstalker|total cost|2']);
  assert.deepEqual(texts('Shard Sprite', { cost: 'w' }), ['$modify shard sprite|cost|w']);
  assert.deepEqual(texts('Maw of Despair', { type: 'Unit — Bedlam Alien' }), ['$modify maw of despair|type|Creature — Bedlam Alien']);
  assert.deepEqual(texts('Rider of the Tides', { image: 'images_out/Stable/rtdd.png' }), ['$modify rider of the tides|image|images_out/Stable/rtdd.png']);
  assert.deepEqual(texts('Murkstalker', { cost: '' }), ['$modify murkstalker|cost|empty']);
  // one command per field, in field order whatever order they came in, complexity on its own verb
  assert.deepEqual(texts('Murkstalker', { complexity: 'Simple', image: 'a.png', power: '3', cost: 'k' }), [
    '$modify murkstalker|cost|k', '$modify murkstalker|power|3', '$modify murkstalker|image|a.png', '$simple murkstalker',
  ]);
  assert.deepEqual(texts('Murkstalker', { complexity: 'Complex' }), ['$complex murkstalker']);
  assert.deepEqual(texts('Murkstalker', { complexity: 'Glitch' }), [], 'FriendlyBot has no command for it');
  assert.deepEqual(commandsFor('Murkstalker', { toughness: '1' }), [{ text: '$modify murkstalker|toughness|1', field: 'toughness' }]);
});

test('§2 Caleb commands parse as FriendlyBot reads them', () => {
  const cases: [string, string, string, string][] = [
    ['$modify murkstalker|text|When you trash another card, [Switch1] Each opponent loses 1 life and you gain 1 life.',
      'murkstalker', 'text', 'When you trash another card, [Switch1] Each opponent loses 1 life and you gain 1 life.'],
    ['$modify murkstalker|total cost|2', 'murkstalker', 'total cost', '2'],
    ['$modify seer or empty spaces|total cost|2', 'seer or empty spaces', 'total cost', '2'],
    ['$modify shard sprite|cost|w', 'shard sprite', 'cost', 'w'],
    ['$modify arbitor of armistice|toughness|2', 'arbitor of armistice', 'toughness', '2'],
    ['$modify triskaidekophage|power|13', 'triskaidekophage', 'power', '13'],
    ['$modify rider of the tides|image|images_out/Stable/rtdd.png', 'rider of the tides', 'image', 'images_out/Stable/rtdd.png'],
    ['$modify maw of despair|type|Creature — Bedlam Alien', 'maw of despair', 'type', 'Creature — Bedlam Alien'],
    // field names fold: case, and an underscore for a space
    ['$modify frosted denial|Text|Draw.', 'frosted denial', 'text', 'Draw.'],
    ['$modify cthyrian rector|Type|Creature — Blight Zombie {Virus}', 'cthyrian rector', 'type', 'Creature — Blight Zombie {Virus}'],
    ['$modify x|total_cost|3', 'x', 'total cost', '3'],
    ['$modify x|Total Cost|3', 'x', 'total cost', '3'],
    // spaces around the name are kept: FriendlyBot answered "Modified  spawn's image" and "bripp 's text"
    ['$modify  spawn|image|images_out/Stable/wisp.png', ' spawn', 'image', 'images_out/Stable/wisp.png'],
    ['$modify bripp |text|Erase that card.', 'bripp ', 'text', 'Erase that card.'],
  ];
  for (const [text, name, field, value] of cases) {
    assert.deepEqual(parseCommand(text), { verb: 'modify', name, field, value }, text);
  }
  assert.deepEqual(parseCommand('$complex murkstalker'), { verb: 'complex', name: 'murkstalker', field: 'complexity', value: 'Complex' });
  assert.deepEqual(parseCommand('$simple debt blep'), { verb: 'simple', name: 'debt blep', field: 'complexity', value: 'Simple' });
  assert.equal(editorFieldOf('Total_Cost'), 'total cost');
  assert.equal(editorFieldOf('images'), null);
  assert.deepEqual(valueFromCommand('cost', 'empty'), { field: 'cost', value: 'empty' });
  assert.deepEqual(valueFromCommand('cost', 'wk'), { field: 'cost', value: 'ld' });
  assert.deepEqual(valueFromCommand('text', 'Pay [1wk].'), { field: 'text', value: 'Pay [1ld].' });
  assert.equal(valueFromCommand('num copies', '3'), null);
});

test('§3 the messages FriendlyBot ignored parse to nothing', () => {
  for (const ignored of [
    '$modify|the everywhere|text|[Augment] As I spawn, name a card.',   // the separator after the verb
    '$Modify battle|image|images_out/Stable/battle2.png',               // retyped lower-case each time, three of three
    '$modifyburgeon|images|images_out/Stable/burg.png',
    '$modfy murkstalker|power|3',
    '$modify burgeon|Text|[Switch1] Double the /[might | mass] of target unit until regroup.',   // a | in the value
    '$modify servant of the flame|image|images_out|Stable|fireguy.png',
    '$modify bloodletting beast|text',
    '$modify endbringer',
    '$replace afflicting anima|text|Wight|Wraith',
    '$get murkstalker|text',
    'please $modify murkstalker|power|3',
    '$modify |power|3',
    '$complex ',
  ]) assert.equal(parseCommand(ignored), null, ignored);
});

test('§4 every field of every card survives the command, posted back into our row', () => {
  let walked = 0;
  for (const r of ROWS) {
    if (editable(r)) continue;
    const screen = editorFields(r);
    for (const f of EDITOR_FIELDS) {
      if (screen[f] === undefined) continue;
      if (f === 'complexity' && screen[f] !== 'Simple' && screen[f] !== 'Complex') continue;
      const [cmd] = commandsFor(r.name, { [f]: screen[f] });
      const posted = parseCommand(cmd!.text);
      assert.ok(posted, `${r.name}: ${cmd!.text} does not parse`);
      assert.deepEqual(valueFromCommand(posted.field, posted.value), { field: ORACLE_FIELD[f], value: r[ORACLE_FIELD[f]] },
        `${r.name}: ${cmd!.text}`);
      walked++;
    }
  }
  assert.ok(walked > 3500, `only ${walked} commands walked`);
});

test('§5 what a submit refuses', () => {
  const unit = row('Murkstalker');
  const spell = ROWS.find(r => r.type.endsWith(' Spell') && r.power !== '' && !editable(r))!;
  assert.deepEqual(validateEdit(unit, { 'total cost': '3' }), []);
  assert.deepEqual(validateEdit(unit, { power: 'X', toughness: '10', cost: 'pp' }), []);
  assert.deepEqual(validateEdit(unit, { cost: '' }), []);
  assert.deepEqual(validateEdit(unit, {}), ['Nothing changed.']);
  assert.deepEqual(validateEdit(unit, editorFields(unit)), ['Nothing changed.'], 'the form as it opened');
  const refused: [Parameters<typeof validateEdit>[1], RegExp][] = [
    [{ text: 'Draw a card | or two.' }, /Text can't contain \|/],
    [{ image: 'a|b.png' }, /Art can't contain \|/],
    [{ text: 'Draw a card.\nThen another.' }, /\{\/n\}/],
    [{ text: 'x'.repeat(MAX_COMMAND_CHARS) }, /Text is too long/],
    [{ power: 'three' }, /Power must be a number or X/],
    [{ 'total cost': '2X' }, /Cost must be a number or X/],
    [{ toughness: '' }, /Toughness must be a number or X/],
    [{ cost: 'wl' }, /Affinity takes only/],
    [{ cost: 'wp' }, /Affinity takes only/],
    [{ type: ' ' }, /Type can't be empty/],
    [{ complexity: 'Common' }, /Simple or Complex/],
    [{ type: '{Battle} Cosmic Spell', power: '3' }, /Only units have power and toughness/],
  ];
  for (const [edit, why] of refused) {
    const problems = validateEdit(unit, edit);
    assert.ok(problems.some(p => why.test(p)), `${JSON.stringify(edit).slice(0, 60)}: ${JSON.stringify(problems)}`);
  }
  assert.match(validateEdit(spell, { power: '9' }).join(' '), /Only units/, `${spell.name}: P/T on a spell`);
  assert.equal(texts(unit.name, { text: 'x'.repeat(MAX_COMMAND_CHARS - 40) })[0]!.length <= MAX_COMMAND_CHARS, true);
  assert.deepEqual(validateEdit(unit, { text: 'x'.repeat(MAX_COMMAND_CHARS - 40) }), []);
  // a locked card refuses everything, with its reason
  assert.match(validateEdit({ ...unit, cost: 'q' }, { power: '3' })[0]!, /affinity isn't understood/);
});

test('§6 the attachment name carries the card real name', () => {
  for (const [card, key] of [
    ['Murkstalker', 'Murkstalker'], ["Blight's End", 'Blights_End'], ['A Fast Pile of Rocks', 'A_Fast_Pile_of_Rocks'],
    ['Seer of Empty Spaces', 'Seer_of_Empty_Spaces'], ['Hooba-Nan', 'Hooba-Nan'], ['All-Consuming Blaze', 'All-Consuming_Blaze'],
  ] as const) {
    assert.equal(friendlyBotFileKey(card), key);
    assert.equal(attachmentFileKey(`CUsersCalebPycharmProjectscardgamebot_library${key}.jpg`), key);
  }
  assert.equal(attachmentFileKey('temp.jpg'), null);
  assert.equal(attachmentFileKey('DAzothBot_LibraryGet_Cards.jpg'), null);
  assert.equal(oracleValues({ cost: 'k' }).cost, 'd');
});
