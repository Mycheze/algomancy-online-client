/* The DOM half of the sound system: loading, mixing and the idle timer.
 * ui/sfx.ts decides WHICH cue; nothing here knows a thing about Algomancy.
 *
 * Same contract the animation layer has (ui/anim.ts): sound EXPLAINS what the
 * engine already did, it never gates it. Nothing in here can delay an action,
 * swallow an input, or block a render — every play is fire-and-forget and
 * every failure is silent.
 *
 * ── two playback paths, and why ───────────────────────────────────────
 * WebAudio is the real one: fetch each sample once, decode it once, and fire
 * a BufferSource per cue through a GainNode. It has no per-play load step, so
 * a cue cannot arrive late, and gain is exact.
 *
 * It needs fetch(), which Chrome refuses on file:// URLs — and the ?demo board
 * (ui/index.html) is opened as a local file. So when the fetch or the
 * decode fails we fall back to a plain <audio> element per cue, which file://
 * does allow. The served client (the only way a real 2-player game is played)
 * always takes the WebAudio path.
 *
 * ── autoplay policy ───────────────────────────────────────────────────
 * Browsers start an AudioContext suspended and reject playback until the page
 * has seen a user gesture. We do not fight it: primeAudio() is wired to the
 * first click or keypress, where it resumes the context and warms every
 * sample, and every failure below is swallowed. By the time a cue is worth
 * hearing the player has necessarily clicked something to be in a game.
 */
import type { Cue } from './sfx.ts';

// ── the preference ────────────────────────────────────────────────────
const PREF = 'algoSound';
/** on by default — the toggle sits next to ✨ motion in the side rail */
export function soundOn(): boolean { return localStorage.getItem(PREF) !== '0'; }
export function setSoundOn(on: boolean): void {
  localStorage.setItem(PREF, on ? '1' : '0');
  if (!on) disarmIdle();
}

// ── tuning ────────────────────────────────────────────────────────────
//
// Every sample is normalised to roughly the same peak, so these gains
// ARE the mix — this table is the one place to make a cue quieter, and the
// filenames in ui/sfx/ are the one place to change what it sounds like.
// Chosen to fit under the interface rather than sit on top of it: priority is
// the tiny one you barely notice, phase is the only one that announces
// itself, and everything else lives in between.
const GAIN: Record<Cue, number> = {
  priority: 0.22,   // a 12ms tick — "it's your move"
  subphase: 0.25,   // soft rising blip — battle sub-step, haste, draft
  error: 0.28,      // short, dull — the action was refused
  decision: 0.30,   // rising two-tone — "the game is asking you something"
  phase: 0.34,      // the one cue allowed to be a real notification
  gameover: 0.40,   // long, soft, final
  thump: 0.20,      // low 196Hz thud, escalated below
  // The life pair are ours, not Kenney's (sfx/NOTICE.md) — a short bell that
  // bends UP, and a low one that falls. Both are sines, so they are louder at
  // a given peak than the clicks above and the numbers here are smaller to
  // compensate. Loud enough to hear over a resolution, quiet enough to hear
  // twenty times a game.
  lifeup: 0.26,     // small bell, bent upward — you gained life
  lifedown: 0.30,   // low falling tone — you lost life
};
const CUES = Object.keys(GAIN) as Cue[];

/** how long you can owe an action before the first thump, then between them */
const IDLE_MS = 15_000;
/** escalation for repeat thumps: louder for the first few, then it holds.
 * Past this it is no longer trying to get your attention, it is nagging. */
const THUMP_GAIN = [0.20, 0.26, 0.32];
/** two cues closer together than this are one event as far as the ear is
 * concerned — a resolution chain must not machine-gun */
const MIN_GAP_MS = 90;
/** the same cue repeating this fast is a stutter, not information */
const REPEAT_MS = 260;

/** ── channels ──────────────────────────────────────────────────────────
 *
 * The throttles above exist so one action cannot fire a burst. They are also
 * why the life cue needs a channel of its own: life moves at the exact moment
 * the damage sub-step turns, so the 'subphase' cue of that same render would
 * eat it under MIN_GAP_MS every single time — the cue for the number that
 * ends the game would be the one cue you never heard.
 *
 * So each channel throttles against itself only. Two channels, deliberately:
 * a third would be a mixer, and the point of a two-sound overlap is that it
 * is rare and means "and your life changed".
 */
type Channel = 'main' | 'life';
const channelOf = (c: Cue): Channel => (c === 'lifeup' || c === 'lifedown' ? 'life' : 'main');

/** resolved against the page, so it works under file:// and under the server */
const SRC = (c: Cue): string => `sfx/${c}.ogg`;

// ── path 1: WebAudio ──────────────────────────────────────────────────
type Ctor = new () => AudioContext;
let ctx: AudioContext | null = null;
/** set once WebAudio has proven unavailable — then we stop retrying it */
let noWebAudio = false;
const buffers = new Map<Cue, AudioBuffer>();

function context(): AudioContext | null {
  if (noWebAudio) return null;
  if (!ctx) {
    const g = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
    const AC = g.AudioContext ?? g.webkitAudioContext;
    if (!AC || typeof fetch !== 'function') { noWebAudio = true; return null; }
    try { ctx = new AC(); } catch { noWebAudio = true; return null; }
  }
  return ctx;
}

async function decode(c: Cue): Promise<void> {
  const ac = context();
  if (!ac || buffers.has(c)) return;
  try {
    const res = await fetch(SRC(c));
    if (!res.ok) throw new Error(String(res.status));
    buffers.set(c, await ac.decodeAudioData(await res.arrayBuffer()));
  } catch {
    // file:// (fetch is blocked), a missing file, or an undecodable one —
    // this cue simply uses the <audio> path from now on
  }
}

// ── path 2: <audio> elements (file://) ────────────────────────────────
const els = new Map<Cue, HTMLAudioElement>();
function element(c: Cue): HTMLAudioElement | null {
  if (typeof Audio !== 'function') return null;   // node (tests), no DOM
  let el = els.get(c);
  if (!el) {
    el = new Audio(SRC(c));
    el.preload = 'auto';
    els.set(c, el);
  }
  return el;
}

// ── priming ───────────────────────────────────────────────────────────
/** Warm everything on the first user gesture: resume the context (browsers
 * start it suspended) and decode every sample, so the first real cue of the
 * game is not late. A no-op after the first call. */
let primed = false;
export function primeAudio(): void {
  // Resuming sits OUTSIDE the once-only guard on purpose. playCue() primes
  // opportunistically when it finds nothing decoded, which can happen before
  // the page has seen any gesture — and a context created then is suspended.
  // If resume lived behind `primed`, that early call would consume the guard
  // and the first real click would never wake the context back up.
  const ac = context();
  if (ac && ac.state !== 'running') void ac.resume?.().catch(() => {});
  if (primed) return;
  primed = true;
  if (ac) for (const c of CUES) void decode(c);
  for (const c of CUES) element(c)?.load();   // the fallback path, warmed too
}

// ── playing ───────────────────────────────────────────────────────────
const lastAt: Record<Channel, number> = { main: 0, life: 0 };
const lastCue: Record<Channel, Cue | null> = { main: null, life: null };

/**
 * Play one cue. Silent when sound is off, when it arrives on the heels of
 * another ON ITS OWN CHANNEL, or when the browser refuses — never throws,
 * never blocks. `gain` overrides the table (the escalating thump).
 */
export function playCue(c: Cue, gain?: number): void {
  if (!soundOn()) return;
  const ch = channelOf(c);
  const now = Date.now();
  if (now - lastAt[ch] < MIN_GAP_MS) return;
  if (c === lastCue[ch] && now - lastAt[ch] < REPEAT_MS) return;
  lastAt[ch] = now; lastCue[ch] = c;
  const vol = Math.max(0, Math.min(1, gain ?? GAIN[c]));

  const ac = context(), buf = buffers.get(c);
  if (ac && buf) {
    try {
      // a context can go back to suspended (backgrounded tab, or the gesture
      // that primed us was never seen); resuming is idempotent and cheap
      if (ac.state !== 'running') void ac.resume?.().catch(() => {});
      const src = ac.createBufferSource();
      src.buffer = buf;
      const g = ac.createGain();
      g.gain.value = vol;
      src.connect(g).connect(ac.destination);
      src.start();
      return;
    } catch { /* fall through to the element path */ }
  }
  // Nothing decoded for this cue: either file:// (fetch is blocked, so the
  // element path is the only one) or we are still in the first moments of a
  // game and priming has not landed. Warm EVERYTHING now rather than just this
  // cue — a page that never saw the gesture primeAudio is wired to would
  // otherwise limp along on the element path one cue at a time.
  primeAudio();
  const el = element(c);
  if (!el) return;
  el.volume = vol;
  // rewinding throws if metadata has not landed — that only means the sample
  // has never played, so there is nothing to rewind. Must not take play() down.
  try { if (el.currentTime) el.currentTime = 0; } catch { /* not seekable yet */ }
  try { void el.play()?.catch(() => {}); } catch { /* never break a render */ }
}

// ── the idle thump ────────────────────────────────────────────────────
//
// Armed when an obligation NEWLY lands on you (ui/sfx.ts armsIdle), disarmed
// the moment you do anything about it. So it fires when you looked away and
// missed your turn — and stays quiet while you sit there thinking, which is
// the difference between a safety net and a nag.

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let thumps = 0;

export function disarmIdle(): void {
  if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
  thumps = 0;
}

/** (re)start the idle countdown — always from zero, always from scratch */
export function armIdle(): void {
  disarmIdle();
  if (!soundOn()) return;
  schedule();
}

function schedule(): void {
  idleTimer = setTimeout(() => {
    // still armed => still un-acted-upon; the UI disarms on any action
    playCue('thump', THUMP_GAIN[Math.min(thumps, THUMP_GAIN.length - 1)]);
    thumps++;
    schedule();
  }, IDLE_MS);
}

/** whether a thump is currently pending — exported for the tests/debugging */
export function idleArmed(): boolean { return idleTimer !== null; }
