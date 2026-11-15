/* WHICH BUNDLE THIS PAGE RUNS, AND WHEN IT TRADES UP.
 *
 * `npm run build` writes the bundle's own hash over STAMP, at the same length
 * (scripts/stamp-build.mjs). The server reads it back out of the bundle.js it
 * serves now and says so on a room's join and on every /api/ answer. A page
 * open across a deploy reloads at the first word of a different one — unless
 * a reload would cost the player something; then the next word asks again,
 * and any navigation loads the new bundle anyway. An unstamped page (the
 * tests, ?demo off disk) has nothing to compare and never reloads for this.
 */
const STAMP = 'algo-build:unstamped-00';
let own: string | null = /^algo-build:[0-9a-f]{12}$/.test(STAMP) ? STAMP.slice(11) : null;
let busy = (): boolean => false;

/** main.ts: what a reload would lose right now. `own` stands in for the stamp. */
export function installBuildCheck(o: { busy?: () => boolean; own?: string | null }): void {
  if (o.busy) busy = o.busy;
  if (o.own !== undefined) own = o.own;
}

/** The server serves `served` now; true when this page is reloading onto it. */
export function servedBuild(served: string | null | undefined): boolean {
  if (!own || !served || served === own || busy()) return false;
  location.reload();
  return true;
}
