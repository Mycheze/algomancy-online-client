/* BL-38 — THE REPLAY TRANSPORT, and the verdict that rides on it.
 *
 * A layer beside `#app`, built exactly as `ui/report.ts` is, for exactly that
 * reason: `renderNow()` writes over `#app.innerHTML` on every frame, and a
 * control bar that lived inside it would be wiped by the thing it controls.
 * Its own `data-replay` attributes (never `data-btn`, which main.ts's global
 * click handler owns), its own capture-phase listeners, and — the one that is
 * easy to miss — its own class names. It must NOT wear the board's modal scrim
 * class: `269-overlays-in-all-three-lists` derives the overlay census from
 * `renderNow`'s slots and counts that class name as a literal across
 * `ui/*.ts`, COMMENTS INCLUDED, so an honest mention of it in prose here fails
 * the census by one. (It did, first time.) This is not an overlay; it is
 * furniture: no scrim, no Escape ladder, no raise table.
 *
 * ── THE VERDICT IS NOT A DECORATION ──────────────────────────────────
 *
 * BL-38: *"a viewer that quietly showed a RECONSTRUCTED game instead of saying
 * so would be lying to the person watching."* So the chip is always present,
 * and when the replay is not the recorded game it cannot be dismissed, the
 * scrubber marks where they parted, and everything past that point is tinted.
 *
 * The number it marks is `partedAt` — where the boards diverged — and NOT
 * `refusedAt`, where this engine first choked. They are different numbers and
 * the gap is the whole of R200: on ANBB it is 93 actions. Tinting from the
 * refusal would present a third of a game that never happened as though it had.
 *
 * ── SPEED ────────────────────────────────────────────────────────────
 *
 * Default 3 actions a second (Bena). The frames are `watching` messages, which
 * bypass `pace.ts`'s one-second hold — see replayserver.ts, without which the
 * speed control would silently do nothing. Above 2/sec the bar turns `anim.ts`
 * off for the duration: the flights are 240–460 ms and at speed they overlap
 * into noise rather than reading as movement. The viewer's own motion setting
 * is put back when the replay closes.
 */
import type { ReplayServer } from './replayserver.ts';
import { motionOn, setMotionOn } from './anim.ts';

export type ReplayVerdict = 'as-recorded' | 'reconstruction' | 'unverified' | 'unreplayable';

export interface ReplayMeta {
  code: string;
  verdict: ReplayVerdict;
  reason?: string;
  forked: boolean;
  partedAt: number | null;
  refusedAt: number | null;
}

/** the speeds offered, in actions per second */
const SPEEDS = [1, 2, 3, 5, 10];
const DEFAULT_SPEED = 3;
/** above this, the FLIP/fly animations overlap into noise */
const MOTION_CEILING = 2;

let layer: HTMLElement | null = null;
let installed = false;
let server: ReplayServer | null = null;
let meta: ReplayMeta | null = null;
let speed = DEFAULT_SPEED;
let playing = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let detail = false;
let motionWas: boolean | null = null;

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** true while a replay is on screen — main.ts gates the board's hotkeys on it,
 * because Space passes priority and here it means play/pause */
export function replayActive(): boolean { return server !== null; }

/* ── the chip ─────────────────────────────────────────────────────────── */

function chip(m: ReplayMeta): { cls: string; text: string; sticky: boolean } {
  if (m.verdict === 'unreplayable') {
    return { cls: 'bad', text: 'cannot be replayed', sticky: true };
  }
  if (m.verdict === 'reconstruction') {
    return { cls: 'bad', text: `reconstruction from action ${m.partedAt}`, sticky: true };
  }
  if (m.forked) return { cls: 'warn', text: 'forked game', sticky: true };
  if (m.verdict === 'unverified') {
    return { cls: 'warn', text: 'faithfulness unverified', sticky: false };
  }
  return { cls: 'good', text: 'as recorded', sticky: false };
}

function detailText(m: ReplayMeta): string {
  if (m.verdict === 'unreplayable') {
    return `This game never recorded enough to be replayed by anything: ${esc(m.reason ?? 'no reason given')}. `
      + 'It is listed rather than hidden so that it is not simply missing.';
  }
  if (m.verdict === 'reconstruction') {
    return `The rules have changed since this game was played. Up to action ${m.partedAt} what you are `
      + 'watching is the game that happened; from there on it is what today’s engine makes of the same '
      + 'log, which is a different game. The board is tinted past that point.'
      + (m.refusedAt !== null && m.refusedAt !== m.partedAt
        ? ` (Nothing became ILLEGAL until action ${m.refusedAt} — the boards had already parted ${m.refusedAt - (m.partedAt ?? 0)} actions earlier, in silence.)`
        : '');
  }
  if (m.forked) {
    return 'The server restarted mid-game onto a changed engine, could not replay part of this log, '
      + 'rebuilt the board without those actions, and play continued from there. The file is two '
      + 'games end to end.';
  }
  if (m.verdict === 'unverified') {
    return 'This game was played before saved games recorded what the board looked like, so there is '
      + 'nothing to check this replay against. It may be exactly the game that was played; nothing here '
      + 'can tell you that it is. An admin can settle it by replaying it on the engine it was recorded on.';
  }
  return 'Every action in this replay produced the board the file says it produced. This is the game '
    + 'that was played.';
}

/* ── painting ─────────────────────────────────────────────────────────── */

function paint(): void {
  if (!layer) return;
  if (!server || !meta) { layer.innerHTML = ''; return; }
  const s = server;
  const m = meta;
  const c = chip(m);
  const total = s.total;
  const at = s.at;
  const parted = m.partedAt;
  const past = parted !== null && at > parted;

  // ⚠ the root's own class is NOT visible to ui/test/ui-driver.ts, which reads
  // each layer's innerHTML and nothing else. Anything a test has to be able to
  // see — and "this is no longer the recorded game" is the first such thing —
  // goes INSIDE. The class stays for the tint.
  layer.className = `replaybar${past ? ' parted' : ''}`;
  layer.innerHTML = `
    <div class="replayhead">
      <span class="replayroom">${esc(m.code)}</span>
      <span class="replaywhere">action ${at} / ${total}${total ? ` · turn ${s.turn}` : ''}</span>
      ${past ? '<span class="replayparted" title="past this point the recorded game and this '
        + 'replay are different games">not the recorded game</span>' : ''}
      <button class="replaychip ${c.cls}" data-replay="detail"
        title="what this replay is worth">${esc(c.text)}</button>
      <button class="replayeye${s.omniscient ? ' on' : ''}" data-replay="eye"
        title="${s.omniscient ? 'show only what you could see' : 'show both hands'}"
        >${s.omniscient ? 'both hands' : 'your view'}</button>
      <button class="replayclose" data-replay="close" title="leave the replay">×</button>
    </div>
    ${detail ? `<p class="replaydetail">${detailText(m)}</p>` : ''}
    <div class="replaytransport">
      <button data-replay="start" title="back to the beginning" ${at === 0 ? 'disabled' : ''}>⏮</button>
      <button data-replay="back" title="back one action" ${at === 0 ? 'disabled' : ''}>◀</button>
      <button data-replay="play" class="replayplay" title="${playing ? 'pause' : 'play'}"
        ${at >= total ? 'disabled' : ''}>${playing ? '⏸' : '▶'}</button>
      <button data-replay="fwd" title="forward one action" ${at >= total ? 'disabled' : ''}>▶|</button>
      <button data-replay="end" title="to the end" ${at >= total ? 'disabled' : ''}>⏭</button>
      <input type="range" class="replayscrub" data-replay="scrub"
        min="0" max="${total}" value="${at}" aria-label="action">
      <label class="replayspeed">
        <select data-replay="speed" aria-label="speed">
          ${SPEEDS.map(v => `<option value="${v}"${v === speed ? ' selected' : ''}>${v}</option>`).join('')}
        </select> /sec
      </label>
    </div>`;
}

/* ── the transport ────────────────────────────────────────────────────── */

function stop(): void {
  playing = false;
  if (timer !== null) { clearTimeout(timer); timer = null; }
}

function tick(): void {
  if (!playing || !server) return;
  if (server.at >= server.total) { stop(); paint(); return; }
  server.seek(server.at + 1);
  paint();
  timer = setTimeout(tick, Math.max(40, Math.round(1000 / speed)));
}

function applyMotion(): void {
  if (motionWas === null) motionWas = motionOn();
  setMotionOn(speed <= MOTION_CEILING && motionWas);
}

function onButton(what: string, el: HTMLElement): void {
  if (!server) return;
  const s = server;
  switch (what) {
    case 'start': stop(); s.seek(0); break;
    case 'back': stop(); s.seek(s.at - 1); break;
    case 'fwd': stop(); s.seek(s.at + 1); break;
    case 'end': stop(); s.seek(s.total); break;
    case 'play':
      if (playing) stop();
      else { playing = true; applyMotion(); tick(); return; }
      break;
    case 'eye': s.omniscient = !s.omniscient; s.push(); break;
    case 'detail': detail = !detail; break;
    case 'close': closeReplay(); return;
    case 'scrub': {
      stop();
      s.seek(Number((el as HTMLInputElement).value));
      break;
    }
    default: return;
  }
  paint();
}

/** Put the viewer's own motion setting back and leave the replay. */
export function closeReplay(): void {
  stop();
  if (motionWas !== null) { setMotionOn(motionWas); motionWas = null; }
  server = null;
  meta = null;
  detail = false;
  paint();
  location.search = '';
}

/* ── install ──────────────────────────────────────────────────────────── */

export function openReplay(s: ReplayServer, m: ReplayMeta): void {
  server = s;
  meta = m;
  speed = DEFAULT_SPEED;
  s.onChange = paint;
  // a game nothing can replay opens with its explanation already showing:
  // there is no board behind it to look at instead
  detail = m.verdict === 'unreplayable';
  paint();
}

export function installReplayBar(): void {
  if (installed) return;
  if (!document.body || typeof document.body.appendChild !== 'function') return;
  installed = true;
  layer = document.createElement('div');
  layer.id = 'replaylayer';
  document.body.appendChild(layer);

  document.addEventListener('click', e => {
    const t = (e.target as HTMLElement | null)?.closest?.('[data-replay]') as HTMLElement | null;
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    onButton(t.dataset['replay']!, t);
  }, { capture: true });

  // the scrubber and the speed select are not clicks
  document.addEventListener('input', e => {
    const t = e.target as HTMLElement | null;
    if (!t || !t.dataset?.['replay'] || !server) return;
    if (t.dataset['replay'] === 'scrub') { stop(); server.seek(Number((t as HTMLInputElement).value)); paint(); }
    if (t.dataset['replay'] === 'speed') {
      speed = Number((t as HTMLSelectElement).value) || DEFAULT_SPEED;
      if (playing) applyMotion();
      paint();
    }
  }, { capture: true });

  /* The keys, and why they are safe to take.
   *
   * Space passes priority on a live board. A replay is a spectator view, so
   * there is no priority to pass and nothing legal to do — but main.ts's
   * handler does not know that, so it is gated on `replayActive()` there
   * rather than trusted to be harmless here. */
  document.addEventListener('keydown', e => {
    if (!server) return;
    if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); onButton('play', layer!); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); onButton('back', layer!); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); onButton('fwd', layer!); }
    else if (e.key === 'Escape') { e.stopPropagation(); closeReplay(); }
  }, { capture: true });

  paint();
}
