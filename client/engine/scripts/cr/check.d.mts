/** Types for check.mjs: the mechanical half of the anti-hallucination contract. */
import type { Extract } from './extract.d.mts';
import type { CrInputs } from './render.d.mts';

export interface CheckProblem { code: string; where: string; msg: string }
export const NON_SUPERSEDING: Set<string>;
export const CLASS_SCOPES: readonly string[];
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
