# Where these sounds came from

`decision.ogg`, `error.ogg`, `gameover.ogg`, `phase.ogg`, `priority.ogg`,
`subphase.ogg` and `thump.ogg` are Kenney's **Interface Sounds (1.0)**, CC0 —
see `LICENSE-kenney.txt`. Crediting Kenney is not mandatory; we do it anyway.

`lifeup.ogg` and `lifedown.ogg` are **ours**, and fall under the repo's MIT
licence with everything else in `client/`. They are synthesised, not recorded,
and the exact command that made them is kept here so they can be retuned
rather than guessed at:

```sh
# a small bell bent upward — you gained life
sox -n -r 44100 -c 1 up.wav   synth 0.26 sine 660-990  sine 1320-1980 remix - \
  fade t 0.003 0.26 0.23 gain -n -1
# a low tone that falls — you lost life
sox -n -r 44100 -c 1 down.wav synth 0.36 sine 330-110  sine 165-58    remix - \
  fade t 0.004 0.36 0.32 gain -n -1

ffmpeg -i up.wav   -c:a libvorbis -q:a 4 -ar 44100 -ac 1 lifeup.ogg
ffmpeg -i down.wav -c:a libvorbis -q:a 4 -ar 44100 -ac 1 lifedown.ogg
```

Each is one voice plus its octave, so the pair reads as the same instrument
moving in two directions — which is the whole job: you should never have to
work out *which* of the two you just heard.

`pick.ogg`, `packnew.ogg` and `tensec.ogg` — the cube draft's pick screen —
are **ours** too (2026-11-14), made the same way:

```sh
# a soft wooden tick, falling — you took a card
sox -n -r 44100 -c 1 pick.wav synth 0.07 sine 1200-700 sine 2400-1400 remix - \
  fade l 0.001 0.07 0.065 gain -n -1
# two bell notes, high then low — a pack is in front of you
sox -n -r 44100 -c 1 ding.wav synth 0.30 sine 1319 sine 2638 remix - fade l 0.002 0.30 0.28
sox -n -r 44100 -c 1 dong.wav synth 0.40 sine 988  sine 1976 remix - fade l 0.002 0.40 0.38 pad 0.11
sox -m ding.wav dong.wav packnew.wav gain -n -1
# one soft tone that pulses — ten seconds left on the pick
sox -n -r 44100 -c 1 tensec.wav synth 0.42 sine 523 sine 1046 remix - \
  tremolo 9 45 fade h 0.02 0.42 0.24 gain -n -1

for c in pick packnew tensec; do ffmpeg -i $c.wav -c:a libvorbis -q:a 4 -ar 44100 -ac 1 $c.ogg; done
```

None of the three moves upward, so none can be mistaken for `decision`'s
rising two-tone or the life bell; `tensec` is the only low one and the only
one that pulses.

`gain -n -1` is load-bearing. `ui/audio.ts`'s GAIN table assumes every sample
peaks in the same place, and is the only thing that decides how loud a cue is
in the mix; a sample that arrives quiet gets "fixed" by turning its entry up,
and then the next retune is twice as loud as anyone expected.
