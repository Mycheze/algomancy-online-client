/* The work queue, read.
 *
 * Open work is one file per ticket, `open/CT-564.ts` or `open/BL-77.ts`; the file is
 * deleted when the ticket closes. Everything settled is a line in `settled.jsonl`:
 * append-only, last row per id wins, merged with `merge=union` so two branches
 * that each append never conflict. A test claims a ticket by carrying its tag
 * (`CT-563`, `#388`) in its title; nothing in here points at a test.
 *
 * Production (the admin dashboard) reads this at request time: no ledger is
 * imported into the server.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OPEN_TICKETS_DIR, SETTLED_JSONL } from '../engine/scripts/paths.mjs';

/** a card or engine ticket */
export interface CardTicket {
  /** the number in CT-n; never reused */
  id: number;
  area: 'card' | 'attribute' | 'engine' | 'client' | 'coverage';
  /** blocker: a wrong game outcome or an unusable card; major: misreports, or a missing mechanic; minor: the rest */
  severity: 'blocker' | 'major' | 'minor';
  cards?: string[];
  title: string;
  /** what is wrong, quoting the printed clause or the report */
  detail: string;
  /** how it was found */
  evidence: string;
  /** what a fix has to do */
  fix: string;
  /** true WHILE the bug is present; tickets.test fails when it goes false. Null when nothing can check it. */
  proof: null | (() => boolean);
  /** required when proof is null: how a human checks it */
  verify?: string;
  /** the report (#N) this came from */
  reportId?: number;
  /** what the last round established, for a ticket worked down over time */
  progress?: string;
}

/** non-card work the owner asked for */
export interface BacklogTicket {
  /** BL-n; never reused */
  id: string;
  slug: string;
  title: string;
  area: 'engine' | 'client' | 'server' | 'accounts' | 'play' | 'teaching' | 'legal';
  /** S one sitting · M a long sitting · L several sessions, design first · XL a project, never off the night queue */
  size: 'S' | 'M' | 'L' | 'XL';
  track: 'qol' | 'feature';
  /** the owner's own words, verbatim; when `means` disagrees, this wins */
  said: string;
  means: string;
  /** what a human can see in the running client when it is finished */
  doneWhen: readonly string[];
  /** settled; do not re-open */
  decided?: readonly string[];
  /** open design questions; a ticket with these is not ready */
  asks?: readonly string[];
  /** tickets that must close first */
  deps?: readonly string[];
  /** repo-relative paths where the work lands */
  touches: readonly string[];
  notes?: string;
}

export type Ticket = CardTicket | BacklogTicket;

/**
 * One settled decision. `id` is `#N` (report N, its line in the report snapshot),
 * `CT-n`, `BL-n` or `verdict:<scenario>@<room>`. `as`:
 *   ticket      a report or verdict carried by the open ticket(s) in `to`
 *   partial     part of a report fixed; `to` names what is still open
 *   fixed       a report fixed; `to` names the ticket that fixed it, when there was one
 *   by-design   a report the engine is right about; `note` cites the rule, Manual page or ruling
 *   agreed-fix  a take-back two players agreed in game, with no defect; `note` says what was taken back
 *   done        a ticket finished
 *   wontfix     not being done; `note` says who decided and why
 *   dropped     a backlog ticket decided against; `note` says why
 * `legacy` marks a row migrated from the old ledgers, whose guards were never
 * tagged with its id; nothing new is legacy.
 */
export interface SettledRow {
  id: string;
  on?: string;
  as: 'ticket' | 'partial' | 'fixed' | 'by-design' | 'agreed-fix' | 'done' | 'wontfix' | 'dropped';
  to?: string[];
  note?: string;
  legacy?: true;
}

export const ticketId = (t: Ticket): string => (typeof t.id === 'number' ? `CT-${t.id}` : t.id);

/** every row, in file order (a torn or blank line is skipped) */
export function settledRows(file = SETTLED_JSONL): SettledRow[] {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return []; }
  const out: SettledRow[] = [];
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    try { out.push(JSON.parse(l) as SettledRow); } catch { /* skipped; tickets.test reports it */ }
  }
  return out;
}

/** the standing row per id: the last one */
export function settled(file = SETTLED_JSONL): Map<string, SettledRow> {
  return new Map(settledRows(file).map(r => [r.id, r]));
}

/** the open ticket ids, off the file names */
export function openIds(dir = OPEN_TICKETS_DIR): string[] {
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter(f => /^(CT|BL)-\d+\.ts$/.test(f)).map(f => f.slice(0, -3))
    .sort((a, b) => a.slice(0, 2).localeCompare(b.slice(0, 2)) || Number(a.slice(3)) - Number(b.slice(3)));
}

/** the open tickets themselves (a CT file may import the engine for its proof) */
export async function openTickets(dir = OPEN_TICKETS_DIR): Promise<Ticket[]> {
  const out: Ticket[] = [];
  for (const id of openIds(dir)) {
    out.push((await import(pathToFileURL(join(dir, `${id}.ts`)).href) as { default: Ticket }).default);
  }
  return out;
}

/** the next free number per prefix: one past every id ever used, open or settled */
export function nextIds(open = openIds(), rows = settledRows()): { CT: string; BL: string } {
  const max = (p: string) => Math.max(0, ...[...open, ...rows.map(r => r.id)]
    .filter(id => id.startsWith(`${p}-`)).map(id => Number(id.slice(3))));
  return { CT: `CT-${max('CT') + 1}`, BL: `BL-${max('BL') + 1}` };
}
