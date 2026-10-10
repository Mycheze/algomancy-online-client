/** Types for render.mjs: the comprehensive rules, rendered. */
import type { Extract } from './extract.d.mts';
import type { Ledger } from './ledger.d.mts';
import type { RuleRecord, Discrepancy, Verdict, Finding } from './schema.d.mts';

export interface CrInputs {
  outline: any;
  frontMatter: string;
  records: RuleRecord[];
  glossary: RuleRecord[];
  fileOf: Map<RuleRecord, string>;
  ledger: Ledger;
  verdicts: Verdict[];
  discrepancies: Discrepancy[];
  findings: Finding[];
  classification: Record<string, { scope: string; sections?: string[]; reason?: string }> | null;
  supersession: { edges: { from: string; to: string; relation: string; scope?: string | null; decision: string; note?: string }[] } | null;
}
export type RenderedFiles = { doc: string; html: string; txt: string; annexD: string; discrepanciesMd: string; changelog: string };
export function loadInputs(paths?: Partial<Record<'outline' | 'frontMatter' | 'rulesDir' | 'ledger' | 'verdicts' | 'discrepancies' | 'findings' | 'classification' | 'supersession', string>>): CrInputs;
export function outlineSections(outline: any): any[];
export function outlineSlots(outline: any, ex: Extract): { key: string; title: string; order: number; parent: string; generated?: boolean }[];
export function ledgerItems(outline: any, records: RuleRecord[], ex: Extract): import('./ledger.d.mts').LedgerItem[];
export function buildModel(inputs: CrInputs, ex: Extract): any;
export function verdictOf(M: any, rec: RuleRecord): (Verdict & { stale: boolean }) | null;
export function citedRulings(rec: RuleRecord): string[];
export function provenance(M: any): any;
export function toTxt(s: string): string;
export function render(inputs: CrInputs, ex: Extract): { ledger: Ledger; born: { num: string; key: string }[]; files: RenderedFiles };
export const OUTPUT_PATHS: Record<keyof RenderedFiles, string>;
