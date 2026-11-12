/* 1234 — the kicked notice is drawn by a page module, not by the socket class.
 *
 * BL-63's last line (the design-system round's TODO(ds) splits): the notice a
 * tab is left with when the server hands its seat to another connection was a
 * template written inline in main.ts's NetBackend message handler. It is
 * pages/connecting.ts kickedHtml now — pure, beside the other socket screen,
 * moved byte for byte (pages/README.md: "A move is not a rewrite").
 *
 * §1 the page: the old template's exact bytes, the server's reason escaped,
 *    and the old default when the server gives none.
 * §2 main.ts's kicked branch paints kickedHtml and writes no markup of its own.
 * §3 through the real client: a `kicked` push leaves exactly that markup in #app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KICKED, kickedHtml } from '../pages/connecting.ts';
import { client } from './ui-driver.ts';

/** what NetBackend wrote by hand until 2026-11-12, with the reason already escaped */
const OLD = (escaped: string): string => `<div class="joinscreen"><h2>Algomancy</h2>
        <p>${escaped}</p>
        <button data-btn="gohome">Home</button></div>`;

test('1234 §1 kickedHtml is the old notice byte for byte, the reason escaped', () => {
  const why = 'another connection took over seat 1 — this tab is done (close it, or rejoin)';
  assert.equal(kickedHtml(why), OLD(why));
  assert.equal(kickedHtml(undefined), OLD('another connection took over this seat'));
  assert.equal(KICKED, 'another connection took over this seat');
  assert.equal(kickedHtml('<b>&</b>'), OLD('&lt;b&gt;&amp;&lt;/b&gt;'));
  assert.match(kickedHtml(undefined), /data-btn="gohome"/, 'the way home is the router\'s gohome');
});

test('1234 §2 NetBackend\'s kicked branch paints kickedHtml and holds no template', () => {
  const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  const at = main.indexOf("if (m.t === 'kicked') {");
  assert.ok(at > 0, 'the kicked branch moved: find it again');
  const branch = main.slice(at, main.indexOf('return;', at));
  assert.match(branch, /this\.stopReconnecting\(\);/, 'a kicked tab must stop trying to rejoin');
  assert.match(branch, /\$app\.innerHTML = kickedHtml\(m\.msg\);/);
  assert.doesNotMatch(branch, /joinscreen|<div|<button/, 'the notice\'s markup is back in the socket class');
});

test('1234 §3 a kicked push leaves the page module\'s notice in #app', async () => {
  const ui = await client();
  // html() is #app followed by the layers hung beside it (the report pill), so
  // the notice is what #app STARTS with
  const html = ui.push({ t: 'kicked', msg: 'another connection took over seat 0 <now>' });
  assert.ok(html.startsWith(OLD('another connection took over seat 0 &lt;now&gt;')), html.slice(0, 200));
  assert.ok(ui.push({ t: 'kicked' }).startsWith(kickedHtml(undefined)));
});
