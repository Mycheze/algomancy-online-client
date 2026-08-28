export interface KnownFinding { check: string; card: string; why: string; since: string }
export const KNOWN_FINDINGS: KnownFinding[];
export function isKnown(check: string, card: string): boolean;
export function partition(findings: { check: string; card: string; detail: string }[]): {
  fresh: { check: string; card: string; detail: string }[];
  stale: KnownFinding[];
  accepted: number;
};
