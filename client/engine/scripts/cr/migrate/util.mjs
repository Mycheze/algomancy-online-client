/* Shared helpers for the migration's post-hand steps (rebind, repin): nothing
 * here imports the register-era scripts, so they still load after the hand
 * step has rewritten extract.mjs and schema.mjs. */

/** a JSON file's own indent (2, 1, or a tab), so a rewrite keeps its formatting */
export function indentOf(text) {
  const m = /^\[?\{?\n(\s+)/.exec(text);
  return m ? (m[1].includes('\t') ? '\t' : m[1].length) : 2;
}
