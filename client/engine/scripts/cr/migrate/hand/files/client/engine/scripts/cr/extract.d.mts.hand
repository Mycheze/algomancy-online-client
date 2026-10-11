/** The `Extract` interface (the control file's "Interfaces" section), as
 *  scripts/cr/extract.mjs produces it. Fields beyond the interface are marked. */

export interface RaqClaimRow {
  /** `<threadId>#<index>`, index 0-based in the thread's claims array */
  id: string;
  claim: string;
  source: string;
  status: 'covered' | 'broken' | 'outdated' | 'untestable';
  guards: string[];
  /** (beyond the interface) the CT id of a `broken` claim */
  ticket: number | null;
  note: string | null;
  /** sha256 hex of JSON [claim, source] */
  textHash: string;
}

export interface RaqThread {
  threadId: string;
  title: string;
  status: 'unreviewed' | 'reviewed' | 'skipped';
  /** (beyond the interface) the entry's own note */
  note: string | null;
  claims: RaqClaimRow[];
}

export interface CardRow {
  name: string; kind: string; timing: string; attrs: string[]; typeLine: string; text: string;
}

export interface PrintedPage { doc: 'Manual' | 'Rulebook 2023'; page: number; text: string }

export interface Enums {
  phases: string[]; battleSteps: string[]; damageSubSteps: string[]; decisionKinds: string[];
  zones: string[]; attrs: string[]; elements: string[]; cardKinds: string[]; timings: string[];
}

export interface TestFile {
  /** repo-relative path */
  file: string;
  dir: 'engine' | 'ui' | 'server';
  titles: string[];
  /** (beyond the interface) titles whose concatenation reached a non-literal and stop there */
  partialTitles?: string[];
}

export interface Extract {
  raq: RaqThread[];
  /** GlossEntry rows verbatim (a RegExp field as its `/source/flags` text). Authority: ours */
  glossary: Record<string, unknown>[];
  cards: CardRow[];
  /** printed card BACKS with rules text (Dormant Resource, …): `card: <Name>` reaches one only where no front has the name */
  cardBacks?: { name: string; typeLine?: string; text: string }[];
  printedPages: PrintedPage[];
  enums: Enums;
  tests: TestFile[];
  /** ⚠ weak: names declared in client/engine/src (functions, classes, const/let,
   *  class and object-literal methods, function-valued fields), read by `symbolsIn` */
  engineSymbols: string[];
}

export function extract(): Extract;
/** the names one TypeScript source declares (the engineSymbols scan, per file) */
export function symbolsIn(text: string): Set<string>;
