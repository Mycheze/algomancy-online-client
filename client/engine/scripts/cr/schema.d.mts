/** Types for schema.mjs: the comprehensive-rules data shapes and their validators. */
export const BASES: readonly string[];
export const CONFIDENCES: readonly string[];
export const VERDICTS: readonly string[];
export const DISC_KINDS: readonly string[];
export const TIERS: Record<1 | 2 | 3 | 4, string>;
export const MAX_QUOTE: number;
export const KEY_RE: RegExp;
export const SECTION_NUM_RE: RegExp;
export const RULE_NUM_RE: RegExp;
export const ANY_NUM_RE: RegExp;
export function norm(s: string): string;
export function textHash(s: string): string;
export function parseRulingCite(s: string): { id: string; n: number; suffix: string; scope: string } | null;
export function parseRef(ref: string): ({ type: string } & Record<string, unknown>) | null;

export interface RefQuote { ref: string; quote: string }
export interface RuleRecord {
  num?: string;
  key: string;
  /** a glossary row has `term` instead of `parent`/`order` */
  term?: string;
  obsolete?: boolean;
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
  sourceHashes: Record<string, string>;
}
export interface Discrepancy {
  id: string; kind: string; rule: string; summary: string;
  sides: { source: string; quote: string }[]; resolution: string; tier: 1 | 2 | 3 | 4;
}
export interface Verdict {
  key: string; textHash: string; verdict: string; round: number; verifier: string;
  engine: unknown[]; tests_run: { file: string; pattern?: string; passed: boolean; asserts_claim?: string }[];
  source_checks: unknown[]; quote_spans: { file: string; text: string }[]; basis_ok: boolean; problem: string;
}
export interface Finding {
  id: string; title: string; summary: string; evidence: { file: string; quote: string }[]; rule: string; ct?: string | null;
}
export function validateRecord(r: unknown): string[];
export function validateDiscrepancy(d: unknown): string[];
export function validateVerdict(v: unknown): string[];
export function validateFinding(f: unknown): string[];
export function validateLedger(l: unknown): string[];
export function validateOutline(o: unknown): string[];
