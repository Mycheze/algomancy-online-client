/* Wall-clock time in a named zone ⇄ an instant.
 *
 * The League page shows and takes times in the player's LEAGUE zone (the one
 * their availability is written in), which need not be the browser's — a
 * player travelling, or one who set it by hand. `Date` only speaks the
 * browser's zone, so the conversion goes through Intl. Pure; 491 checks it
 * across a daylight-saving change.
 */

const partsFmt = new Map<string, Intl.DateTimeFormat>();
function fmtFor(tz: string): Intl.DateTimeFormat {
  let f = partsFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partsFmt.set(tz, f);
  }
  return f;
}

/** the wall clock in `tz` at instant `ms`, as numbers */
export function wallClock(ms: number, tz: string): { y: number; mo: number; d: number; h: number; mi: number } {
  const p: Record<string, number> = {};
  for (const x of fmtFor(tz).formatToParts(ms)) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return { y: p['year']!, mo: p['month']!, d: p['day']!, h: p['hour']! % 24, mi: p['minute']! };
}

/** how far `tz`'s wall clock is ahead of UTC at instant `ms` */
function offsetAt(ms: number, tz: string): number {
  const w = wallClock(ms, tz);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - Math.floor(ms / 60_000) * 60_000;
}

/**
 * The instant at which `tz`'s wall clock reads `date` (YYYY-MM-DD) and
 * `minutes` past midnight. Twice round, because the offset at the first
 * guess can be the other side of a DST change. A wall time the change skips
 * (02:30 on a spring-forward night) lands an hour later, which is what a
 * person setting that time would expect.
 */
export function zonedEpoch(date: string, minutes: number, tz: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  const guess = Date.UTC(y!, mo! - 1, d!, 0, minutes);
  const first = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(first, tz);
  // the wall clock reads what was asked: done. It cannot, on the skipped
  // hour; then the two guesses straddle the gap and the later one is it.
  const w = wallClock(second, tz);
  return w.h * 60 + w.mi === minutes % 1440 ? second : Math.max(first, second);
}

/** YYYY-MM-DD of instant `ms` in `tz` */
export function dateIn(ms: number, tz: string): string {
  const w = wallClock(ms, tz);
  return `${w.y}-${String(w.mo).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
}

/** every calendar day in `tz` from the one `from` falls in to the one `to` falls in */
export function daysBetween(from: number, to: number, tz: string): string[] {
  const out: string[] = [];
  // step by 12 hours: a day is never shorter than 23, so none is skipped
  for (let t = from; t <= to; t += 12 * 3_600_000) {
    const d = dateIn(t, tz);
    if (out[out.length - 1] !== d) out.push(d);
  }
  const last = dateIn(to, tz);
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
