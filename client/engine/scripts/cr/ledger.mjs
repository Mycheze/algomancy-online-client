/**
 * The numbering ledger: the ONLY place a rule number is born.
 *
 * A rule's identity is its permanent dotted KEY (`combat.damage.substeps`);
 * its NUMBER (`608.2`) is a citation someone may already hold, so the ledger
 * gives each key a number once and never takes it back:
 *
 *  · a number is never moved and never reused — not even a tombstone's;
 *  · a new key goes to the END of its parent, in its `order` hint, whatever
 *    its `order` says about where it "belongs" among the old ones;
 *  · a removed key becomes a tombstone `{num, key, removed, replacedBy?}`
 *    that keeps its number ("608.3f [Removed: …]");
 *  · a key is renamed only through an alias entry `{from, to}`: the number
 *    stays with the original entry and the new key resolves to it;
 *  · section numbers (`608`, `D3`) come from outline.json, but once the
 *    ledger has recorded one it holds it: a section cannot change number;
 *  · the ledger is written sorted, one entry a line, so a diff reads.
 *
 * Numbering is MTG's three levels: section `608`, rule `608.2`, subrule
 * `608.2b`. Subrule letters skip l and o (they read as 1 and 0); after z come
 * aa, ab, … (the same 24 letters in each place).
 */
import { readFileSync, existsSync } from 'node:fs';
import { SECTION_NUM_RE, RULE_NUM_RE, validateLedger } from './schema.mjs';

export const LETTERS = 'abcdefghijkmnpqrstuvwxyz';

export class LedgerError extends Error {}

/** the i-th subrule letter, 0-based: 0 → a, 23 → z, 24 → aa, 25 → ab … */
export function letterFor(i) {
  if (!Number.isInteger(i) || i < 0) throw new LedgerError(`bad letter index ${i}`);
  let s = '';
  let n = i + 1; // bijective base 24
  while (n > 0) { const r = (n - 1) % 24; s = LETTERS[r] + s; n = Math.floor((n - 1) / 24); }
  return s;
}
/** the inverse of letterFor; -1 for a string that is not a subrule letter */
export function letterIndex(s) {
  let n = 0;
  for (const ch of s) { const d = LETTERS.indexOf(ch); if (d < 0) return -1; n = n * 24 + d + 1; }
  return n - 1;
}

/** `608.2b` → {section: '608', rule: 2, sub: 'b'}; null if it is not a number */
export function parseNum(num) {
  const m = /^(\d{3}|D\d+)(?:\.(\d+)([a-z]*))?$/.exec(num);
  if (!m) return null;
  return { section: m[1], rule: m[2] === undefined ? null : Number(m[2]), sub: m[3] || null };
}
/** the number one level up: `608.2b` → `608.2`, `608.2` → `608`, `608` → null */
export function parentNum(num) {
  const p = parseNum(num);
  if (!p || p.rule === null) return null;
  return p.sub ? `${p.section}.${p.rule}` : p.section;
}

function sectionRank(s) { return s.startsWith('D') ? [1, Number(s.slice(1))] : [0, Number(s)]; }
/** document order: 100 < 100.1 < 100.1a < 100.2 < 101 … < D1 */
export function compareNums(a, b) {
  const A = parseNum(a), B = parseNum(b);
  if (!A || !B) return a < b ? -1 : a > b ? 1 : 0;
  const [ak, an] = sectionRank(A.section), [bk, bn] = sectionRank(B.section);
  if (ak !== bk) return ak - bk;
  if (an !== bn) return an - bn;
  if (A.rule !== B.rule) return (A.rule ?? -1) - (B.rule ?? -1);
  return (A.sub ? letterIndex(A.sub) : -1) - (B.sub ? letterIndex(B.sub) : -1);
}

export function emptyLedger() { return { version: 1, entries: [], aliases: [] }; }

export function readLedger(path) {
  if (!existsSync(path)) return emptyLedger();
  const l = JSON.parse(readFileSync(path, 'utf8'));
  const problems = validateLedger(l);
  if (problems.length) throw new LedgerError(`${path}: ${problems.join('; ')}`);
  return l;
}

/** deterministic text: entries in document order, aliases by `from`, one a line */
export function formatLedger(l) {
  const entries = [...l.entries].sort((a, b) => compareNums(a.num, b.num));
  const aliases = [...l.aliases].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const line = (o) => `    ${JSON.stringify(o)}`;
  const block = (xs) => (xs.length ? `[\n${xs.map(line).join(',\n')}\n  ]` : '[]');
  return `{\n  "version": 1,\n  "entries": ${block(entries.map(orderEntry))},\n  "aliases": ${block(aliases.map(orderAlias))}\n}\n`;
}
function orderEntry(e) {
  const o = { num: e.num, key: e.key };
  for (const k of ['kind', 'since', 'removed', 'removedIn', 'replacedBy']) if (e[k] !== undefined) o[k] = e[k];
  return o;
}
function orderAlias(a) {
  const o = { from: a.from, to: a.to };
  if (a.since !== undefined) o.since = a.since;
  return o;
}

/** the entry key a (possibly renamed) key resolves to, following alias chains */
export function resolveKey(l, key) {
  const seen = new Set();
  let k = key;
  for (;;) {
    const a = l.aliases.find((x) => x.to === k);
    if (!a) return k;
    if (seen.has(k)) throw new LedgerError(`alias cycle through ${key}`);
    seen.add(k);
    k = a.from;
  }
}

/** key → entry, number → entry (live entries and tombstones alike) */
export function indexLedger(l) {
  const byKey = new Map(), byNum = new Map();
  for (const e of l.entries) { byKey.set(e.key, e); byNum.set(e.num, e); }
  return {
    byKey, byNum,
    /** the entry a key names, through aliases; undefined if never numbered */
    entryOf: (key) => byKey.get(resolveKey(l, key)),
    /** a live number for a key, undefined if none (unseen or removed) */
    numOf: (key) => { const e = byKey.get(resolveKey(l, key)); return e && !e.removed ? e.num : undefined; },
  };
}

/**
 * Number every unseen key. Pure: returns a NEW ledger, never edits its input.
 *
 * items: [{key, parent, order}] for rules and slots, and
 *        [{key, num, section: true}] for the outline's sections (pinned).
 * opts:  {edition}                 stamped as `since` on what is born
 *        {remove: {key: {reason, replacedBy?}}}  tombstones to make
 *
 * → {ledger, born: [{num, key}], removed: [{num, key}]}
 * Throws LedgerError on: a duplicate key, a section number moving, a number
 * being reused (by a section or a tombstone coming back), an unresolvable or
 * too-deep parent, or a removal of a key that is still in `items`.
 */
export function allocate(items, ledger, opts = {}) {
  const edition = opts.edition;
  const l = { version: 1, entries: ledger.entries.map((e) => ({ ...e })), aliases: ledger.aliases.map((a) => ({ ...a })) };
  const problems = validateLedger(l);
  if (problems.length) throw new LedgerError(problems.join('; '));
  for (const a of l.aliases) {
    const e = l.entries.find((x) => x.key === a.from) ?? null;
    const viaAlias = l.aliases.some((x) => x.to === a.from);
    if (!e && !viaAlias) throw new LedgerError(`alias ${a.from} → ${a.to}: ${a.from} is not a ledger key`);
  }
  const idx = () => indexLedger(l);
  let I = idx();
  const born = [], removed = [];
  const stamp = (o) => (edition ? { ...o, since: edition } : o);

  // 1. keys are unique
  const seen = new Map();
  for (const it of items) {
    const k = resolveKey(l, it.key);
    if (seen.has(k)) throw new LedgerError(`key ${it.key} appears twice${k !== it.key ? ` (through an alias of ${k})` : ''}`);
    seen.set(k, it);
  }

  // 2. sections are pinned by the outline, then held by the ledger
  for (const it of items.filter((x) => x.section)) {
    if (!SECTION_NUM_RE.test(it.num)) throw new LedgerError(`section ${it.key}: ${it.num} is not a section number`);
    const e = I.entryOf(it.key);
    if (e) {
      if (e.num !== it.num) throw new LedgerError(`section ${it.key} holds ${e.num}; the outline now says ${it.num} — numbers never move`);
      if (e.removed) throw new LedgerError(`section ${it.key} (${e.num}) was removed; a removed key cannot come back`);
      continue;
    }
    const holder = I.byNum.get(it.num);
    if (holder) throw new LedgerError(`number ${it.num} is already held by ${holder.key}${holder.removed ? ' (a tombstone)' : ''}; numbers are never reused`);
    l.entries.push(stamp({ num: it.num, key: it.key, kind: 'section' }));
    born.push({ num: it.num, key: it.key });
    I = idx();
  }

  // 3. removals → tombstones
  for (const [key, why] of Object.entries(opts.remove ?? {})) {
    const e = I.entryOf(key);
    if (!e) throw new LedgerError(`cannot remove ${key}: it was never numbered`);
    if (e.removed) continue;
    if (seen.has(resolveKey(l, key))) throw new LedgerError(`cannot remove ${key}: a record or slot still has that key`);
    if (!why || !why.reason) throw new LedgerError(`removing ${key} needs a reason`);
    e.removed = why.reason;
    if (edition) e.removedIn = edition;
    if (why.replacedBy) e.replacedBy = why.replacedBy;
    removed.push({ num: e.num, key: e.key });
  }
  I = idx();

  // 4. a tombstoned key cannot come back
  for (const it of items) {
    const e = I.entryOf(it.key);
    if (e && e.removed) throw new LedgerError(`key ${it.key} was removed (${e.num} [Removed: ${e.removed}]); a removed key cannot come back — give the rule a new key`);
  }

  // 5. rules: allocate under their parent, parents first
  let pending = items.filter((x) => !x.section && !I.entryOf(x.key));
  while (pending.length) {
    const ready = new Map(); // parent num → items
    const later = [];
    for (const it of pending) {
      const p = parentNumberOf(it.parent, I);
      if (p === undefined) { later.push(it); continue; }
      if (!ready.has(p)) ready.set(p, []);
      ready.get(p).push(it);
    }
    if (ready.size === 0) {
      throw new LedgerError(`cannot number ${later.map((x) => `${x.key} (parent ${x.parent})`).join(', ')}: the parent is not a section, a numbered rule, or a key being numbered`);
    }
    for (const [p, group] of [...ready].sort((a, b) => compareNums(a[0], b[0]))) {
      group.sort((a, b) => a.order - b.order || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      const pp = parseNum(p);
      if (!pp || pp.sub) throw new LedgerError(`cannot number ${group[0].key} under ${p}: rules go three levels deep at most (608, 608.2, 608.2b)`);
      const children = l.entries.filter((e) => parentNum(e.num) === p).map((e) => parseNum(e.num));
      if (pp.rule === null) {
        let next = Math.max(0, ...children.map((c) => c.rule)) + 1;
        for (const it of group) { const num = `${p}.${next++}`; l.entries.push(stamp({ num, key: it.key })); born.push({ num, key: it.key }); }
      } else {
        let next = Math.max(-1, ...children.map((c) => letterIndex(c.sub))) + 1;
        for (const it of group) { const num = `${p}${letterFor(next++)}`; l.entries.push(stamp({ num, key: it.key })); born.push({ num, key: it.key }); }
      }
    }
    I = idx();
    pending = later;
  }
  return { ledger: l, born, removed };
}

/** a parent reference → the number children hang under; undefined if not (yet) known */
function parentNumberOf(parent, I) {
  if (typeof parent !== 'string' || !parent) return undefined;
  if (SECTION_NUM_RE.test(parent) || RULE_NUM_RE.test(parent) || /^(?:\d{3}|D\d+)\.\d+[a-z]+$/.test(parent)) {
    const e = I.byNum.get(parent);
    return e && !e.removed ? parent : undefined;
  }
  return I.numOf(parent);
}

/**
 * Append-only: every number the old ledger held, the new one holds, with the
 * same key; a tombstone stays a tombstone; an alias stays. → problems[]
 */
export function appendOnlyProblems(oldL, newL) {
  const out = [];
  const N = indexLedger(newL);
  for (const e of oldL.entries) {
    const n = N.byNum.get(e.num);
    if (!n) { out.push(`${e.num} (${e.key}) was dropped from the ledger`); continue; }
    if (n.key !== e.key) out.push(`${e.num} was ${e.key} and is now ${n.key}: a number is never reused`);
    if (e.since !== n.since) out.push(`${e.num}: its edition stamp changed (${e.since} → ${n.since})`);
    if (e.removed && n.removed !== e.removed) out.push(`${e.num} (${e.key}) was a tombstone and is not one now (or its reason changed)`);
    if (e.replacedBy !== undefined && n.replacedBy !== e.replacedBy) out.push(`${e.num}: replacedBy changed`);
  }
  for (const k of new Set(oldL.entries.map((e) => e.key))) {
    const o = oldL.entries.find((e) => e.key === k), n = N.byKey.get(k);
    if (n && n.num !== o.num) out.push(`${k} moved from ${o.num} to ${n.num}: numbers never move`);
  }
  for (const a of oldL.aliases) {
    if (!newL.aliases.some((b) => b.from === a.from && b.to === a.to)) out.push(`alias ${a.from} → ${a.to} was dropped`);
  }
  out.push(...validateLedger(newL));
  return out;
}

/** CLI: `node ledger.mjs remove <key> "<reason>" [replacedByKey]` · `alias <oldKey> <newKey>` */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { CR_LEDGER, CR_OUTLINE } = await import('../paths.mjs');
  const { writeFileSync } = await import('node:fs');
  const [cmd, a, b, c] = process.argv.slice(2);
  const l = readLedger(CR_LEDGER);
  const edition = existsSync(CR_OUTLINE) ? JSON.parse(readFileSync(CR_OUTLINE, 'utf8')).edition?.name : undefined;
  if (cmd === 'remove' && a && b) {
    const { ledger } = allocate([], l, { edition, remove: { [a]: { reason: b, replacedBy: c } } });
    writeFileSync(CR_LEDGER, formatLedger(ledger));
    console.log(`tombstoned ${a}`);
  } else if (cmd === 'alias' && a && b) {
    if (!indexLedger(l).entryOf(a)) throw new LedgerError(`${a} is not a ledger key`);
    if (indexLedger(l).byKey.has(b)) throw new LedgerError(`${b} is already a ledger key`);
    l.aliases.push(edition ? { from: a, to: b, since: edition } : { from: a, to: b });
    writeFileSync(CR_LEDGER, formatLedger(l));
    console.log(`aliased ${a} → ${b}`);
  } else {
    console.error('usage: node ledger.mjs remove <key> "<reason>" [replacedByKey] | alias <oldKey> <newKey>');
    process.exit(2);
  }
}
