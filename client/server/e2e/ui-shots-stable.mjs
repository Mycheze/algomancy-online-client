/* What keeps two ui-shots runs of one build from differing for reasons that
 * are not the build (BL-64, 2026-11-07). ui-shots.mjs uses all three; they
 * live here so a test can hold them without starting Chrome.
 *
 * 1. THE ORIGIN. Every share link, invite link and deck file the client draws
 *    prints location.origin, so a run on :5182 and a run on :5183 differed in
 *    every picture that shows one (decks__share, meta__shared-deck,
 *    waiting__constructed…). Chrome now browses ONE fixed origin,
 *    SHOTS_ORIGIN, whatever port the server is on: its resolver maps the host
 *    to 127.0.0.1:<port> (--host-resolver-rules, which carries the port), and
 *    the origin is treated as secure, as 127.0.0.1 is, so clipboard and
 *    crypto behave as they did. The server's socket check compares Origin
 *    with Host, and both are SHOTS_HOST. `--port-origin` puts the old
 *    127.0.0.1:<port> origin back.
 *
 * 2. WINDOW FOCUS. A focused search box drew its accent border or not
 *    depending on whether the headless window happened to have focus (rules__*,
 *    and cards__browse as the first state of a fresh Chrome). ui-shots turns
 *    on CDP focus emulation (FOCUS_EMULATION), so the page always has it.
 *
 * 3. "LOADING…". Under load a shot caught "Loading the document…"
 *    (crreview__doc, rules__cr): the network had gone quiet but the page had
 *    not drawn the document yet. Before the picture, ui-shots waits for every
 *    visible "Loading…" line to go (stillLoadingJs); one still there after the
 *    wait is a problem in the manifest, not a silent half-drawn picture.
 */

export const SHOTS_HOST = 'ui-shots.test';
export const SHOTS_ORIGIN = `http://${SHOTS_HOST}`;

/** Chrome's flags that serve SHOTS_ORIGIN from the server on `port` */
export function originFlags(port) {
  return [
    `--host-resolver-rules=MAP ${SHOTS_HOST} 127.0.0.1:${port}`,
    `--unsafely-treat-insecure-origin-as-secure=${SHOTS_ORIGIN}`,
  ];
}

/** the CDP call that makes the page believe its window has focus */
export const FOCUS_EMULATION = ['Emulation.setFocusEmulationEnabled', { enabled: true }];

/** a placeholder line the client draws while it fetches: "Loading…",
 * "Loading the document…", "Loading your decks…", "Loading the rules…" */
export const LOADING_RE = /^Loading\b[^\n]{0,40}…$/;

/* runs IN THE PAGE, as source text: closes over nothing */
function stillLoading(re) {
  const out = [];
  for (const e of document.querySelectorAll('body *')) {
    if (e.children.length) continue;
    const t = (e.textContent || '').trim();
    if (!re.test(t)) continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    out.push(t);
  }
  return out;
}

/** the page-side check: → the visible "Loading…" lines, [] when there are none */
export function stillLoadingJs() {
  return `(${stillLoading.toString()})(${LOADING_RE.toString()})`;
}
