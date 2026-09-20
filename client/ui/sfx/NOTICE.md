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

`gain -n -1` is load-bearing. `ui/audio.ts`'s GAIN table assumes every sample
peaks in the same place, and is the only thing that decides how loud a cue is
in the mix; a sample that arrives quiet gets "fixed" by turning its entry up,
and then the next retune is twice as loud as anyone expected.
