/* 1202 — the connecting screen says what it is actually waiting for.
 *
 * BL-10, docs/23-ui-inventory/05 §18.15: "'Connecting to the server…' shown
 * while loading a replay file or booting a local lesson". Only a room link
 * waits for the server. A replay, a watched challenge run, a lesson, a
 * challenge and a rules question are opened IN this page (a ReplayServer or a
 * SoloServer behind the openSocket seam) — there is no server to connect to,
 * and a replay that takes a moment to fetch read as a connection problem.
 *
 * §1 is the page: the line it is given is the line it draws, a refusal still
 * replaces it, and with none it still says "Connecting to the server…".
 * §2 is the census over main.ts's boot chain: every branch that paints the
 * connecting screen, other than the room link's, names its own line (or a
 * refusal) before it does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONNECTING, connectingHtml } from '../pages/connecting.ts';

test('1202 §1 the connecting screen draws the line it is given, and a refusal over it', () => {
  assert.match(connectingHtml({ error: '' }), /<p>Connecting to the server…<\/p>/);
  assert.equal(CONNECTING, 'Connecting to the server…');
  const replay = connectingHtml({ error: '', waiting: 'Loading the replay…' });
  assert.match(replay, /<p>Loading the replay…<\/p>/);
  assert.doesNotMatch(replay, /Connecting to the server/);
  const refused = connectingHtml({ error: 'no replay for <QXZZ>', waiting: 'Loading the replay…' });
  assert.match(refused, /<p class="joinerr">no replay for &lt;QXZZ&gt;<\/p>/);
  assert.doesNotMatch(refused, /Loading the replay/);
});

test('1202 §2 only the room link\'s boot branch says "Connecting to the server…"', () => {
  const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  const start = main.indexOf("if (params.has('room') && params.get('room')!.trim()) {");
  assert.ok(start > 0, 'the boot chain moved: find its first branch again');
  const end = main.indexOf("} else if (params.has('demo')) {", start);
  assert.ok(end > start, 'the boot chain moved: find the demo branch again');
  const branches = main.slice(start, end).split(/\n\} else if /);
  assert.ok(branches.length >= 7, `expected the room, learn, practice, challenge ×2, replay and question branches, got ${branches.length}`);
  const seen: string[] = [];
  for (const b of branches) {
    const head = b.slice(0, b.indexOf('{')).trim();
    if (!b.includes('renderConnecting()')) continue;
    if (head.startsWith("if (params.has('room')")) {
      assert.doesNotMatch(b, /connectingLine =/, 'a room link does wait for the server');
      continue;
    }
    // every renderConnecting() in the branch comes after a line of its own or a refusal
    let at = 0;
    for (;;) {
      const i = b.indexOf('renderConnecting()', at);
      if (i < 0) break;
      assert.match(b.slice(0, i), /connectingLine = '[^']+'|uiError = /,
        `${head}: paints "Connecting to the server…" though nothing here connects to one`);
      at = i + 1;
    }
    seen.push(head);
  }
  assert.equal(seen.length, 6, `the in-page branches: ${seen.join(' | ')}`);
});
