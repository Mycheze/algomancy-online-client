/* The card editor (ui/pages/cardeditor.ts, client/docs/card-editor.md §2), drawn from made-up
 * views: no server, no account. */
import { type CardEditorView, type EditDetail, type EditSummary, cardEditorHtml } from '../../../ui/pages/cardeditor.ts';
import { editorFields, type OracleRow } from '../../../ui/cardnotation.ts';
import { CHROME } from './_page.ts';

const ROW: OracleRow = {
  name: 'Murkstalker', power: '2', toughness: '2', cost: 'ld', total_cost: '2', type: 'Cosmic Horror Unit',
  text: 'When you trash another card, [Switch1] Each opponent loses 1 life and you gain 1 life.',
  image: 'images_out/Stable/murk3.png', complexity: 'Complex', factions: ['light', 'dark'], Deck: 'Light & Dark (Light/Dark)',
};

const EDIT: EditDetail = {
  id: 'ce-20261127-murkstalker-7f3a', card: 'Murkstalker', by: { name: 'Caleb' }, createdAt: '2026-11-27T10:00:00Z',
  summary: 'cost 2 → 3', road: 'fast', status: 'submitted', note: null, edit: { 'total cost': '3' },
  diff: [{ field: 'total_cost', from: '2', to: '3' }], why: [],
  commands: [{ text: '$modify murkstalker|total cost|3', field: 'total cost', posted: null, answered: false }],
  pictures: { before: false, after: false },
};

const LIST: EditSummary[] = [
  { ...EDIT, status: 'applying', note: 'testing' },
  { id: 'ce-20261126-firebolt-01ab', card: 'Firebolt', by: { name: 'Caleb' }, createdAt: '2026-11-26T09:00:00Z', summary: 'text',
    road: 'steward', status: 'steward', note: 'queued for the steward: the text changed' },
  { id: 'ce-20261120-murkstalker-0000', card: 'Murkstalker', by: { name: 'Caleb' }, createdAt: '2026-11-20T09:00:00Z', summary: 'art',
    road: 'fast', status: 'live', note: null },
];

const base: CardEditorView = {
  access: true, tab: 'edit', backLabel: 'Cards', isAdmin: false, discordLinked: true, chrome: CHROME,
  query: '', picks: [], card: ROW.name, isLoading: false, busy: false,
  row: { card: ROW.name, row: ROW, rowHash: 'h', readOnly: null, open: null },
  scanUrl: '/data/cards/Murkstalker.webp', fields: editorFields(ROW), current: null, errorMsg: '',
  edits: LIST, whenOf: { [LIST[0]!.id]: '27 Nov, 10:00', [LIST[1]!.id]: '26 Nov, 09:00', [LIST[2]!.id]: '20 Nov, 09:00' },
  detail: null, pictures: { before: null, after: null },
};

export default {
  title: 'Pages/Card editor',
  render: (args: CardEditorView) => cardEditorHtml(args),
  args: base,
};

export const Form = {};
export const NumbersEdit = { name: 'A numbers edit', args: { fields: { ...editorFields(ROW), 'total cost': '3' } } };
export const TextEdit = { name: 'A text edit (the steward)', args: { fields: { ...editorFields(ROW), text: 'When you trash another card, [Switch1] Each opponent loses 2 life.' } } };
export const Refusal = { name: 'Something the server would refuse', args: { fields: { ...editorFields(ROW), power: 'two' } } };
export const Picking = { name: 'Finding a card', args: { query: 'murk', picks: ['Murkstalker', 'Murk Lord', 'Murkwater Shade'] } };
export const NoCard = { name: 'No card yet', args: { card: null, row: null, scanUrl: null, fields: {}, backLabel: 'Home' } };
export const ReadOnly = { name: 'Read-only', args: { row: { ...base.row!, readOnly: "this card's type line isn't understood yet" } } };
export const Commands = { name: 'Submitted: the commands', args: { current: EDIT } };
export const Waiting = { name: 'Waiting for FriendlyBot', args: { current: { ...EDIT, status: 'waiting', note: "FriendlyBot hasn't answered: is it running? Post the command again.",
  commands: [{ ...EDIT.commands[0]!, posted: EDIT.commands[0]!.text }] } } };
export const Steward = { name: 'Queued for the steward', args: { current: { ...EDIT, road: 'steward', status: 'steward', note: 'queued for the steward: the text changed' } } };
export const MyEdits = { name: 'My edits', args: { tab: 'mine' } };
export const MyEditsOpen = { name: 'My edits, one opened', args: { tab: 'mine', isAdmin: true,
  detail: { ...EDIT, ...LIST[0]!, commands: [{ ...EDIT.commands[0]!, posted: EDIT.commands[0]!.text, answered: true }], pictures: { before: true, after: true } },
  pictures: { before: '/data/cards/Murkstalker.webp', after: '/data/cards/Murkstalker.webp' } } };
export const Refused = { args: { access: false } };
