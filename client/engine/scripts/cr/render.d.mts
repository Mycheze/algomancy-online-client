/** Types for render.mjs: the comprehensive rules, rendered. */
import type { Extract } from './extract.d.mts';
import type { Ledger } from './ledger.d.mts';
import type { RuleRecord, Discrepancy, Verdict, Finding } from './schema.d.mts';

export interface CrInputs {
  outline: any;
  frontMatter: string;
  records: RuleRecord[];
  glossary: RuleRecord[];
  /** the file each loaded row came from: `U12.json` (rules), `verdicts/U12.json`, … */
  fileOf: Map<object, string>;
  ledger: Ledger;
  verdicts: Verdict[];
  discrepancies: Discrepancy[];
  findings: Finding[];
  classification: Record<string, { scope: string; sections?: string[]; reason?: string }> | null;
  supersession: { edges: { from: string; to: string; relation: string; scope?: string | null; decision: string; note?: string }[] } | null;
}
export type RenderedFiles = { doc: string; html: string; txt: string; annexD: string; discrepanciesMd: string; ownerQuestions: string; changelog: string };
export function loadInputs(paths?: Partial<Record<'outline' | 'frontMatter' | 'rulesDir' | 'ledger' | 'verdictsDir' | 'discrepanciesDir' | 'findingsDir' | 'classification' | 'supersession', string>>): CrInputs;
/** the drafting unit a loaded row came from (`U12`), by its file; null for a fixture row */
export function unitOfRow(inputs: CrInputs, row: object): string | null;
export function outlineSections(outline: any): any[];
export function outlineSlots(outline: any, ex: Extract): { key: string; title: string; order: number; parent: string; generated?: boolean }[];
export function ledgerItems(outline: any, records: RuleRecord[], ex: Extract): import('./ledger.d.mts').LedgerItem[];
export function buildModel(inputs: CrInputs, ex: Extract): any;
export interface ProseRef { ref: string; kind: 'key' | 'num'; num: string | undefined }
/** cross-references inside prose: keys → live numbers; refsIn lists each one (num undefined = dangling) */
export function refResolver(ledger: Ledger, I?: any): { refsIn: (s: string) => ProseRef[]; refText: (s: string) => string };
export function verdictOf(M: any, rec: RuleRecord): (Verdict & { stale: boolean }) | null;
export function citedRulings(rec: RuleRecord): string[];
export function provenance(M: any): any;
export function toTxt(s: string): string;
export function render(inputs: CrInputs, ex: Extract): { ledger: Ledger; born: { num: string; key: string }[]; files: RenderedFiles };
export const OUTPUT_PATHS: Record<keyof RenderedFiles, string>;
