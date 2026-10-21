/* THE RULES QUESTION BOARD, END TO END THROUGH ui/main.ts — `?question=<id>`.
 *
 * 527 proves the staged boards are legal and say what their captions say. This
 * proves the page a link opens is wired to them:
 *
 *   §1  signed OUT, with nothing fetched, the link paints the real board and
 *       the replay transport with the question above it: title, moments, the
 *       "staged position" chip, and the link to copy. The point of the page is
 *       that anybody can open it from a Discord post.
 *   §2  it opens on the question's chosen moment, a moment button moves the
 *       board there and shows that moment's note, and the board is a spectator
 *       board — nothing on it can send an action.
 *   §3  at the end nobody is told "You win!": a question is nobody's game.
 *   §4  the way in (every-page-has-a-button): the rules review toolbar lists
 *       every question with an open link and a copy button, and main.ts
 *       treats the link as a board, not as the home screen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { questionById, stageQuestion } from '../questions.ts';

const ID = 'transmogrifant-control-change';
const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = `?question=${ID}`;
// signed out: no token, and every fetch refused, so nothing here can come
// from a server
g['__UI_DRIVER_STORE'] = {};
g['__UI_DRIVER_FETCH'] = (url: string) => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ ok: false, url }) });

const { replay } = await import('./ui-driver.ts');
const settle = (): Promise<void> => new Promise(r => { setImmediate(() => r()); });
await settle();
const ui = replay();
const q = questionById(ID)!;
const staged = stageQuestion(q);

/** "action 12 / 26" → 12 */
function where(html: string): number {
  const m = /action (\d+) \/ (\d+)/.exec(html);
  assert.ok(m, 'the bar is not saying where it is');
  return Number(m[1]);
}

test('§1 a signed-out link paints the board, the transport and the question', () => {
  const html = ui.html();
  assert.match(html, /class="replaytransport"/, 'the transport did not install');
  assert.match(html, /class="table|regionpanel|stickytop|lboard/, 'the board renderer never painted');
  assert.ok(html.includes(q.title.replace(/"/g, '&quot;')), 'the question title is not on the page');
  assert.match(html, /staged position/i, 'the chip does not say this is a staged position');
  assert.ok(html.includes(`?question=${ID}`), 'no link to copy');
  assert.ok(ui.has({ replay: 'copylink' }), 'no copy-link button');
  assert.equal((html.match(/data-replay="moment"/g) ?? []).length, staged.marks.length, 'one button per moment');
  assert.doesNotMatch(html, /Djentleman|Yagamino/, 'a real player name leaked into the staging');
});

test('§2 it opens on the chosen moment, and a moment button moves the board there', async () => {
  assert.equal(where(ui.html()), staged.opens, 'the page did not open on its chosen moment');
  const after = staged.marks.find(k => k.label === 'After the switch')!;
  ui.click({ replay: 'moment', at: after.at });
  await settle();
  const html = ui.html();
  assert.equal(where(html), after.at);
  assert.ok(html.includes(after.note.replace(/'/g, '&#39;')) || html.includes(after.note.slice(0, 40)),
    'the moment note is not shown');
  assert.match(html, new RegExp(`rqmoment on"[^>]*data-at="${after.at}"`), 'the moment on screen is not the one lit');
  // a spectator board: nothing a click could send
  assert.doesNotMatch(html, /data-btn="pass"/, 'a question board offered a pass button');
});

test('§3 at the end the winner is named, nobody is told they won', async () => {
  ui.click({ replay: 'end' });
  await settle();
  const html = ui.html();
  assert.equal(where(html), staged.file.actions.length);
  assert.match(html, /Player A wins/, 'the end of the question does not say who won');
  assert.doesNotMatch(html, /You win!/, 'a stranger opening the link was told they won');
});

const UI = dirname(dirname(fileURLToPath(import.meta.url)));
const src = (f: string): string => readFileSync(join(UI, f), 'utf8');
const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('§4 the way in: the rules review toolbar lists every question, and the link is a board', () => {
  const page = code(src('crreview.ts'));
  assert.match(page, /data-btn="cr-questions"/, 'no Questions button on the rules review toolbar');
  assert.match(page, /QUESTIONS\.map\(/, 'the list is not derived from the library');
  assert.match(page, /href="\/\?question=\$\{encodeURIComponent\(q\.id\)\}"/, 'no open link per question');
  assert.match(page, /data-btn="cr-qcopy"/, 'no copy button per question');
  const main = code(src('main.ts'));
  const inGame = /const inGame = [^;]*;/.exec(main)?.[0] ?? '';
  assert.ok(inGame.includes("params.get('question')"),
    'a question link is not in inGame: the profile fetch would paint the home screen over the board (BL-38 §7)');
});
