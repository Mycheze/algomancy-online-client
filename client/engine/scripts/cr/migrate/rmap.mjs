/* THE R→CR MAP — step 1b of the CR-only migration (the R-ruling register is
 * being removed; every `R<n>` citation in client/ becomes a CR number).
 *
 *   node client/engine/scripts/cr/migrate/rmap.mjs      → data/comprehensive-rules/build/rmap.json
 *
 * READ-ONLY over the committed tree. It reads the records' CURRENT provenance
 * (`sources.rulings`, `sources.history`), joins each record to its number
 * through the ledger, and sorts every ruling number into one class:
 *
 *   unique-rule      one record cites it                      → that rule's number
 *   unique-section   every citing record is in one section    → the section (or, when they
 *                    all sit under one rule, that rule: `family`, e.g. 608.2 for 608.2a+608.2b)
 *   multi            records in more than one section         → no mechanical target
 *   unmapped         no record cites it                       → no target
 *
 * The SET a ruling is classified on is chosen by its status, and the choice is
 * reported, never hidden (`method`):
 *   direct    the records citing it in `sources.rulings` (current law)
 *   history   no current citer: the records that carry it in `sources.history`
 *             (the rules that now state the law it used to state)
 *   routed    no citer at all: the records citing the rulings that supersede it
 *             (supersession.json, accepted edges `to` = this ruling)
 * For superseded/withdrawn/absorbed rulings the history and routed sets are both
 * measured, and whether they agree is part of the output.
 *
 * A ruling cited with a `§N` scope (`R157 (its §27)`) also gets a per-section
 * sub-map (`R157§27`), since code cites `R157 §27` too.
 *
 * Numbers no heading defines but code cites (184-ruling-register's
 * UNREGISTERED) are added by the census, not here: no record can cite them. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CR_BUILD_DIR } from '../../paths.mjs';
import { parseRulings } from '../extract.mjs';
import { loadInputs } from '../render.mjs';
import { compareNums, indexLedger, parseNum } from '../ledger.mjs';
import { parseRulingCite } from '../schema.mjs';

export const RMAP_JSON = join(CR_BUILD_DIR, 'rmap.json');
const LIVE = new Set(['current', 'partly-superseded', 'narrowed']);
const SUPERSEDING = (e) => e.decision === 'accepted' && !['extends', 'cites', 'confirms', 'applies'].includes(e.relation);

/** classify a set of {key,num} → {class, target, family?, sections, rules} */
export function classify(hits) {
  const nums = [...new Set(hits.map((h) => h.num))].sort(compareNums);
  if (!nums.length) return { class: 'unmapped', target: null, nums };
  if (nums.length === 1) return { class: 'unique-rule', target: nums[0], nums };
  const P = nums.map(parseNum);
  const sections = [...new Set(P.map((p) => p.section))];
  if (sections.length === 1) {
    // one rule and its subrules (608.2, 608.2a, 608.2b) → 608.2
    const rules = [...new Set(P.map((p) => p.rule))];
    if (rules.length === 1 && rules[0] !== null) {
      return { class: 'unique-section', family: true, target: `${sections[0]}.${rules[0]}`, nums };
    }
    return { class: 'unique-section', family: false, target: sections[0], nums };
  }
  const bySection = {};
  for (const p of P) bySection[p.section] = (bySection[p.section] ?? 0) + 1;
  const top = Object.entries(bySection).sort((a, b) => b[1] - a[1])[0];
  return { class: 'multi', target: null, nums, sections, dominant: { section: top[0], share: top[1] / nums.length } };
}

/** is `num` at or under outline slot `sec` (`802.15` covers 802.15 and 802.15a; `608` covers 608.*) */
const under = (num, sec) => (sec === 'D' && /^D\d/.test(num)) || num === sec || num.startsWith(sec + '.') || (/^\d{3}\.\d+$|^D\d+\.\d+$/.test(sec) && new RegExp(`^${sec.replace('.', '\\.')}[a-z]+$`).test(num));

/**
 * PROPOSALS for a multi ruling — measured, NOT applied. Each narrows the
 * citing set to one anchor and classifies what is left:
 *   primary   the records under the FIRST section classification.json lists for
 *             the ruling. ⚠ nothing documents that the list is ordered by primacy.
 *   dominant  the records in the section holding most of its citers (ties: first
 *             in document order)
 */
function proposals(nums, clsSections) {
  const out = {};
  const sec0 = clsSections?.[0];
  const prim = sec0 ? nums.filter((n) => under(n, sec0)) : [];
  out.primary = prim.length ? { anchor: sec0, ...pick(classify(prim.map((num) => ({ num })))) } : { anchor: sec0 ?? null, class: 'unmapped', target: null };
  const bySec = {};
  for (const n of nums) { const s = parseNum(n).section; (bySec[s] ??= []).push(n); }
  const top = Object.entries(bySec).sort((a, b) => b[1].length - a[1].length || compareNums(a[0], b[0]))[0];
  out.dominant = { anchor: top[0], share: top[1].length / nums.length, ...pick(classify(top[1].map((num) => ({ num })))) };
  return out;
}
const pick = (c) => ({ class: c.class, target: c.target, family: c.family ?? false });

export function buildRmap() {
  const inputs = loadInputs();
  const I = indexLedger(inputs.ledger);
  const C = inputs.classification;
  const edges = inputs.supersession.edges.filter(SUPERSEDING);
  const rulings = parseRulings();

  const cur = new Map(), hist = new Map(), secMap = new Map();
  const push = (m, id, v) => (m.get(id) ?? m.set(id, []).get(id)).push(v);
  const unnumbered = [];
  for (const rec of inputs.records) {
    const num = I.numOf(rec.key);
    if (!num) { unnumbered.push(rec.key); continue; }
    const annexd = rec.key.startsWith('annexd.');
    for (const x of rec.sources?.rulings ?? []) {
      const ref = typeof x === 'string' ? x : x.ref;
      const c = parseRulingCite(ref);
      if (!c) continue;
      const quoted = typeof x === 'object' && !!x.quote;
      const hit = { key: rec.key, num, annexd, quoted, scope: c.scope || null, basis: rec.basis };
      push(cur, c.id, hit);
      for (const m of (c.scope ?? '').matchAll(/§\s?(\d+)/g)) push(secMap, `${c.id}§${m[1]}`, hit);
    }
    for (const h of rec.sources?.history ?? []) {
      const c = parseRulingCite(h.ruling ?? '');
      if (c) push(hist, c.id, { key: rec.key, num, annexd, relation: h.relation });
    }
  }

  const out = {};
  for (const r of rulings) {
    const cl = C?.[r.id] ?? {};
    const direct = cur.get(r.id) ?? [];
    const history = hist.get(r.id) ?? [];
    const supersededBy = edges.filter((e) => e.to === r.id).map((e) => ({ from: e.from, relation: e.relation, scoped: e.scope !== null }));
    const routedHits = supersededBy.flatMap((e) => cur.get(e.from) ?? []);
    const D = classify(direct), H = classify(history), R = classify(routedHits);
    let method, chosen;
    if (direct.length) { method = 'direct'; chosen = D; }
    else if (history.length) { method = 'history'; chosen = H; }
    else if (routedHits.length) { method = 'routed'; chosen = R; }
    else { method = 'none'; chosen = D; }
    const live = LIVE.has(cl.status);
    const prop = chosen.class === 'multi' ? proposals(chosen.nums, cl.sections) : null;
    out[r.id] = {
      id: r.id, title: r.title, line: r.line, status: cl.status ?? null, scope: cl.scope ?? null,
      summary: cl.summary ?? null, dates: r.dates,
      class: chosen.class, target: chosen.target, family: chosen.family ?? false, method,
      nums: chosen.nums, sections: chosen.sections, clsSections: cl.sections ?? [], proposals: prop,
      direct: { n: direct.length, class: D.class, target: D.target, quoted: direct.filter((h) => h.quoted).length,
        hits: direct.map(({ key, num, quoted, scope, annexd }) => ({ key, num, quoted, scope, annexd })) },
      history: { n: history.length, class: H.class, target: H.target, hits: history.map(({ key, num }) => ({ key, num })) },
      supersededBy,
      routed: { n: routedHits.length, class: R.class, target: R.target },
      // for a dead ruling, do the two proxies agree on where its topic now lives?
      deadAgreement: !live && history.length && routedHits.length
        ? (H.target && H.target === R.target ? 'same-target'
          : H.nums.some((n) => R.nums.includes(n)) ? 'overlap' : 'disjoint')
        : null,
    };
  }
  const sub = {};
  for (const [k, hits] of [...secMap].sort()) {
    const c = classify(hits);
    sub[k] = { class: c.class, target: c.target, family: c.family ?? false, nums: c.nums };
  }
  // ruling ids cited by records that have no heading (should be none)
  const orphanCites = [...new Set([...cur.keys(), ...hist.keys()])].filter((id) => !out[id]);
  return { rulings: out, sub, orphanCites, unnumbered };
}

export function counts(map) {
  const rows = Object.values(map.rulings);
  const by = (f) => rows.reduce((a, r) => { const k = f(r); a[k] = (a[k] ?? 0) + 1; return a; }, {});
  return {
    rulings: rows.length,
    class: by((r) => r.class),
    classFine: by((r) => r.class === 'unique-section' ? (r.family ? 'unique-section(family)' : 'unique-section(section)') : r.class),
    method: by((r) => r.method),
    classByStatus: by((r) => `${r.status} / ${r.class}`),
    classByScope: by((r) => `${r.scope} / ${r.class}`),
    directClass: by((r) => r.direct.class),
    deadAgreement: by((r) => r.deadAgreement ?? '-'),
    proposalPrimary: by((r) => r.proposals ? `${r.proposals.primary.class}${r.proposals.primary.family ? '(family)' : ''}` : '-'),
    proposalDominant: by((r) => r.proposals ? `${r.proposals.dominant.class}${r.proposals.dominant.family ? '(family)' : ''}` : '-'),
    proposalAgree: by((r) => !r.proposals ? '-' : r.proposals.primary.target && r.proposals.primary.target === r.proposals.dominant.target ? 'same' : r.proposals.primary.anchor === r.proposals.dominant.anchor ? 'same-anchor' : 'differ'),
    sub: Object.values(map.sub).reduce((a, s) => { a[s.class] = (a[s.class] ?? 0) + 1; return a; }, {}),
    orphanCites: map.orphanCites, unnumbered: map.unnumbered.length,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const map = buildRmap();
  const c = counts(map);
  mkdirSync(CR_BUILD_DIR, { recursive: true });
  writeFileSync(RMAP_JSON, JSON.stringify({ counts: c, ...map }, null, 1) + '\n');
  console.log(JSON.stringify(c, null, 1));
  console.log(`wrote ${RMAP_JSON}`);
}
