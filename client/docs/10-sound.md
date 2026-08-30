# 10 — Sound: phase cues, priority, and the idle thump

*Built 2026-08-20, playtest round 8.*

> "Just a simple set of sounds, sorta like MTGO. Nothing crazy or fancy, just notification
> sounds for changing of subphases or full phases, tiny sound on receiving priority or
> needing to make a choice, a sort of 'thumping sound' if you haven't reacted in 15 seconds
> (just in case you're looking away)."
> — Bena

The board is legible once you are looking at it ([09](09-visual-clarification.md)). This
layer is about the moments you are *not* looking at it: your opponent is thinking, you
tabbed away, and the game has quietly become your problem again.

## The contract

**Sound explains what the engine already did. It never gates it.**

Identical to the motion contract, and for the same reasons. Every play is fire-and-forget,
every failure is swallowed, nothing is awaited. A missing file, a muted tab, a browser that
refuses to play audio before a user gesture — all of it degrades to silence, and none of it
can delay an action or break a render.

## The split

The same two-file shape the motion layer uses, because it is the shape the client's
full-redraw architecture forces:

| file | job | tested by |
|---|---|---|
| `ui/sfx.ts` | DOM-free. Snapshot the audible shape of a state; diff two snapshots; return **at most one cue**. | `test/54-ui-sfx.test.ts` |
| `ui/audio.ts` | WebAudio playback, the mix, the idle timer. Knows nothing about Algomancy. | same file, with stubbed globals + mock timers |

The client re-renders everything after every action, so "the phase just changed" does not
exist anywhere in the DOM — it exists only as a difference between the state the board was
painted from and the new one. `soundPass()` in `main.ts` runs right after the motion pass
and does exactly that.

Snapshots are taken **from the viewer's own view**, which in network mode is the redacted
state the server sent that seat. You hear what you can see, and nothing that would leak the
opponent's half — their decision is redacted to `null`, so it can never cue you.

## The one-cue rule

A single action routinely moves several audible things at once: the phase flips, the
sub-step flips with it, and priority lands on you. Playing three sounds for one click is the
distracting failure mode, so a diff yields **one** cue, by precedence:

```
gameover  >  decision  >  phase  >  subphase  >  priority
```

The most *actionable* thing wins, because the cue you actually need is the one that says
"it's on you now". Everything quieter is dropped, not queued.

## Arming ≠ hearing

The idle thump does **not** key off which cue won that contest. It reads the snapshots
directly (`armsIdle(before, after)`).

This matters for one transition in particular: deployment ending into your planning phase
moves the phase *and* hands you the game. `phase` wins precedence, so keying the thump off
the winning cue would leave it unarmed on the transition you are likeliest to have wandered
off during — the exact case it exists for. **Precedence decides what you hear; the state
decides what you owe.**

## When the thump fires

Armed when an obligation *newly arrives*. Disarmed the moment you act, and never re-armed
until a new obligation lands.

That distinction is the whole design. Re-arming on every state change would nag you every 15
seconds while you sit there thinking through your own planning phase, which inverts the
point. Arming only on arrival means it catches "you looked away and missed your turn" and
stays silent while you are plainly at the keyboard.

It escalates `0.20 → 0.26 → 0.32` and then **holds** — past that it is no longer trying to
get your attention, it is nagging. Network mode only: in hotseat the game is never waiting
on someone who is not in the room.

## Staying silent

The failure mode that would make this layer unusable is a state arriving *wholesale* — a
fresh join, a reconnect resync, an undo's full-log replay, a return from the home screen —
and firing cues for changes nobody just made. A mid-game refresh must not announce a phase
that turned ten minutes ago.

`sfxReset()` drops the baseline at every one of those points (alongside `motionReset()`,
which needs it for the same reason), and `diffSfx(null, …)` is silent by construction.

## The samples

Seven `.ogg` files in `ui/sfx/`, from Kenney's **Interface Sounds** pack — CC0 /
public domain, no attribution required (`sfx/LICENSE-kenney.txt`). ~54 KB total.

Picked by measuring all 100 samples in the pack for duration, peak, RMS and spectral
centroid, then choosing a dark, short, consistent set — the goal was cues that sit *under*
the interface rather than on top of it.

| cue | file | source | dur | brightness | gain | fires when |
|---|---|---|---|---|---|---|
| `priority` | `priority.ogg` | `click_002` | 12ms | 919Hz | 0.22 | your move arrives |
| `subphase` | `subphase.ogg` | `maximize_008` | 225ms | 359Hz | 0.25 | battle sub-step, haste, draft |
| `error` | `error.ogg` | `error_008` | 139ms | 1762Hz | 0.28 | an action was refused |
| `decision` | `decision.ogg` | `question_002` | 333ms | 708Hz | 0.30 | a choice lands on you |
| `phase` | `phase.ogg` | `confirmation_001` | 290ms | 704Hz | 0.34 | full phase change |
| `gameover` | `gameover.ogg` | `select_006` | 1.94s | 996Hz | 0.40 | the game ends |
| `thump` | `thump.ogg` | `bong_001` | 120ms | **196Hz** | 0.20+ | 15s idle (see above) |

Samples are normalised to roughly the same peak, so **`GAIN` in `ui/audio.ts` is the mix** —
that table is the one place to make a cue quieter, and the filenames are the one place to
change what it sounds like. To swap a cue, drop a different `.ogg` in over it; nothing else
needs to know.

## Playback: two paths

**WebAudio is the real one.** Each sample is fetched and decoded once on the first user
gesture, then fired as a `BufferSource` through a `GainNode`. No per-play load step, so a
cue cannot arrive late, and gain is exact.

WebAudio needs `fetch()`, which Chrome refuses on `file://` URLs — and the hotseat rig is
opened as a local file. So when the fetch or decode fails, each cue falls back to a plain
`<audio>` element, which `file://` does allow. The served client (the only way a real
two-player game happens) always takes the WebAudio path.

Autoplay policy is not fought: contexts start suspended and playback is rejected until the
page sees a gesture. `primeAudio()` is wired to the first click or keypress. Note that its
*resume* deliberately sits outside its once-only guard — `playCue` primes opportunistically
when it finds nothing decoded, which can happen before any gesture, and a context created
then is suspended; if resume lived behind the guard, that early call would consume it and
the first real click would never wake the context up.

## Turning it off

`🔊 sound` in the side rail, next to `✨ motion`. Persisted in `localStorage` as
`algoSound`; **on by default**. Switching it on plays the quietest cue as an audition, so
you learn both that it works and how loud it is without waiting for a phase to turn.
Switching it off also disarms any pending thump.
