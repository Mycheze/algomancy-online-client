/* The in-game rules reference (ui/rules.ts) and the interface guide
 * (ui/tutorial.ts) — the `? rules` overlay.
 *
 * The owner, on the previous panel (2026-09-05): *"The Rules reference panel
 * still has copy that is 'made up' by the engine. We need to double check and
 * rewrite all this. It should line up with the official rules and not mention
 * any 'R' rules."* — *"Rules reference is also missing 'evergreen' mentions,
 * from the help card. Things like ally, dies and enemy."* — *"Light and Dark
 * shouldn't be its own section of Rules (and cache/rot/debt don't need
 * emojis)."* — *"The rules reference should also have a search bar."* —
 * *"It needs to replace the help cards with the icons, definitions,
 * attributes, turn structure, everything!"*
 *
 * Each of those is a check below, and each is DERIVED where it can be: the
 * attribute set from printed.json, the icon set from data/icons, the tutorial's
 * buttons from the client's own source. What cannot be derived — that a
 * sentence says what the rulebook says — is pinned for the rows that quote the
 * help card verbatim, which is the owner's own bar for the evergreen terms.
 *
 * Seeds: none — pure data and pure string rendering.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICONS_DIR } from '../../engine/scripts/paths.mjs';
import {
  RULES_SECTIONS, entryHaystack, entryHtml, rulesListHtml, rulesBoxHtml, rulesSearch,
  type RulesEntry, type RulesSection,
} from '../rules.ts';
import { TUTORIAL, tutorialListHtml, tutorialSearch } from '../tutorial.ts';
import { PRINTED_REMINDERS } from '../glossary.ts';
import printedJson from '../../engine/src/cards/printed.json' with { type: 'json' };

const UI = fileURLToPath(new URL('../', import.meta.url));

/** every string a player could read off one entry */
const strings = (e: RulesEntry): string[] => [
  e.title, ...(Array.isArray(e.body) ? e.body : [e.body]), ...(e.alt ?? []), e.source ?? '',
];
const allEntries = (): { section: RulesSection; entry: RulesEntry }[] =>
  RULES_SECTIONS.flatMap(section => section.entries.map(entry => ({ section, entry })));
const section = (id: string): RulesSection => {
  const s = RULES_SECTIONS.find(x => x.id === id);
  assert.ok(s, `no section "${id}"`);
  return s!;
};
const entry = (sectionId: string, title: string): RulesEntry => {
  const e = section(sectionId).entries.find(x => x.title === title);
  assert.ok(e, `no "${title}" entry in section "${sectionId}"`);
  return e!;
};

/** a ruling number as a reader would see one — R13, R224 — and the two ways
 * this client's history has leaked into player copy before */
const R_NUMBER = /\bR\d+\b/;
const HISTORY = /\b(used to|since round|no longer|the engine|this client's ruling)\b/i;
/** the pictographs the old panel decorated Rot ☠, Debt ⛓ and Cache 📜 with */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

/* ── 1. the shape ──────────────────────────────────────────────────────── */

test('the sections open with turn structure, icons, attributes and terms, and Light & Dark is not one of them', () => {
  assert.deepEqual(RULES_SECTIONS.slice(0, 4).map(s => s.id), ['the-turn', 'icons', 'attributes', 'terms']);
  for (const s of RULES_SECTIONS) {
    assert.doesNotMatch(s.title, /light\s*(&|and)\s*dark/i, `"${s.title}" is a section of its own`);
  }
  const ids = RULES_SECTIONS.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length, 'section ids are unique');
});

test('every entry has a title and a real body, and no section repeats a title', () => {
  assert.ok(allEntries().length > 80, `only ${allEntries().length} entries — the panel is not the whole reference`);
  for (const s of RULES_SECTIONS) {
    const seen = new Set<string>();
    assert.ok(s.entries.length > 0, `section "${s.title}" is empty`);
    for (const e of s.entries) {
      assert.ok(e.title.trim().length > 0, `an entry in "${s.title}" has no title`);
      assert.ok(!seen.has(e.title), `"${e.title}" appears twice in "${s.title}"`);
      seen.add(e.title);
      const body = Array.isArray(e.body) ? e.body : [e.body];
      assert.ok(body.length > 0, `"${e.title}" has no body`);
      for (const line of body) assert.ok(line.trim().length > 10, `"${e.title}" needs a real sentence, not "${line}"`);
    }
  }
});

/* ── 2. THE OWNER'S RULE: no ruling numbers, no history ────────────────── */

test('no player-visible string in the rules carries a ruling number or this client’s history', () => {
  for (const { section: s, entry: e } of allEntries()) {
    for (const str of strings(e)) {
      assert.doesNotMatch(str, R_NUMBER, `${s.title} › ${e.title}: "${str}"`);
      assert.doesNotMatch(str, HISTORY, `${s.title} › ${e.title}: "${str}"`);
    }
  }
  for (const s of RULES_SECTIONS) {
    assert.doesNotMatch(s.title, R_NUMBER);
    assert.doesNotMatch(s.blurb ?? '', R_NUMBER);
    assert.doesNotMatch(s.blurb ?? '', HISTORY);
  }
  // …and the rendered panel, both tabs, so a template cannot add one back
  assert.doesNotMatch(rulesBoxHtml('rules', ''), R_NUMBER);
  assert.doesNotMatch(rulesBoxHtml('tutorial', ''), R_NUMBER);
});

test('POSITIVE CONTROL: the guard sees the exact string the owner’s screenshot showed', () => {
  // the old Haste row: "…granted by something in play (R97, Dispatch Courier)…"
  const bad: RulesEntry = { title: 'Haste', body: 'granted by something in play (R97, Dispatch Courier). (R224/R228 — a step that appeared only when…)' };
  assert.ok(strings(bad).some(s => R_NUMBER.test(s)), 'the regex must catch R97');
  assert.match(entryHtml(bad), R_NUMBER, 'and the renderer does not launder it');
  assert.match('this used to open only when somebody could act', HISTORY);
});

/* ── 3. cache / rot / debt, plainly ────────────────────────────────────── */

test('Cache, Rot and Debt are ordinary entries, without emojis, in the sections they belong to', () => {
  const cache = entry('terms', 'Cache');
  const rot = entry('cards', 'Rot');
  const debt = entry('cards', 'Debt');
  for (const e of [cache, rot, debt]) {
    assert.doesNotMatch(e.title, EMOJI, `"${e.title}" carries an emoji`);
    assert.doesNotMatch(String(e.body), EMOJI, `${e.title}'s body carries an emoji`);
  }
  // and nowhere else either — a heading is a word, not a decoration
  for (const { entry: e } of allEntries()) assert.doesNotMatch(e.title, EMOJI, `"${e.title}"`);
  assert.match(String(rot.body), /start of deployment/i, 'rot deals its damage at the start of deployment');
  assert.match(String(debt.body), /1 mana/i, 'debt is paid in mana');
});

/* ── 4. the evergreen terms, from the help card ────────────────────────── */

/** the Player Keywords help card (data/cards/Player-Keywords-Card.jpg), read
 * off the scan — the definitions the owner asked for, verbatim */
const HELP_CARD: Record<string, string> = {
  'Adjacent': 'Left, right, up, or down relative to a unit in formation. Cards not in formation have no adjacency.',
  'Ally': 'A unit in this region under your control.',
  'Bin': 'The zone where un-modded units go after they die, spells go after resolving and cards go when discarded.',
  'Delete': 'Put into the bin (counts as death).',
  'Spawn / Despawn': 'Enter/leave play.',
  'Effect': 'A played card, or an activated or triggered ability.',
  'Enemy': 'A unit in this region under an opponent’s control.',
  'Erase': 'Remove from the game (doesn’t count as death).',
  'Formation': 'A collection of units that have been assigned positions in combat. Units attack and block in formations.',
  'Modifications (Mods)': 'Grafts and augments applied to a unit.',
  'Negate': 'Stop an effect from happening.',
  'Recall': 'Return to its controller’s hand.',
  'Recycle': 'Put on the bottom of its owner’s deck.',
  'Region': 'The location each player’s base exists in. Regions are completely isolated from each other. What happens in one region has no impact outside of that region.',
};

test('every term on the Player Keywords help card is in the Terms section, in the card’s own words', () => {
  for (const [term, text] of Object.entries(HELP_CARD)) {
    const e = entry('terms', term);
    assert.ok(String(e.body).startsWith(text), `"${term}" must open with the help card's sentence:\n  card: ${text}\n  panel: ${e.body}`);
  }
  // the card's two entries the panel extends rather than quotes whole
  assert.match(String(entry('terms', 'Cache').body), /^Place the card in a temporary zone\./);
  assert.match(String(entry('terms', 'Target').body), /^A recipient of your choice for an effect\./);
  assert.match(String(entry('terms', 'Affinity').body), /^An amount of /);
});

test('the terms the owner named — ally, dies, enemy — and the ones cards lean on are all present', () => {
  for (const t of ['Ally', 'Dies', 'Enemy', 'Target', 'Resolve', 'Play', 'Sacrifice', 'Trashed', 'Recall', 'Erase', 'Delete']) {
    entry('terms', t);
  }
  const dies = entry('terms', 'Dies');
  assert.match(String(dies.body), /defense/i, 'a unit dies to damage at least equal to its defense');
  assert.match(String(dies.body), /sacrific|delet/i, 'and to sacrifice or delete');
});

/* ── 5. the attributes, against the pool ───────────────────────────────── */

interface PrintedRow { attrs?: string[]; augmentAttrs?: string[] }
const poolAttributes = (): Set<string> => {
  const out = new Set<string>();
  for (const c of Object.values(printedJson as unknown as Record<string, PrintedRow>)) {
    for (const a of c.attrs ?? []) out.add(a);
    for (const a of c.augmentAttrs ?? []) out.add(a);
  }
  return out;
};

test('every attribute the pool prints has a row, and a printed reminder is shown verbatim', () => {
  const attrs = section('attributes');
  const titles = new Set(attrs.entries.map(e => e.title));
  const pool = poolAttributes();
  assert.ok(pool.size > 20, `only ${pool.size} attributes in the pool`);
  const missing = [...pool].filter(a => !titles.has(a));
  assert.deepEqual(missing, [], 'attributes with no row in the reference');
  // R206's intent, kept: where a card prints the reminder, the panel prints
  // THAT sentence and not a paraphrase of it
  let printed = 0;
  for (const e of attrs.entries) {
    const p = PRINTED_REMINDERS.get(e.title)?.[0];
    if (!p) continue;
    printed++;
    assert.equal(e.body, p.text, `${e.title} must show the reminder printed on ${p.card}`);
    assert.match(e.source ?? '', new RegExp(p.card.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'and say which card it is from');
  }
  assert.ok(printed >= 15, `only ${printed} printed reminders reached the panel`);
  // the rows no card reminds you about say so, so a reader knows what to check
  for (const e of attrs.entries) {
    if (!PRINTED_REMINDERS.has(e.title)) assert.ok(e.source, `${e.title} states where its sentence comes from`);
  }
  // alphabetical, because a reference is looked up, not read
  const sorted = [...attrs.entries].sort((a, b) => a.title.localeCompare(b.title)).map(e => e.title);
  assert.deepEqual(attrs.entries.map(e => e.title), sorted);
});

/* ── 6. the icons, against data/icons ──────────────────────────────────── */

test('every marker and element icon the client draws is explained in the Icons section', () => {
  const files = readdirSync(ICONS_DIR).filter(f => f.endsWith('.webp')).map(f => f.replace(/\.webp$/, ''));
  const named = files.filter(f => !/^cost_/.test(f));
  assert.ok(named.length >= 12, `only ${named.length} icons in data/icons`);
  const drawn = new Set(section('icons').entries.flatMap(e => e.icons ?? []));
  const missing = named.filter(f => !drawn.has(f));
  assert.deepEqual(missing, [], 'icons in data/icons with no row in the reference');
  // and the row really draws it — an <img> per icon, off the same helper the cards use
  const html = rulesListHtml('');
  for (const f of named) assert.ok(html.includes(`/${f}.webp`), `${f} is not drawn`);
  // the Player Icons help card's eight rows, in its own words
  assert.equal(entry('icons', 'Battle').body, 'Battle cards can only be played during the battle phase.');
  assert.equal(entry('icons', 'Once').body, 'Do this only once each turn.');
  assert.match(String(entry('icons', 'Bounded graft').body), /^Bounded Graft\. This effect only happens once each turn\./);
  assert.match(String(entry('icons', 'Brackets [ ]').body), /must be completed in order to play a card or trigger an ability/);
});

/* ── 7. the turn ───────────────────────────────────────────────────────── */

test('the turn structure is the help card’s: planning in five steps, a two-part battle, regroup, deployment', () => {
  const turn = section('the-turn');
  const planning = entry('the-turn', 'Planning phase');
  assert.ok(Array.isArray(planning.body) && planning.body.length === 5, 'the Turn Structure card lists five planning steps');
  assert.match(planning.body[0]!, /^Refresh resources/);
  assert.match(planning.body[1]!, /^Draw 2 cards/);
  assert.match(planning.body[2]!, /^Draft/);
  assert.match(planning.body[4]!, /Haste/);
  const b1 = turn.entries.find(e => /Battle phase — part 1/.test(e.title))!;
  const b2 = turn.entries.find(e => /Battle phase — part 2/.test(e.title))!;
  assert.ok(b1 && b2, 'both parts of the 1v1 battle are there');
  assert.ok(Array.isArray(b1.body) && b1.body.length === 6 && Array.isArray(b2.body) && b2.body.length === 6,
    'the 1v1 Turn Structure card gives six steps to each part');
  assert.match(b1.body[2]!, /block/i);
  assert.match(b1.body[2]!, /counterattack|send/i, 'the non-initiative player blocks AND sends');
  for (const t of ['Regroup', 'Deployment phase', 'End of turn', 'Initiative']) entry('the-turn', t);
});

/* ── 8. search ─────────────────────────────────────────────────────────── */

test('the search filters entries on title, body and alternate spellings, every word required', () => {
  assert.deepEqual(rulesSearch(''), [...RULES_SECTIONS], 'an empty query is the whole reference');
  assert.deepEqual(rulesSearch('   '), [...RULES_SECTIONS]);
  const flying = rulesSearch('flying');
  assert.ok(flying.length > 0);
  for (const s of flying) for (const e of s.entries) assert.match(entryHaystack(e), /flying/);
  assert.ok(flying.some(s => s.id === 'attributes' && s.entries.some(e => e.title === 'Flying')));
  assert.deepEqual(rulesSearch('zzqxv'), [], 'nothing matches → no sections, not empty headings');
  // every word, in any order, case-insensitively, with card markup tolerated
  assert.ok(rulesSearch('BLOCK Flying').some(s => s.entries.some(e => e.title === 'Flying')));
  assert.ok(rulesSearch('{Haste}').some(s => s.entries.some(e => e.title === 'Haste')));
  assert.ok(rulesSearch('switch1').some(s => s.entries.some(e => e.title === 'Bounded graft')), 'the markup name reaches the icon row');
  assert.ok(rulesSearch('IT NIT').some(s => s.entries.some(e => e.title === 'Initiative')), 'the help card’s abbreviations');
  // inflections: the search stems the query, so no row has to list its own endings
  for (const [q, title] of [['erased', 'Erase'], ['recalled', 'Recall'], ['prophesied', 'Prophecy'],
    ['blockers', 'Blocking'], ['allies', 'Ally'], ['counters', 'Stat changes and counters']] as const) {
    assert.ok(rulesSearch(q).some(s => s.entries.some(e => e.title === title)), `"${q}" finds ${title}`);
  }
  // the guide has the same search
  assert.deepEqual(tutorialSearch(''), [...TUTORIAL]);
  assert.deepEqual(tutorialSearch('zzqxv'), []);
  const space = tutorialSearch('space pass');
  assert.ok(space.some(s => s.id === 'keys'), 'the keyboard section answers "space pass"');
  assert.match(rulesListHtml('zzqxv'), /Nothing in the rules matches/);
  assert.match(tutorialListHtml('zzqxv'), /Nothing in the guide matches/);
});

/* ── 9. the overlay ────────────────────────────────────────────────────── */

test('the overlay has the search box, the two tabs, the jump bar and the close button', () => {
  const html = rulesBoxHtml('rules', '');
  assert.match(html, /id="rules-q"/);
  assert.equal((html.match(/data-btn="helptab"/g) ?? []).length, 2);
  assert.match(html, /data-btn="helpclose"/);
  assert.match(html, /data-btn="helpjump" data-sec="rs-the-turn"/);
  assert.match(html, /id="rs-attributes"/);
  const guide = rulesBoxHtml('tutorial', '');
  assert.match(guide, /How to use the interface/);
  assert.match(guide, /id="tt-home"/);
  assert.doesNotMatch(guide, /id="rs-the-turn"/, 'one tab at a time');
  // the query is echoed back into the box, escaped
  const echoed = rulesBoxHtml('rules', '"<x>"');
  assert.ok(!echoed.includes('value=""<x>""'), 'the query is HTML-escaped in the input');
  assert.match(echoed, /value="&quot;&lt;x&gt;&quot;"/);
});

/* ── 10. the interface guide ───────────────────────────────────────────── */

/** the client's own source, so a button the guide names has to exist */
const UI_SOURCE = readdirSync(UI).filter(f => f.endsWith('.ts')).map(f => readFileSync(join(UI, f), 'utf8')).join('\n');

test('every button the guide names is a real control in the client', () => {
  assert.ok(UI_SOURCE.includes('data-btn="helpopen"'), 'positive control: the source really is loaded');
  const named = new Set<string>();
  for (const s of TUTORIAL) for (const st of s.steps) for (const b of st.btns ?? []) named.add(b);
  assert.ok(named.size >= 60, `the guide names only ${named.size} buttons — it is not walking every action`);
  const missing = [...named].filter(b => !UI_SOURCE.includes(`data-btn="${b}"`) && !UI_SOURCE.includes(`'${b}'`));
  assert.deepEqual(missing, [], 'buttons the guide describes that no longer exist');
});

test('the guide covers every screen the owner listed, in plain numbered steps', () => {
  const ids = TUTORIAL.map(s => s.id);
  for (const id of ['home', 'board', 'planning', 'cards', 'battle', 'deploy', 'settings', 'keys', 'clock', 'end']) {
    assert.ok(ids.includes(id), `no "${id}" section in the guide`);
  }
  for (const s of TUTORIAL) {
    assert.ok(s.steps.length > 0, `"${s.title}" has no steps`);
    for (const st of s.steps) {
      // "Space — Pass." is a whole step; the bound is on the pair, not the text
      assert.ok(`${st.label ?? ''} ${st.text}`.trim().length > 8, `a step in "${s.title}" is empty`);
      assert.doesNotMatch(st.text, R_NUMBER, `${s.title}: "${st.text}"`);
      assert.doesNotMatch(st.label ?? '', R_NUMBER);
      assert.doesNotMatch(st.text, HISTORY, `${s.title}: "${st.text}"`);
    }
  }
  const all = TUTORIAL.flatMap(s => s.steps.map(st => `${st.label ?? ''} ${st.text}`)).join('\n');
  for (const must of [/full control/i, /auto-pass/i, /bluff haste/i, /motion/i, /sound/i, /undo/i, /judge/i, /report/i,
    /spectat/i, /reconnect/i, /clock/i, /Space/, /Enter/, /Esc/, /rematch/i, /concede/i, /hotseat/i, /join/i, /draft/i]) {
    assert.match(all, must);
  }
  assert.doesNotMatch(all, /practice demo/i, 'the practice demo is gone from the home screen');
  // the sequences are numbered; the lists are not
  assert.ok(TUTORIAL.find(s => s.id === 'battle')!.numbered);
  assert.ok(!TUTORIAL.find(s => s.id === 'settings')!.numbered);
  assert.match(tutorialListHtml(''), /<ol class="ttsteps">/);
  assert.match(tutorialListHtml(''), /<ul class="ttsteps">/);
});

/* ── 5b. the reminders the oracle never transcribed ─────────────────────── */

import scanJson from '../scan-reminders.json' with { type: 'json' };

test('the ten type-line reminders the oracle omits are shown verbatim from the scans, and no attribute row claims nothing prints one', () => {
  // The owner, 2026-09-05, on the panel saying "no card prints a reminder for
  // this attribute": "The cards that have those effects LITERALLY are printed
  // with reminder text on them." They are; the oracle transcription carries
  // only the text box. ui/scan-reminders.json is that text, read off the scans.
  const attrs = section('attributes');
  const scans = scanJson.reminders as Record<string, { text: string; card: string }>;
  assert.equal(Object.keys(scans).length, 10, 'positive control: ten scan-read reminders');
  for (const [term, r] of Object.entries(scans)) {
    const e = attrs.entries.find(x => x.title === term);
    assert.ok(e, `${term} has no row`);
    assert.equal(e.body, r.text, `${term} must show the sentence printed on ${r.card}, verbatim`);
    assert.equal(e.source, `printed on ${r.card}`);
    assert.ok(!PRINTED_REMINDERS.get(term)?.length, `${term} is in the oracle after all — drop it from scan-reminders.json`);
  }
  const unsourced = attrs.entries.filter(e => /no card prints/i.test(e.source ?? ''));
  assert.deepEqual(unsourced.map(e => e.title), [],
    'an attribute row still claims no card prints a reminder — read the scan before believing that');
});

test('the panel draws no source citations — provenance stays in the data, off the screen', () => {
  // the owner, 2026-09-05: "no need to cite where it comes from. That's just visual clutter."
  const html = rulesListHtml('');
  assert.equal(/rulesrc|printed on |help card|Algomancy Manual/.test(html), false, 'a source line is being rendered');
  assert.ok(RULES_SECTIONS.some(s => s.entries.some(e => e.source)), 'positive control: the data still carries sources');
});
