/* Getting a player's attention from a background tab.
 *
 * Every cue the client has is a SOUND, and a sound is easy to miss: the tab is
 * muted, the speakers are off, or the player is reading Discord in the next
 * tab while the matchmaking offer counts down. The one thing every browser
 * shows for a background tab without asking permission is its TITLE — so when
 * the page wants you and you are not looking at it, the title flashes the
 * reason until you come back.
 *
 * Three callers, each at the place that already knows it wants you:
 *   · ui/queue.ts — a match was found, and the offer expires;
 *   · ui/main.ts's soundPass — the game is asking you something (the same
 *     diff that picks the "decision"/"priority" cue), or it ended;
 *   · ui/main.ts's NetBackend — the room you were waiting in filled up.
 *
 * Nothing happens while the tab is visible: a player looking at the page does
 * not need the title to tell them what is on it. The flashing stops, and the
 * title comes back, the moment the tab is shown or focused again.
 */

const BASE = 'Algomancy';

/** The title on beat `beat` of a flash: the message, then the plain title,
 * alternating. Pure, so the test does not need a document. */
export function flashTitle(message: string, beat: number, base: string = BASE): string {
  return beat % 2 === 0 ? `${message} — ${base}` : base;
}

let timer = 0;
let message = '';
let base = BASE;

const hasPage = (): boolean =>
  typeof document !== 'undefined' && typeof window !== 'undefined' && typeof window.setInterval === 'function';

/** Flash `why` in the title — only while the tab is hidden. A second alert
 * during a flash replaces the message and keeps the one timer. */
export function alertTab(why: string): void {
  if (!hasPage() || document.hidden !== true) return;
  message = why;
  if (timer) return;
  base = document.title || BASE;
  let beat = 0;
  document.title = flashTitle(message, beat++, base);
  timer = window.setInterval(() => { document.title = flashTitle(message, beat++, base); }, 1000);
}

function stop(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = 0;
  document.title = base;
}

let installed = false;

/** Stop flashing when the player comes back. Called once, from ui/main.ts. */
export function installTabAlert(): void {
  if (installed || !hasPage() || typeof document.addEventListener !== 'function') return;
  installed = true;
  document.addEventListener('visibilitychange', () => { if (document.hidden === false) stop(); });
  window.addEventListener('focus', stop);
}
