export interface Finding { check: string; card: string; detail: string }
export function auditCards(): { findings: Finding[]; cards: number };
export function auditReport(opts?: { all?: boolean }): {
  text: string;
  ok: boolean;
  fresh: Finding[];
  stale: { check: string; card: string; why: string; since: string }[];
  findings: Finding[];
};
