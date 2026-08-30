/* R206 / CT-76 + CT-80 — the glossary against the rules it paraphrases.
 *
 * WHY THIS FILE EXISTS. `ui/glossary.ts` is not UI copy. The card inspector
 * prints one of its rows under every card that mentions a keyword, so to a
 * player that row IS the reminder text; and for an attribute with no printed
 * reminder ({Reaping}, {Unaware}, {Virus}, {Feeble}, {Thieving}, {Resonant},
 * {Tough}, {Vulnerable}, {Evasive}, {Sneaky}, {Burst}, {Unstable}, {Ambush})
 * it is the ONLY statement of the rule the repository has. `engine.ts:4331`
 * says so outright about {Reaping}: "ui/glossary.ts is the repo's own
 * statement of it, AND IT IS WHAT R184 READ."
 *
 * Nothing checked it. The cost is on the record twice:
 *   · report #106 — R45 was corrected on 2026-08-19 (glimpse caches exactly
 *     ONE and recycles the rest) and the glossary kept the pre-correction
 *     wording for SEVEN DAYS, contradicting, on screen, the printed box
 *     directly above it. The report was triaged to the printed data twice.
 *   · R206 (2026-08-26) audited all 43 rows and found NINE wrong — three of
 *     them on CT-80's own "checked and correct, do not re-audit" list.
 *
 * WHAT THIS FILE CAN SEE, stated plainly so nobody reads more into a green
 * run than is there:
 *   1. CITATIONS RESOLVE. Every row names the ruling(s) it paraphrases, and
 *      every `R<n>` must resolve to a `## R<n>` in docs/digital-rules.md that
 *      is not withdrawn, superseded or narrowed. This is the check that would
 *      have caught {Unaware} still teaching R10 after R106 replaced it.
 *   2. PRINTED TEXT WINS. For the 15 attributes that carry a printed reminder
 *      in printed.json, the row must not drop a rules-significant word the
 *      CARD uses. Derived from the pool, not enumerated here: a new card with
 *      a reminder extends the check the day it is added. This is what caught
 *      {Piercing} ("recipient's controller" → "the defending player") and
 *      {Electric} (the dropped recursion) independently of the audit.
 *   3. SIX ROWS ARE PINNED AGAINST THE ENGINE ITSELF — the ones whose rule is
 *      readable out of a named function's source.
 *   4. R248 / report #118 — SHORTENING IS NOT DELETING (§7). An exported row's
 *      `text` is now the pool's own printed reminder wherever the pool prints
 *      one, so §7 asserts BOTH directions of that swap: the printed sentence
 *      really is what a player sees, and the authored generalisation survives
 *      verbatim in `rule`. Without it, checks 1-3 could pass on rows that had
 *      been quietly reduced to their printed sentence, because they all read
 *      `stated()` — the complete statement, whichever field holds it.
 *      R252 / report #119 adds a SECOND displacing channel — the Algomancy
 *      Manual, for seven rows no card reminds you about — and §7 states the
 *      invariant over both: `rule` exists exactly when something the GAME says
 *      displaced the authored sentence, and the row names which channel said
 *      it. Where the quote came from is 231-manual-text.test.ts's job; that it
 *      did not eat a rule on the way in is this file's.
 *
 * WHAT IT CANNOT SEE: most of the prose. No machine reads "its column can
 * only be blocked by a column with Flying" and tells you the engine agrees.
 * Rows resting on neither a ruling nor printed text are listed BY NAME below
 * so the size of that hole is a number rather than a feeling.
 *
 * ⚠ Every observation channel here has a positive control, per docs/13 §7.4:
 * the staleness detector is run against known-stale and known-live rulings,
 * every source scrape asserts it found its target, and the last section
 * MUTATES rows and asserts each mutation is named. A checker with no proof it
 * can go red is the thing this ticket is about.
 *
 * Seeds: none — this file is pure data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AUTHORED_GLOSSARY, GLOSSARY, LIBRARY_REMINDERS, MANUAL_REMINDERS, PRINTED_REMINDERS,
  type GlossEntry, type GlossSource,
} from '../ui/glossary.ts';

/**
 * R248 — THE SENTENCE THIS FILE IS ABOUT.
 *
 * Report #118 split every row in two: an exported row's `text` is now the
 * POOL'S OWN printed reminder wherever the pool prints one, and the authored
 * generalisation moved to `rule`. Comparing `text` against the printed
 * sentence after that would be comparing a string with itself — a check that
 * cannot fail, which is the exact failure mode §6 exists to prevent. So every
 * check below reads `stated()`: the complete statement, whichever field is
 * holding it. `rule` where the printed reminder displaced it, `text` where
 * nothing did (the ten reminderless attributes, the four markers, and the
 * synthetic MUTANT rows in §6, which have no `rule` by construction).
 *
 * §7 is the other half — it asserts the DISPLAYED half really is the printed
 * sentence, so the split cannot quietly stop happening either.
 */
const stated = (e: GlossEntry): string => e.rule ?? e.text;

const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');
const RULES = read('../../docs/digital-rules.md');
const ENGINE = read('../src/engine.ts');
const APPLY = read('../src/apply.ts');
const GLOSS_SRC = read('../ui/glossary.ts');
const PRINTED = JSON.parse(read('../src/cards/printed.json')) as Record<string, { text?: string }>;
const TYPES = read('../src/types.ts');

/* ════════════════════════════════════════════════════════════════════════
 * 1. THE REGISTER: does an R-number resolve, and is the ruling still live?
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Every `## R<n>` section of docs/digital-rules.md, header line plus the head
 * of its body.
 *
 * The head matters because THE MARKER IS NOT ALWAYS IN THE HEADER. Two of the
 * five stale rulings in the file are only marked in a blockquote under it:
 * R10 ("IMPLEMENTED BY R106 … R106 is the operative one") and R76 ("The
 * Alluring rule stated here is SUPERSEDED by R84"). A header-only check reads
 * both as live — and R10 is exactly the ruling {Unaware} was still quoting,
 * so a header-only check would have missed the bug this file was written for.
 */
function register(): Map<string, { header: string; head: string }> {
  const out = new Map<string, { header: string; head: string }>();
  const lines = RULES.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^## (R\d+[a-z]?)\b(.*)$/.exec(lines[i]!);
    if (!m) continue;
    // ⚠ stop at the next `## ` — R9's body is TWO LINES, so a fixed-size
    // window runs straight into R10's "R106 is the operative one" and marks
    // R9 retired. Measured, not guessed: a 20-line window failed on R9 and
    // R17 in exactly that way.
    let end = i + 1;
    while (end < lines.length && !lines[end]!.startsWith('## ')) end++;
    // …and only the LEADING blockquote, which is where both body-marked
    // retirements live (R10 and R76 each open with `> ⚠ **…**`).
    const head = lines.slice(i + 1, end).filter(l => l.startsWith('>')).join('\n');
    out.set(m[1]!, { header: lines[i]!, head });
  }
  return out;
}
const REGISTER = register();

/**
 * The markers the repo actually uses to retire a ruling, and WHERE it puts
 * them: the header line, or the leading blockquote under it.
 *
 * Two deliberate narrowings, both learned by measuring:
 *  · "superseded BY" retires this ruling; "Supersedes R76" (in R84's body)
 *    says this ruling retired ANOTHER. Matching the active voice would mark
 *    every replacement as dead.
 *  · the blockquote restriction is not decoration. R18's body contains the
 *    sentence "**The ⚠ is withdrawn (2026-08-21).**" — it is the ruling's
 *    WARNING that was withdrawn, not the ruling — and a body-wide match reads
 *    R18 as retired and takes the {Haste} row down with it.
 */
const STALE = /❌|\bWITHDRAWN\b|\bRETIRED\b|\bsuperseded\s+by\b|\bnarrowed\s+by\s+R\d+|\bis\s+the\s+operative\s+one\b/i;

function staleness(tok: string): string | null {
  const sec = REGISTER.get(tok);
  if (!sec) return null;
  const hit = STALE.exec(sec.header) ?? STALE.exec(sec.head);
  return hit ? hit[0] : null;
}

test('POSITIVE CONTROL: the staleness detector can tell a retired ruling from a live one', () => {
  assert.ok(REGISTER.size > 150, `only parsed ${REGISTER.size} rulings — the register parse is broken`);
  // the five known-retired rulings, each marked a DIFFERENT way. If any of
  // these reads "live", the citation check below is decorative.
  for (const [tok, why] of [
    ['R28', 'header: ❌ WITHDRAWN … superseded by R115'],
    ['R52', 'header: ❌ WITHDRAWN … superseded by R115'],
    ['R108', 'header: (narrowed by R113)'],
    ['R76', 'BODY blockquote: "SUPERSEDED by R84"'],
    ['R10', 'BODY blockquote: "R106 is the operative one"'],
  ] as const) {
    assert.ok(REGISTER.has(tok), `${tok} is not in the register at all`);
    assert.ok(staleness(tok), `${tok} must read as retired — ${why}`);
  }
  // and the negative half: the replacements, the rulings this glossary leans
  // on hardest, and the three that a looser detector DID read as retired —
  // R9 (two-line body, so a fixed window ran into R10's marker), R17 (same,
  // into R18's) and R18 itself ("**The ⚠ is withdrawn**" is about the warning).
  for (const tok of ['R9', 'R17', 'R18', 'R45', 'R84', 'R106', 'R113', 'R115', 'R133', 'R184', 'R190']) {
    assert.ok(REGISTER.has(tok), `${tok} is not in the register`);
    assert.equal(staleness(tok), null,
      `${tok} reads as retired — the detector is over-matching and every citation is now suspect`);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * 2. WHICH TERMS CARRY A PRINTED REMINDER — derived, never enumerated
 * ════════════════════════════════════════════════════════════════════════ */

/** the `Attr` union, read as text (it is a TYPE — 52-ui-glossary does the same) */
function attrUnion(): Set<string> {
  const at = TYPES.indexOf('export type Attr =');
  assert.notEqual(at, -1, 'src/types.ts no longer declares `export type Attr`');
  const names = [...TYPES.slice(at, TYPES.indexOf(';', at)).matchAll(/'([A-Za-z]+)'/g)].map(m => m[1]!);
  assert.ok(names.length > 20, `only parsed ${names.length} attributes — the parse is broken`);
  return new Set(names);
}
const ATTRS = attrUnion();

/** printed text writes its reminders as `{i}(…)`, the same shape
 * 109-attr-channel-conformance and 156-reaping-and-formation read. */
const norm = (s: string): string => s
  .replace(/\{\/?[a-z]\}/g, ' ')       // the {i}/{/i}/{/n} inline markup
  .replace(/[‐-―−]/g, '-')   // ⚠ printed says "-1/-1", the glossary says "−1/−1"
  .replace(/[‘’]/g, "'")
  .toLowerCase();

/**
 * ATTRIBUTE → the printed reminder SENTENCES that are about it.
 *
 * Two narrowings, both load-bearing, both learned by measuring: whole-reminder
 * matching pairs {Swift} with {Sluggish}'s sentence off Rime Wraith, and
 * term-anywhere matching hands the {Cache} and {Recycle} rows the whole of
 * Oracle of Foretelling's effect text, which is not a reminder ABOUT caching.
 * Restricting to attributes and to the sentence naming the attribute takes the
 * false-positive count from 17 to 0 while keeping both real finds.
 */
function printedReminders(): Map<string, { card: string; sentence: string }[]> {
  const out = new Map<string, { card: string; sentence: string }[]>();
  for (const [card, def] of Object.entries(PRINTED)) {
    for (const m of (def.text ?? '').matchAll(/\{i\}\(([^)]*)\)/g)) {
      for (const sentence of norm(m[1]!).split(/(?<=\.)\s+/)) {
        for (const e of GLOSSARY) {
          if (!ATTRS.has(e.term)) continue;
          if (!new RegExp(`\\b${e.term.toLowerCase()}\\b`).test(sentence)) continue;
          if (!out.has(e.term)) out.set(e.term, []);
          const bucket = out.get(e.term)!;
          if (!bucket.some(b => b.sentence === sentence.trim())) bucket.push({ card, sentence: sentence.trim() });
        }
      }
    }
  }
  return out;
}
/**
 * R267: the pool's SECOND reminder convention — the keyword is printed as the
 * ability and the parenthetical explains it without repeating the word
 * ("Glimpse 1 {i}(Reveal the top card ...)"). `printedReminders` above cannot
 * see one, because it matches the term INSIDE the span.
 *
 * Deliberately NOT a copy of ui/glossary.ts's scoring. This checks the OUTCOME
 * the production scan claims: for a term that cites 'printed' but is invisible
 * to convention A, is there a card whose printed text names the term shortly
 * before a `{i}(...)` span? That is a fact about the pool, and it is what the
 * claim needs to be true. The whole span is kept as one "sentence" because
 * neither half of Glimpse's two names the term — per-sentence matching is
 * convention A's rule and is exactly what fails here.
 */
function leadReminders(): Map<string, { card: string; sentence: string }[]> {
  const out = new Map<string, { card: string; sentence: string }[]>();
  for (const [card, def] of Object.entries(PRINTED)) {
    const text = def.text ?? '';
    for (const m of text.matchAll(/\{i\}\(([^)]*)\)/g)) {
      const lead = norm(text.slice(0, m.index));
      const span = norm(m[1] ?? '').trim();
      // THE NEAREST KEYWORD OWNS THE SPAN, and that is not a tie-break — Shib
      // prints "[4] Ambush [Battle]{/n}{i}(Damage dealt by a blessed source
      // ...)", an Ambush card carrying a {Blessed} reminder. Without this,
      // {Ambush} claims a sentence about blessed damage.
      let nearest: { term: string; end: number } | null = null;
      for (const e of GLOSSARY) {
        const term = e.term.toLowerCase();
        for (const h of lead.matchAll(new RegExp(`\\b${term}\\b`, 'g'))) {
          const end = h.index + term.length;
          if (!nearest || end > nearest.end) nearest = { term: e.term, end };
        }
      }
      for (const e of GLOSSARY) {
        const term = e.term.toLowerCase();
        if (new RegExp(`\\b${term}\\b`).test(span)) continue;   // convention A owns it
        if (nearest?.term !== e.term) continue;
        if (lead.length - nearest.end > 30) continue;
        if (!out.has(e.term)) out.set(e.term, []);
        const bucket = out.get(e.term)!;
        if (!bucket.some(b => b.sentence === span)) bucket.push({ card, sentence: span });
      }
    }
  }
  return out;
}

const REMINDERS = (() => {
  const out = printedReminders();
  const lead = leadReminders();
  // only for the terms the production scan ACCEPTED — the derived candidate set
  // is wider than the real one (see LEAD_VERDICTS), and 245 is what pins the
  // accept/reject split. Here we only assert that an accepted claim is true.
  for (const [term, hits] of lead) {
    if (!PRINTED_REMINDERS.has(term) || out.has(term)) continue;
    out.set(term, hits);
  }
  return out;
})();

test('POSITIVE CONTROL: the printed-reminder scrape finds the pool it is supposed to read', () => {
  // if this ever silently found nothing, every "printed text wins" check below
  // would pass vacuously — which is the stripCode failure mode, three times
  // over, in docs/13 §5.
  assert.ok(REMINDERS.size >= 12,
    `only ${REMINDERS.size} attributes have a printed reminder — the scrape is broken, not the pool`);
  assert.ok(REMINDERS.get('Piercing')?.some(r => r.sentence.includes("recipient's controller")),
    "Protective Adaptations' printed {Piercing} reminder was not picked up");
  assert.ok(REMINDERS.get('Pure')?.some(r => r.sentence.includes('all other attributes')),
    "Just a Unit's printed {Pure} reminder was not picked up");
  assert.equal(REMINDERS.has('Reaping'), false,
    '{Reaping} must have NO printed reminder — if that changed, the printed text is now the spec '
    + 'and both this file and 156-reaping-and-formation should be reading it instead');
});

/* ════════════════════════════════════════════════════════════════════════
 * 3. THE CHECKS, as predicates over one row
 * ════════════════════════════════════════════════════════════════════════
 *
 * Written as functions returning complaints rather than as bare asserts so
 * §6 can run them against DELIBERATELY BROKEN rows and prove they fire. */

/** rules-significant word classes. A printed reminder using a word from a
 * class obliges the glossary row to use SOME word from the same class.
 *
 * ⚠ This table is hand-written and will be incomplete. That is survivable
 * because it is incomplete in the SAFE direction: a missing synonym turns the
 * test RED and someone reads the two sentences side by side. A missing CLASS
 * only ever means one fewer check, never a false pass. */
const WORD_CLASSES: readonly (readonly string[])[] = [
  ['controller'], ['player'], ['adjacent'], ['recursive', 'recursively', 'chain', 'onward', 'next unit'],
  ['double', 'doubled', 'twice'], ['life'], ['rot'], ['counter'], ['printed'],
  ['hand'], ['bin'], ['stack'], ['cache', 'cached'], ['bottom'], ['deck'], ['affinity'],
  ['kill', 'destroy', 'dies', 'died'], ['block'], ['draw'], ['token'],
  ['first', 'before', 'earlier'], ['last', 'after', 'later'],
  ['invert', 'revers', 'negate'], ['greater', 'higher', 'greatest', 'highest', 'larger'],
  ['cost'], ['attribute'], ['mod'], ['combat'], ['flying'], ['-1/-1'], ['mana'],
  ['reveal'], ['top'], ['spawn'], ['interact'], ['excess'], ['damage'],
];

function citationComplaints(e: GlossEntry): string[] {
  const bad: string[] = [];
  const cites = e.ruling ?? [];
  if (!cites.length) {
    bad.push(`{${e.term}}: no \`ruling\` — every row must say where its sentence comes from`);
    return bad;
  }
  for (const src of cites) {
    if (!/^R\d/.test(src)) {
      if (!['printed', 'Rulebook', 'Manual', 'CardLibrary', 'docs/08'].includes(src)) {
        bad.push(`{${e.term}}: unknown source "${src}"`);
      } else if (src === 'printed' && !REMINDERS.has(e.term)) {
        bad.push(`{${e.term}}: cites 'printed', but no card in the pool prints a reminder for it `
          + `— 'printed' is not an escape hatch`);
      } else if (src === 'CardLibrary' && !LIBRARY_REMINDERS.has(e.term)) {
        bad.push(`{${e.term}}: cites 'CardLibrary', but ui/card-library-reminders.json quotes no `
          + "card for it — 'CardLibrary' is not an escape hatch either");
      } else if (src === 'Manual' && !MANUAL_REMINDERS.has(e.term)) {
        // R252, and the same reasoning: a source a reader cannot follow is
        // worse than none, because it reads as checked. Citing the Manual
        // means ui/manual-reminders.json quotes it, with a heading and a page,
        // and 231 rebuilds that quote out of the manual itself.
        bad.push(`{${e.term}}: cites 'Manual', but ui/manual-reminders.json quotes nothing for it `
          + `— 'Manual' is not an escape hatch either`);
      }
      continue;
    }
    if (!REGISTER.has(src)) {
      bad.push(`{${e.term}}: cites ${src}, which has no \`## ${src}\` section in docs/digital-rules.md `
        + `— a citation that does not resolve is worse than none, because it reads as checked`);
      continue;
    }
    const why = staleness(src);
    if (why) {
      bad.push(`{${e.term}}: cites ${src}, which is marked "${why}" `
        + `— the row is teaching a rule that has been replaced`);
    }
  }
  return bad;
}

function printedAgreementComplaints(e: GlossEntry): string[] {
  const bad: string[] = [];
  const rems = REMINDERS.get(e.term);
  if (!rems) return bad;
  const g = norm(stated(e));
  for (const { card, sentence } of rems) {
    const missing = WORD_CLASSES
      .filter(cl => cl.some(w => sentence.includes(w)) && !cl.some(w => g.includes(w)))
      .map(cl => cl[0]!);
    if (missing.length) {
      bad.push(`{${e.term}}: the PRINTED reminder on ${card} says "${sentence}" and the glossary row `
        + `drops [${missing.join(', ')}]. Printed text wins — reword the row, not the card.`);
    }
  }
  return bad;
}

/* ════════════════════════════════════════════════════════════════════════
 * 4. THE TABLE, checked
 * ════════════════════════════════════════════════════════════════════════ */

test('CT-76: every glossary row cites a ruling, and every citation RESOLVES and is LIVE', () => {
  const bad = GLOSSARY.flatMap(citationComplaints);
  assert.deepEqual(bad, [], `\n  ${bad.join('\n  ')}\n`);
});

test('CT-80: printed text wins — no row drops a rules word its own card prints', () => {
  const bad = GLOSSARY.flatMap(printedAgreementComplaints);
  assert.deepEqual(bad, [], `\n  ${bad.join('\n  ')}\n`);
});

test('every attribute with a printed reminder ADMITS it, so a new reminder cannot be ignored', () => {
  // the other direction of the same derivation: if a card ships a reminder for
  // an attribute, the row must be reading it. Without this a row could quietly
  // opt out of §3 by not citing 'printed'.
  const missing = [...REMINDERS.keys()].filter(term => {
    const e = GLOSSARY.find(g => g.term === term);
    return !e || !(e.ruling ?? []).includes('printed');
  }).sort();
  assert.deepEqual(missing, [],
    'these attributes carry a printed reminder the glossary row does not cite');
});

test('the rows resting on NEITHER a ruling NOR printed text, by name', () => {
  // The honest size of the hole. Everything here is unchecked prose: no
  // R-number to resolve, no printed sentence to compare against. Shrinking the
  // list is real work; growing it needs a reason in the commit message.
  const unbacked = GLOSSARY
    .filter(e => !(e.ruling ?? []).some(s => /^R\d/.test(s) || s === 'printed'))
    .map(e => e.term).sort();
  assert.deepEqual(unbacked, ['Evasive', 'Resonant'],
    'Evasive is the Rulebook\'s two-blocker rule with no ruling and no printed reminder; '
    + 'Resonant comes from the Light & Dark provisional glossary (docs/08) and nothing else');
});

test('the R-numbers in this file\'s COMMENTS all resolve (they may be historical)', () => {
  // Deliberately weaker than the `ruling` check: a comment SHOULD be free to
  // say "this row used to teach R10". What it may not do is cite a number that
  // does not exist — an audit of 2026-08-26 found twelve such numbers loose
  // under digital-client/ (R134-R136, R141, R142, R163, R175-R177, R186, R201,
  // and R159, which docs/16-divergence-inventory.md:190 says outright does not
  // exist), several cited 20-40 times.
  const cited = new Set([...GLOSS_SRC.matchAll(/\bR(\d+)\b/g)].map(m => `R${m[1]!}`));
  assert.ok(cited.size > 10, `only found ${cited.size} R-numbers in ui/glossary.ts — the sweep is broken`);
  // R206 was the one named exemption here while the ruling sat in the round's
  // scratchpad — the working agent may not edit docs/digital-rules.md, so the
  // orchestrator lands it. It IS landed, so its exemption is gone.
  //
  // R248 landed 2026-08-29 (round 31) and its exemption was deleted in the same
  // commit, which is the only state this list is ever meant to rest in.
  //
  // ⚠ R252 (round 31b, report #119 — the manual is the second reminder channel)
  // is written up in the round's scratchpad and NOT YET in docs/digital-rules.md.
  // ORCHESTRATOR: delete it from this set in the commit that lands the ruling.
  const PENDING = new Set<string>();
  const dangling = [...cited].filter(t => !REGISTER.has(t) && !PENDING.has(t)).sort();
  assert.deepEqual(dangling, [],
    'ui/glossary.ts cites R-numbers with no `## R<n>` section in docs/digital-rules.md');
});

/* ════════════════════════════════════════════════════════════════════════
 * 5. SIX ROWS PINNED AGAINST THE ENGINE
 * ════════════════════════════════════════════════════════════════════════
 *
 * These are the rows whose rule is readable out of a NAMED function's source.
 * Each one re-derives the obligation from the code rather than restating the
 * answer, and each asserts it found the code first — a scrape that silently
 * matches nothing is how nine passing tests missed a live rules bypass
 * (docs/13 §5). */

/** R248: the row's COMPLETE statement — `rule` when a printed reminder took
 * over `text`, `text` otherwise. Every §5 assertion is about a generalisation
 * the printed card does not make, so this is the field that has to carry it. */
const text = (term: string): string => {
  const e = GLOSSARY.find(g => g.term === term);
  assert.ok(e, `no glossary entry for ${term}`);
  return stated(e!);
};

/** the source of `name(...)` up to the matching close, brace-counted */
function bodyOf(src: string, needle: string, where: string): string {
  const at = src.indexOf(needle);
  assert.notEqual(at, -1, `${where}: could not find \`${needle}\` — the scrape is broken, not the engine`);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail(`${where}: never closed \`${needle}\``);
}

test('R40/R133 {Trash}: `toBin` has no token check, so the row must not have one either', () => {
  const body = bodyOf(ENGINE, 'toBin(seat: Seat, name: CardName', 'E.toBin');
  assert.ok(body.length < 400, 'toBin grew a body — re-read it before trusting the check below');
  assert.doesNotMatch(body, /token/i,
    'E.toBin now mentions tokens. If the ENGINE gained a token check, this test is the wrong '
    + 'thing to change — read R133 first, then the glossary row.');
  assert.doesNotMatch(text('Trash'), /non-?token/i,
    'the row conditions trashing on being a nontoken and the engine does not. R133: the only '
    + 'printed "nontoken" wording came from Void Scavenger, a card CUT from the set.');
  assert.match(text('Trash'), /token/i, 'and it has to say so positively — tokens ARE trashed');
});

test('R61 {Feeble}/{Pure}: the block gate has a Pure carve-out, so the row must name it', () => {
  const at = APPLY.indexOf("'Feeble units cannot block'");
  assert.notEqual(at, -1, 'could not find the `Feeble units cannot block` gate in apply.ts — scrape broken');
  const gate = APPLY.slice(APPLY.lastIndexOf('e.need(', at), at);
  assert.match(gate, /Feeble/, 'the scrape did not land on the Feeble gate');
  assert.match(gate, /Pure/,
    'the engine gate no longer carves Pure out; the glossary row below is now the thing to fix');
  assert.match(text('Feeble'), /pure/i,
    '{Feeble} carries no printed reminder, so this row IS the rule — and it omitted the one '
    + 'exception the engine implements twice (apply.ts canBlockAlone and checkBlocks)');
});

test('R61 {Pure}: the engine empties the WHOLE attribute set, so the row must not list three', () => {
  assert.match(ENGINE, /pure \? new Set<string>\(\) : this\.colAttrs\(ids\)/,
    'exchangeAt no longer blanks the attribute set — re-read R61 before touching the row');
  const t = text('Pure');
  assert.match(t, /all other attributes/i, "the printed reminder's own words (Just a Unit)");
  assert.doesNotMatch(t, /switches off Flying, Evasive and Sneaky/i,
    'the superseded enumeration is back. It named three attributes; the engine blanks the set, '
    + 'and its own docstring names Piercing/Deadly/Powerful/Swift as switched off too.');
  assert.match(t, /feeble/i, 'R61: a Pure card ignores its OWN other attributes — Pure+Feeble blocks');
});

test('R79/R157 {Virus}: the battle gate is `from === hand`, and it never asks who owns the host', () => {
  const pred = bodyOf(APPLY, 'function battleAugmentAllowed', 'battleAugmentAllowed');
  assert.match(pred, /c\.virus && from === 'hand'/,
    'the base battle-augment rule changed — re-read it before trusting the row');
  assert.match(text('Virus'), /hand/i,
    'the row omitted the REAL restriction: a virus in your bin is not a battle-time augment');
  // …and the restriction it INVENTED. The battle branch checks priority and
  // region and nothing about the host's controller (R157 §26, owner verbatim:
  // "yes it can also go to an enemy. That's the whole point of the card").
  const branch = APPLY.slice(APPLY.indexOf("if (e.s.phase === 'battle') {", APPLY.indexOf('function doAugment')));
  assert.ok(branch.length > 200, 'could not find doAugment\'s battle branch — scrape broken');
  const head = branch.slice(0, branch.indexOf('zoneTake'));
  assert.doesNotMatch(head, /host\.controller/,
    'the engine gained a controller check on a battle virus — then the ROW was right all along '
    + 'and this test is the wrong thing to edit');
  assert.doesNotMatch(text('Virus'), /an ENEMY unit/i,
    'the row restricted a battle virus to enemy units. The engine never did.');
});

test('R106 {Unaware}: the layer returns PRINTED stats, so the row must say "printed"', () => {
  assert.match(ENGINE, /statAttrs\.includes\('Unaware'\)\) return this\.printedStats\(e\)/,
    'stat layer 6 no longer collapses to printed stats — re-read R106');
  const t = text('Unaware');
  assert.match(t, /printed/i,
    'the row carried R10\'s "everything counts as interacting with it" and never once stated the '
    + 'operative rule: both sides of the interaction read the numbers PRINTED on the cards');
  assert.doesNotMatch(t, /^Everything counts as interacting/i, 'R10\'s superseded wording is back');
});

test('R45/R190 {Recycle}: `recycleToBottom` pushes onto the deck, and the row says bottom', () => {
  const body = bodyOf(ENGINE, 'recycleToBottom(', 'E.recycleToBottom');
  assert.match(body, /deckOf\(seat\)\.push\(/, 'recycling no longer means "onto the bottom of the deck"');
  const t = text('Recycle');
  assert.match(t, /bottom/i);
  assert.doesNotMatch(t, /gone for the rest of the game|out of the game(?!\W)/i,
    'the pre-R190 wording is back — leaving the game is the one thing recycling never does');
});

/* ════════════════════════════════════════════════════════════════════════
 * 6. POSITIVE CONTROL — the checks, run against rows broken on purpose
 * ════════════════════════════════════════════════════════════════════════
 *
 * docs/13 §7.4: "require a positive control for every observation channel."
 * Six checkers in one round reported more sight than they had, and every one
 * of them made a number go UP. So: corrupt a row, and prove the checker names
 * it — on every run, not once by hand in a commit message. */

const MUTANTS: readonly { why: string; row: GlossEntry; expect: RegExp }[] = [
  {
    why: 'a row with no citation at all',
    row: { term: 'Piercing', text: 'anything', ruling: [] },
    expect: /no `ruling`/,
  },
  {
    why: 'a citation that does not resolve (one of the twelve loose numbers)',
    row: { term: 'Piercing', text: 'anything', ruling: ['R159'] as GlossSource[] },
    expect: /cites R159, which has no `## R159` section/,
  },
  {
    why: 'a citation to a WITHDRAWN ruling',
    row: { term: 'Piercing', text: 'anything', ruling: ['R28'] },
    // the header reads "❌ WITHDRAWN (2026-08-23) — superseded by R115"; the
    // leftmost marker wins, and which of the three it reports does not matter
    expect: /cites R28, which is marked "(?:❌|WITHDRAWN|superseded by)"/,
  },
  {
    why: 'a citation to a ruling superseded only in its BODY — the {Unaware} case',
    row: { term: 'Unaware', text: 'Everything counts as interacting with it.', ruling: ['R10'] },
    expect: /cites R10, which is marked "is the operative one"/,
  },
  {
    why: 'a citation to a NARROWED ruling',
    row: { term: 'Once', text: 'anything', ruling: ['R108'] },
    expect: /cites R108, which is marked "narrowed by R113"/,
  },
  {
    why: "'printed' claimed for an attribute no card prints a reminder for",
    row: { term: 'Reaping', text: 'anything', ruling: ['printed'] },
    expect: /cites 'printed', but no card in the pool prints a reminder for it/,
  },
  {
    why: 'the real {Piercing} bug: the printed card says controller, the row said defending player',
    row: {
      term: 'Piercing', ruling: ['R103'],
      text: 'Excess damage from its blocked column carries through to the defending player (automatic).',
    },
    expect: /PRINTED reminder on Protective Adaptations .* drops \[controller\]/,
  },
  {
    why: 'the real {Electric} bug: the printed card names the recursion, the row did not',
    row: {
      term: 'Electric', ruling: ['R4'],
      text: 'Excess damage arcs to an adjacent unit in the formation — the controller picks the path.',
    },
    expect: /PRINTED reminder on Envoy of Lightning .* drops \[recursive\]/,
  },
  {
    why: 'a {Poisonous} row whose counters quietly stopped being -1/-1',
    row: { term: 'Poisonous', ruling: ['printed'], text: 'Damage it deals becomes permanent damage counters.' },
    expect: /drops \[-1\/-1\]/,
  },
];

test('POSITIVE CONTROL: every check above goes RED on a row broken on purpose', () => {
  for (const { why, row, expect } of MUTANTS) {
    const bad = [...citationComplaints(row), ...printedAgreementComplaints(row)];
    assert.ok(bad.length, `NOTHING FIRED on: ${why}\n  row: ${JSON.stringify(row)}`);
    assert.ok(bad.some(b => expect.test(b)),
      `wrong complaint for: ${why}\n  wanted: ${expect}\n  got:\n    ${bad.join('\n    ')}`);
  }
});

test('POSITIVE CONTROL: and stays GREEN on the rows as they really are', () => {
  // the other half — a control that only ever fires would be just as blind.
  for (const e of GLOSSARY) {
    assert.deepEqual([...citationComplaints(e), ...printedAgreementComplaints(e)], [],
      `{${e.term}} does not pass its own checks`);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * 7. R248 — THE SPLIT ITSELF: shortening is not deleting
 * ════════════════════════════════════════════════════════════════════════
 *
 * Report #118 asked for the printed reminder and got it. The risk that came
 * with it is the one the file header is about: a row shortened to the printed
 * sentence has LOST the generalisation unless something holds the
 * generalisation, and nothing above this section can tell the difference —
 * every check up here now reads `stated()`, so a row whose `rule` silently
 * went missing would simply be checked against its short `text` and pass.
 *
 * These three close that. The authored table is the rules document; the
 * exported rows are what renders; and the invariant between them is that
 * every authored sentence is still on the exported row, character for
 * character, in one field or the other. */

test('R248: every authored sentence survives onto the exported row', () => {
  // THE ANTI-DELETION CHECK. Not "the row still says something about
  // Piercing" — the authored sentence, verbatim, in `rule` or in `text`.
  // Fifteen of the 43 rows have a printed reminder displacing them; the other
  // 28 have nothing to displace them and must come through untouched.
  const shown = new Map(GLOSSARY.map(e => [e.term, e]));
  const lost: string[] = [];
  for (const a of AUTHORED_GLOSSARY) {
    const e = shown.get(a.term);
    if (!e) { lost.push(`{${a.term}}: authored row has no exported row at all`); continue; }
    if (stated(e) !== a.text) {
      lost.push(`{${a.term}}: the authored rule is not on the exported row.\n`
        + `      authored: ${a.text}\n      stated:   ${stated(e)}`);
    }
  }
  assert.deepEqual(lost, [], `\n  ${lost.join('\n  ')}\n`);
  assert.equal(AUTHORED_GLOSSARY.length, GLOSSARY.length, 'a row went missing between the two tables');
});

test('R248: a row the pool prints a reminder for SHOWS that reminder, verbatim', () => {
  // The other direction, and the one that keeps report #118 fixed. Derived
  // from PRINTED_REMINDERS rather than from a list of the fifteen: a new card
  // shipping a reminder retires the corresponding edited row for free, and
  // this assertion is what notices if the row does not follow.
  const bad: string[] = [];
  for (const e of GLOSSARY) {
    const printed = PRINTED_REMINDERS.get(e.term)?.[0];
    if (!printed) {
      // R252: a second channel displaces a row now — the Algomancy Manual, for
      // seven rows no card reminds you about. The invariant is unchanged and
      // is stated here over BOTH channels rather than being relaxed for one:
      // `rule` exists exactly when something the GAME says displaced the
      // authored sentence, and the row must name which. A `rule` with neither
      // a printed nor a manual source behind it is a row that was shortened by
      // hand, which is the edit this section exists to make impossible.
      const manual = MANUAL_REMINDERS.get(e.term);
      if (manual) {
        if (e.text !== manual.text) {
          bad.push(`{${e.term}}: shows "${e.text}" but the manual says "${manual.text}" `
            + `(${manual.heading}, p.${manual.page}). Report #119: the reminder a player reads is `
            + "the game's own.");
        }
        if (e.rule === undefined) {
          bad.push(`{${e.term}}: the manual displaced its text and the authored rule did not `
            + 'move to `rule` — that is a deletion, not a shortening');
        }
        if (e.manualOn === undefined) bad.push(`{${e.term}}: manualOn is not set on a manual row`);
        if (e.printedOn !== undefined) bad.push(`{${e.term}}: printedOn is set on a manual row`);
        continue;
      }
      // R267: and a THIRD channel — a card the designer has posted that our
      // pool does not carry. Same invariant, stated over all three rather than
      // relaxed for the new one.
      const library = LIBRARY_REMINDERS.get(e.term);
      if (library) {
        if (e.text !== library.text) {
          bad.push(`{${e.term}}: shows "${e.text}" but ${library.card} says "${library.text}". `
            + "Round-32 Q6: the reminder a player reads is the game's own.");
        }
        if (e.rule === undefined) {
          bad.push(`{${e.term}}: the card library displaced its text and the authored rule did `
            + 'not move to `rule` — that is a deletion, not a shortening');
        }
        if (e.libraryOn === undefined) bad.push(`{${e.term}}: libraryOn is not set on a library row`);
        if (e.printedOn !== undefined) bad.push(`{${e.term}}: printedOn is set on a library row`);
        if (e.manualOn !== undefined) bad.push(`{${e.term}}: manualOn is set on a library row`);
      } else if (e.rule !== undefined) {
        bad.push(`{${e.term}}: carries a \`rule\` but no channel — pool, manual or card `
          + 'library — reminds a player about it, so nothing should have moved');
      }
      continue;
    }
    if (MANUAL_REMINDERS.has(e.term)) {
      bad.push(`{${e.term}}: a card prints a reminder AND ui/manual-reminders.json quotes the `
        + 'manual for it. Printed text wins; delete the manual row rather than leaving two '
        + 'sources claiming the same sentence.');
    }
    if (e.text !== printed.text) {
      bad.push(`{${e.term}}: shows "${e.text}" but ${printed.card} prints `
        + `"${printed.text}". Report #118: the reminder a player reads is the game's own.`);
    }
    if (e.printedOn !== printed.card) bad.push(`{${e.term}}: printedOn is not ${printed.card}`);
  }
  assert.deepEqual(bad, [], `\n  ${bad.join('\n  ')}\n`);
  // and the scrape is not vacuous — the same guard §2 puts on REMINDERS
  assert.ok(GLOSSARY.filter(e => e.rule !== undefined).length >= 10,
    'fewer than ten rows were displaced by a reminder the GAME gives — the split has stopped '
    + 'happening, and every check in this file that reads `stated()` is now reading a short row');
  assert.equal(GLOSSARY.filter(e => e.manualOn !== undefined).length, MANUAL_REMINDERS.size,
    'the manual channel is declared but is not reaching the exported rows');
});

test('R248: the two reminder scrapes in this repo agree, term for term', () => {
  // §2's REMINDERS reads types.ts's `Attr` union and matches per SENTENCE;
  // ui/glossary.ts's PRINTED_REMINDERS reads the pool's own `attrs` arrays and
  // keeps a whole span when only one attribute is in it. Two mechanisms, and
  // the reason for two is docs/13 §7.2 — a second look through the first
  // channel is not a second channel. They must select the same TERMS; they
  // deliberately do not always select the same TEXT (Spellbind's "You still
  // pay their costs." names no attribute, so §2 drops that sentence and the
  // player-facing one keeps it), which is asserted rather than papered over.
  assert.deepEqual([...PRINTED_REMINDERS.keys()].sort(), [...REMINDERS.keys()].sort(),
    'the attribute-union channel and the pool-attrs channel disagree about which attributes '
    + 'the pool prints a reminder for');
  const modular = PRINTED_REMINDERS.get('Modular')?.[0]?.text ?? '';
  assert.match(modular, /You still pay their costs\./,
    'the player-facing reminder must keep the whole printed span — a per-sentence scrape cuts '
    + "Spellbind's second sentence off, and that sentence is the cost rule");
});
