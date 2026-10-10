/** Types for ledger.mjs: the numbering ledger, the only place a rule number is born. */
export interface LedgerEntry {
  num: string; key: string; kind?: 'section'; since?: string;
  removed?: string; removedIn?: string; replacedBy?: string;
}
export interface Ledger { version: 1; entries: LedgerEntry[]; aliases: { from: string; to: string; since?: string }[] }
export interface LedgerItem { key: string; parent?: string; order?: number; num?: string; section?: boolean }
export const LETTERS: string;
export class LedgerError extends Error {}
export function letterFor(i: number): string;
export function letterIndex(s: string): number;
export function parseNum(num: string): { section: string; rule: number | null; sub: string | null } | null;
export function parentNum(num: string): string | null;
export function compareNums(a: string, b: string): number;
export function emptyLedger(): Ledger;
export function readLedger(path: string): Ledger;
export function formatLedger(l: Ledger): string;
export function resolveKey(l: Ledger, key: string): string;
export function indexLedger(l: Ledger): {
  byKey: Map<string, LedgerEntry>; byNum: Map<string, LedgerEntry>;
  entryOf(key: string): LedgerEntry | undefined; numOf(key: string): string | undefined;
};
export function allocate(
  items: LedgerItem[], ledger: Ledger,
  opts?: { edition?: string; remove?: Record<string, { reason: string; replacedBy?: string }> },
): { ledger: Ledger; born: { num: string; key: string }[]; removed: { num: string; key: string }[] };
export function appendOnlyProblems(oldL: Ledger, newL: Ledger): string[];
