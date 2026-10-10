/** Types for schema.mjs: the comprehensive-rules data shapes and their validators. */
export const BASES: readonly string[];
export const CONFIDENCES: readonly string[];
export const VERDICTS: readonly string[];
export const DISC_KINDS: readonly string[];
export const TIERS: Record<1 | 2 | 3 | 4, string>;
export const MAX_QUOTE: number;
export const KEY_RE: RegExp;
export const GLOSSARY_TAG_KINDS: readonly string[];
export const GLOSSARY_TAG_RE: RegExp;
export const SECTION_NUM_RE: RegExp;
export const RULE_NUM_RE: RegExp;
export const ANY_NUM_RE: RegExp;
export function norm(s: string): string;
export function textHash(s: string): string;
/** what a verdict pins: the text, plus the examples and their bindings when there are any */
export function recordHash(r: { text: string; examples?: { text: string; test?: string | null }[] }): string;
export const FINDING_ID_RE: RegExp;
export const REGISTER_FINDING_RE: RegExp;
export function parseRulingCite(s: string): { id: string; n: number; suffix: string; scope: string } | null;
export function parseRef(ref: string): ({ type: string } & Record<string, unknown>) | null;

export interface RefQuote { ref: string; quote: string }
export interface RuleRecord {
  num?: string;
  key: string;
  /** a glossary row has `term` instead of `parent`/`order` */
  term?: string;
  obsolete?: boolean;
  /** glossary row: the derived term sources it covers ("zone:bin", "attr:Flying", "keyword:<801/803 key>", …) */
  derived?: string[];
  /** glossary row, required when obsolete: a source that uses the old name */
  usedBy?: RefQuote[];
  parent?: string;
  order?: number;
  text: string;
  examples: { text: string; test?: string | null }[];
  see: string[];
  sources: {
    printed?: RefQuote[];
    designer?: RefQuote[];
    ours?: RefQuote[];
    rulings?: (string | { ref: string; quote?: string })[];
    history?: { ruling: string; relation: string }[];
    engine?: string[];
    tests?: string[];
  };
  /** required on a rule; a glossary row leaves both to the rule it points at */
  basis?: string;
  confidence?: string;
  notes?: string;
  engineDiffers?: string[];
  /** no executed test or probe demonstrates it (set by harness finalize, cleared by the promoter) */
  untested?: boolean;
  /** the rule has nothing to execute (a definition, a table-only fact, a format the engine does not run): why, in one line */
  untestableReason?: string;
  sourceHashes: Record<string, string>;
}
export interface Discrepancy {
  id: string; kind: string; rule: string; summary: string;
  sides: { source: string; quote: string }[]; resolution: string; tier: 1 | 2 | 3 | 4;
  /** the same question filed by another unit, merged into this item (its sides unioned here) */
  seeAlso?: { id: string; rule: string }[];
  /** tier 1 only, and required there: what owner-questions.md is rendered from */
  question?: OwnerQuestion;
}
export interface OwnerQuestion {
  topic: string; ask: string;
  /** reading A, reading B, …: what each says and what it changes at the table */
  readings: { label: string; text: string; table: string }[];
  /** which reading the document follows today */
  follows: string;
  /** the recommendation under the owner's steer */
  recommend: string;
}
export const QUESTION_FIELDS: readonly string[];
export interface Verdict {
  key: string; textHash: string; verdict: string; round: number; verifier: string;
  engine: unknown[]; tests_run: { file: string; pattern?: string; passed: boolean; asserts_claim?: boolean | string }[];
  probes?: { file: string; title?: string; passed: boolean; demonstrates?: boolean | string }[];
  source_checks: unknown[]; quote_spans: { file: string; text: string }[]; basis_ok: boolean; problem: string;
  /** spans the verifier quoted from files the gate cannot read (the gitignored build dir, outside the repo) */
  scratch_spans?: { file: string; text: string }[];
}
export interface Finding {
  id: string; title: string; summary: string; evidence: { file: string; quote: string }[];
  /** null only on a register-level finding (F-REG-<n>) */
  rule: string | null; ct?: string | null;
  /** on the canonical finding of a defect: the other findings that describe it */
  dupes?: string[];
  /** why a re-checked finding is not filed as its own ticket (rebutted, or held by another) */
  closed?: string;
}
export function validateRecord(r: unknown): string[];
export function validateDiscrepancy(d: unknown): string[];
export function validateVerdict(v: unknown): string[];
export function validateFinding(f: unknown): string[];
export function validateLedger(l: unknown): string[];
export function validateOutline(o: unknown): string[];
