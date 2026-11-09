/* 1203 — a dropped connection on the connecting screen is not drawn as the end.
 *
 * BL-10, docs/23-ui-inventory/05 §18.19: the "reconnect state offers '← Back
 * to the home screen' as if final". Opening a room link while the server is
 * down (or restarting) lands on the connecting screen with NetBackend's
 * "disconnected from the server — reconnecting in 2s…" in uiError — and the
 * screen drew every uiError as a refusal: red, with a big Back to the home
 * screen button, as if the room were gone. The page was still trying, and
 * joins by itself once the server answers.
 *
 * §1 is the page: a retrying line is a status, not the refusal's red, and it
 * has no way home of its own (the toolbar's Home stays, as while connecting);
 * a refusal still gets both. §2 is main.ts's wiring: the socket's close marks
 * the backend retrying, the server's first word clears it, and the connecting
 * screen is told.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RETRYING, connectingHtml } from '../pages/connecting.ts';

const DROP = 'disconnected from the server — reconnecting in 2s…';
const btns = (html: string): string[] => [...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!);

test('1203 §1 retrying is drawn as still on its way: no red, no final way home', () => {
  const retry = connectingHtml({ error: DROP, retrying: true });
  assert.match(retry, new RegExp(`<p role="status">${DROP} ${RETRYING}</p>`));
  assert.doesNotMatch(retry, /joinerr|ui-status--error|role="alert"/);
  assert.doesNotMatch(retry, /Back to the home screen/);
  assert.deepEqual(btns(retry), ['gohome'], 'only the toolbar\'s Home, as while connecting');
  // a refusal is still final, with its own way home
  const refused = connectingHtml({ error: 'There is no game with the code QXZZ.' });
  assert.match(refused, /<p class="joinerr">There is no game with the code QXZZ\.<\/p>/);
  assert.match(refused, /Back to the home screen/);
  assert.deepEqual(btns(refused), ['gohome', 'gohome']);
  // retrying with nothing to say is just connecting
  assert.match(connectingHtml({ error: '', retrying: true }), /<p>Connecting to the server…<\/p>/);
});

test('1203 §2 the socket\'s close marks the backend retrying, the server\'s answer clears it', () => {
  const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  const close = main.indexOf('this.ws.onclose = () => {');
  assert.ok(close > 0, 'NetBackend.connect moved: find the onclose again');
  const closeBody = main.slice(close, main.indexOf('this.reconnectTimer = setTimeout', close));
  assert.match(closeBody, /uiError = `disconnected from the server[^`]*`;\s*this\.retrying = true;[^]*render\(\)/,
    'the drop is marked retrying before the screen is painted');
  assert.match(main, /private onMsg\(m: NetMsg\): void \{\s*this\.retrying = false;/,
    'any word from the server ends the retry, so its refusal is drawn as one');
  assert.match(main, /\nfunction renderConnecting\(\): void \{[^]*?connectingHtml\(\{[^}]*retrying: !!NET\?\.retrying/);
});
