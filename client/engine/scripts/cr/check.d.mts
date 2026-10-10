/** Types for check.mjs: the mechanical half of the anti-hallucination contract. */
import type { Extract } from './extract.d.mts';
import type { CrInputs } from './render.d.mts';

export interface CheckProblem { code: string; where: string; msg: string }
export const NON_SUPERSEDING: Set<string>;
export const CLASS_SCOPES: readonly string[];
/** roots whose source a verifier quote may come from to demonstrate a rule */
export const ENGINE_EVIDENCE_ROOTS: string[];
export const DIGITAL_EVIDENCE_ROOTS: string[];
export const isAnnexD: (r: { key?: string } | null | undefined) => boolean;
export function isEvidenceSpan(r: { key?: string } | null | undefined, file: unknown): boolean;
export function indexExtract(ex: Extract): any;
export function testFilesFor(X: any, file: string): any[];
export function titleMatches(X: any, binding: string): { files: number; n: number };
export function check(inputs: CrInputs, ex: Extract, opts?: { repoRoot?: string }): {
  problems: CheckProblem[];
  stale: { kind: string; where: string; msg: string }[];
  undecided: { from: string; to: string }[];
  unclassified: string[];
  cited: Set<string>;
};
/** which drafting unit a problem / stale row belongs to (`U12`); null = global */
export function unitIndex(inputs: CrInputs): (p: { where: string }) => string | null;
