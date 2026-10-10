/** Types for harness.mjs: the draft → mutate → verify → judge → revise loop. */
import type { Extract } from './extract.d.mts';
import type { Finding, RuleRecord, Verdict } from './schema.d.mts';

export class HarnessError extends Error {}
export const VERIFIER_FIELDS: readonly string[];
export function stripForVerifier(rec: RuleRecord, num?: string): Record<string, unknown>;
export function liveRules(records: RuleRecord[]): RuleRecord[];
export function shuffleRank(unit: string, round: number, key: string): string;
export function says(x: unknown): boolean;

export interface RoundSel { keys: string[]; carried: string[]; mutable: string[] }
export function roundKeys(records: RuleRecord[], round: number,
  prev: { changed: string[]; unverified: string[]; hosts?: string[] } | null): RoundSel;

export interface Mutant { key: string; mutant: string; why_false: string }
export interface Truth {
  unit: string; round: number; keys: string[]; hosts: string[];
  mutants: { key: string; original: string; mutant: string; why_false: string }[];
  /** the record as the verifier saw it, per non-mutated key */
  verified: Record<string, { text: string; examples: RuleRecord['examples'] }>;
}
export type VerifierInput = Record<string, any>[];
export function plant(a: {
  unit: string; round: number; records: RuleRecord[]; sel: RoundSel; mutants: Mutant[];
  numOf?: (key: string) => string | undefined; minMutants?: number; maxMutants?: number;
}): { input: VerifierInput; truth: Truth };

export interface SpanProblem { file: string; text: string; why: string }
export function badSpans(spans: unknown, readText: (file: string) => string | null): SpanProblem[];

export function readVerdictDoc(doc: unknown, input: VerifierInput): {
  byKey: Map<string, any>; bugs: any[]; duplicates: string[]; unknown: string[];
};
export interface Judged {
  unit: string; round: number; mutants: number; caught: number; missed: string[]; batchValid: boolean;
  nonConfirmed: string[]; counts: Record<string, number>; missing: string[]; unknown: string[];
  duplicates: string[]; badSpans: (SpanProblem & { key: string })[];
}
export function judge(a: { truth: Truth; input: VerifierInput; doc: unknown; readText: (file: string) => string | null }): Judged;
export function buildFeedback(a: { truth: Truth; input: VerifierInput; doc: unknown; judged: Judged }): {
  unit: string; round: number; items: any[]; unverified: string[]; bugs: any[];
};

export function sameAsVerified(rec: RuleRecord, ver: Truth['verified'][string] | undefined): boolean;
export interface RoundFiles { round: number; truth: Truth; input: VerifierInput; attempts: { attempt: number; doc: unknown }[] }
export function usableRound(r: RoundFiles, readText: (file: string) => string | null): { attempt: number; byKey: Map<string, any>; bugs: any[] } | null;
export function repoPath(file: string, repoRoot?: string): string | null;
export function finalize(a: {
  unit: string; records: RuleRecord[]; rounds: RoundFiles[]; findings?: Finding[];
  readText: (file: string) => string | null; exists?: (repoRelPath: string) => boolean; repoRoot?: string;
}): {
  verdicts: Verdict[]; records: RuleRecord[]; findings: Finding[];
  report: { unit: string; verdicts: number; byVerdict: Record<string, number>; untested: string[]; stale: string[];
    unverified: string[]; invalidRounds: number[]; pendingRounds: number[]; findingsAdded: string[] };
};
export function stamp(records: RuleRecord[], ex: Extract, opts?: { refresh?: boolean }): {
  records: RuleRecord[]; filled: number; dropped: number; refreshed: number; missing: string[];
};
export function files(unit: string): Record<string, any>;
export function readSpanFile(file: string): string | null;
export function loadRounds(unit: string): RoundFiles[];
