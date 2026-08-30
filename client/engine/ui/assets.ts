/* Where the client's images come from — the browser's half of the question
 * scripts/paths.mjs answers for the filesystem.
 *
 * ⚠ ART_BASE IS DELIBERATELY RELATIVE, AND THE DEPTH IS LOAD-BEARING TWICE.
 *
 * Served over HTTP the page is at `/index.html`, so `../../../data/cards/`
 * resolves to `/data/cards/…` — the excess `..` clamps at the root — and
 * server/main.ts answers that route. Opened straight off disk as
 * `file://…/engine/ui/index.html`, the SAME string walks three real
 * directories up to the repo root and finds the scans there. That is the only
 * reason the no-server hotseat rig renders card art at all.
 *
 * So the string has to satisfy both readings at once, and nothing about it
 * says so. Change it, or move ui/ to a different depth, and the HTTP path goes
 * on working while `file://` silently shows broken images.
 * `test/247-asset-paths.test.ts` is what notices; read it before editing this.
 *
 * ICON_BASE is absolute because icons are only ever rendered by a served page. */
export const ART_BASE = '../../../data/cards/';

/** the game's real icon set (element pips, cost circles, markers) */
export const ICON_BASE = '/data/icons/';
