/** The `Extract` interface (the control file's "Interfaces" section), as
 *  scripts/cr/extract.mjs produces it. Fields beyond the interface are marked. */

export interface Ruling {
  n: number;
  /** '' or 'b' (R197b) */
  suffix: string;
  /** "R114" / "R197b" */
  id: string;
  /** the heading's text after the number, marks stripped; the first `###` when the heading has none */
  title: string;
  /** the ⚠ ❌ ✅ marks on the heading, in order */
  glyphs: string;
  /** the heading line, verbatim */
  heading: string;
  /** 1-based line of the heading in digital-rules.md */
  line: number;
  /** every line after the heading up to the next `## `, verbatim, trailing blank lines dropped */
  body: string;
  /** sha256 hex of `body` */
  bodyHash: string;
  dates: string[];
  /** `NNN-name.test.ts` basenames */
  testsCited: string[];
  /** other rulings cited, as ids, link anchors excluded */
  rulingsCited: string[];
  manualRefs: string[];
  /** `[Solved] …` mentions, resolved against ledgers/raq.ts titles (threadId null if none matched) */
  raqTitleRefs: { text: string; threadId: string | null }[];
}

export interface SupersessionCandidate {
  /** the ruling that supersedes / narrows / reverses … */
  from: string;
  /** the ruling it acts on */
  to: string;
  verb: string;
  where: 'heading' | 'banner' | 'body';
  /** the clause it was read from, ≤240 chars */
  ctx: string;
  /** (beyond the interface) the ruling whose text carries it */
  host: string;
}

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
  rulings: Ruling[];
  supersessionCandidates: SupersessionCandidate[];
  raq: RaqThread[];
  /** GlossEntry rows verbatim (a RegExp field as its `/source/flags` text). Authority: ours */
  glossary: Record<string, unknown>[];
  cards: CardRow[];
  printedPages: PrintedPage[];
  enums: Enums;
  tests: TestFile[];
  /** ⚠ weak: names declared in client/engine/src (functions, classes, const/let,
   *  class and object-literal methods, function-valued fields), read by `symbolsIn` */
  engineSymbols: string[];
}

export function extract(): Extract;
export function parseRulings(md?: string): Ruling[];
export function supersessionCandidates(rulings: Ruling[]): SupersessionCandidate[];
/** the names one TypeScript source declares (the engineSymbols scan, per file) */
export function symbolsIn(text: string): Set<string>;
