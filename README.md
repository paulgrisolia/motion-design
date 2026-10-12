# Coffee at 8:30

A 15-second, 16:9, 60 fps motion piece arguing that team coffee should move from 8:15 to 8:30,
so the late birds who sleep in don't turn into sad little cats.

![poster](out/poster.png)

| Deliverable | Path |
|---|---|
| Final video (1920×1080, 60 fps, H.264 + AAC) | `out/final.mp4` |
| Poster frame (14.5s) | `out/poster.png` |
| Contact sheet (every 0.5s) | `out/contact.png` |
| Style guide | `docs/style_guide.md` |
| Shot list / storyboard | `docs/shotlist.md` |

## Story in six shots

| Time | Shot | Idea |
|---|---|---|
| 0.0–2.0 | **Hook** | A giant `8:15` punches in. A red pen strikes it out and the digits fall away |
| 2.0–4.5 | **Clock** | The colon becomes the clock pivot: *too early.* A red wedge marks the missing 15 minutes |
| 4.5–7.5 | **Cups** | The team sips at 8:15. The live clock runs to 08:30 and every cup is empty. Ears appear at the reserved seat |
| 7.5–10.0 | **Sad cat** | The camera pushes in: late birds *become sad little cats.* The ears droop and a tear falls |
| 10.0–12.5 | **Punch** | Full red: `JUST WAIT 15 MIN.`, one word per beat |
| 12.5–15.0 | **Lockup** | `15` rolls to `30` → *Coffee at* **8:30**. A happy cat peeks out from behind the 0 |

## How it's built

- **`src/main.js`**: a Canvas 2D renderer where every frame is a pure function of time.
  `window.seek(t)` always draws the same pixels. There are no timers, no `Math.random`, no CSS animation, and
  no state carried between frames. I verified this: frames rendered in different orders and by different
  workers have identical MD5 hashes.
- **Springs**: an analytic damped-oscillator solution with four motion weights (UI, cards, hero type,
  camera), plus a punch spring and a heavy spring. See `docs/style_guide.md`.
- **Motion blur**: each output frame averages 6 sub-frames over a 180° shutter. Sub-samples are clamped to
  their own shot, so hard cuts stay hard.
- **`src/timeline.json`**: the single source of truth for cue times, shared by the visuals and the audio.
- **`scripts/audio.py`**: a numpy synth that builds a 120 BPM score (Fmaj9 → Em9 → Am9 → Dm9 → Fm6 → G7 → Cmaj9)
  plus SFX on the cues: slash, ratchet, ceramic clinks, sips, mew, tear drop, bell. Because every sound is
  placed from the same cue file, sync is exact by construction. Onset autocorrelation on the rendered mix
  recovers 120.0 BPM, with onsets on the beats. Loudness is about −14 LUFS.
- **`scripts/render.mjs`**: serves the repo locally, drives headless Chromium with Playwright across 4
  parallel pages, and writes PNG frames.
- **`scripts/build.sh`**: frames → audio → `ffmpeg` (x264 CRF 12, yuv420p, BT.709) → contact sheet + poster.

## Run it

```bash
npm install            # playwright (or use a global install; the script falls back to it)
npm run build          # ≈2 min on 4 cores -> out/final.mp4, out/poster.png, out/contact.png
npm run preview        # open http://localhost:8080/src/index.html and scrub with the slider
                       # add ?t=8.5 to jump to a timestamp
```

Requirements: Node 18+, Python 3 with numpy and Pillow, and ffmpeg.

## Quality loop log

Each round: full render → contact sheet plus full-resolution crops and transition filmstrips → score → fix the top 3.

| Round | Hook | Comp. | Read. | Motion | Trans. | Variety | Consist. | Sound | Top problems fixed |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 8 | 7 | 7 | 7 | 7 | 8 | 8 | 8 | The dive smeared through the clock hands; the drooped ears read as bat wings and the sad cat looked grumpy; WAIT collided with JUST and the 15→30 hand-off was a pile-up |
| 2 | 8 | 7.5 | 7.5 | 8 | 7.5 | 8 | 8 | 8 | Dead middle band in the cups shot (bigger cups, added a big live clock); the iris blot swallowed the digits too early; the end hold froze |
| 3 | 8.5 | 8 | 8 | 8 | 7.5 | 8.5 | 8.5 | 8 | The saucer tilted with the cup; foam whiskers turned into stray grey lines on paper; the tear covered the eye; lockup optical balance with the cat; boomy sub-bass and quiet ticks in the mix |
| 4 | 8.5 | 8 | 8.5 | 8 | 8.5 | 8.5 | 8.5 | 8 | The first frame of the red shot was empty; the "8" overshot into "30" (now critically damped); a blank beat after the dive |

## Notes

- `./refs/` was empty, so `docs/style_guide.md` is an original art direction rather than an analysis of references.
- Fonts are all SIL OFL: Inter Display (Rasmus Andersson), Instrument Serif, and JetBrains Mono. They're bundled in `assets/fonts/`.
- Only 16:9 was requested. For other formats, recompose them in `computeLayouts()` and in the per-shot coordinates rather than cropping.
