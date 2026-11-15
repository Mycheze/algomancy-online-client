/* Source readers for an open ticket's `proof` (a proof that reads code rather
 * than driving the engine): paths are relative to client/. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../engine/scripts/paths.mjs';

export const text = (rel: string): string => readFileSync(join(REPO_ROOT, 'client', rel), 'utf8');

/** is any of `needles` still in client/<rel>? (whitespace-normalised) */
export function still(rel: string, ...needles: string[]): boolean {
  const t = text(rel).replace(/\s+/g, ' ');
  return needles.some(n => t.includes(n.replace(/\s+/g, ' ')));
}

/** the source from `start` up to `end`; throws when `start` has moved */
export function body(rel: string, start: string, end: string): string {
  const t = text(rel);
  const i = t.indexOf(start);
  if (i < 0) throw new Error(`${rel}: "${start}" is gone`);
  const j = t.indexOf(end, i + start.length);
  return t.slice(i, j < 0 ? undefined : j);
}
