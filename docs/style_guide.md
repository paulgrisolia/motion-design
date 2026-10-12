# Style Guide — "Coffee at 8:30"

> `./refs/` was empty when this project started, so there were no reference frames to study.
> This guide is an original art direction written in the same format a reference analysis
> would produce. If references are added later, re-derive the sections below from them
> and keep only their visual grammar, not their content.

## Concept

An **editorial memo that moves**. The whole film behaves like a printed office notice
(cream paper, black type, one red pen mark) that keeps rearranging itself. The message
is a deadpan joke, so the design stays serious: big type, clean geometry, no fake
3D. The cat is the only drawn character, and it uses the same flat geometry as the type.

## Palette (strict: 4 colours + 1 tint)

| Token      | Hex       | Use                                                    |
|------------|-----------|--------------------------------------------------------|
| `paper`    | `#F1EADF` | Main background. Warm, uncoated-paper cream            |
| `espresso` | `#1B1410` | Type, line work, the cat, the inverted "night" scenes  |
| `signal`   | `#FF4B1F` | The red pen: slash, the 15-minute wedge, the CTA       |
| `crema`    | `#C89B6D` | Coffee liquid, secondary details                       |
| `foam`     | `#FBF7F0` | Highlights on dark: clock face, eye whites             |

Rule: `signal` never covers more than ~15% of a frame, except in the one full-red punch
shot (10.0–12.0s). That's the only time it fills the screen, so it hits harder.

## Typography

| Role             | Face                        | Notes                                          |
|------------------|-----------------------------|------------------------------------------------|
| Display numerals | Inter Display Black         | Tight tracking (−4%). 8:15 / 8:30 at 500–700px |
| Editorial voice  | Instrument Serif (+ Italic) | Feelings and asides: *too early*, *little cats* |
| Labels / data    | JetBrains Mono Medium       | Uppercase, +12% tracking, 20–24px, metadata only |

Hierarchy is always **one hero + at most one support + metadata**. Never two heroes.
Mono labels sit on a 64px margin grid (top-left / top-right / bottom corners) like
the running header of a print layout.

## Layout grid

- 1920×1080, 64px outer margin, 12-column grid (column 112px, gutter 32px).
- Hero type is set left or deliberately off-centre. Centred type is used only once:
  the final lockup.
- Every scene keeps a "running header" (mono, top) so the film reads as one document.

## Motion language

Every animated value comes from an analytic damped spring or a hand-shaped curve, evaluated
from absolute time. Motion has four weights:

| Weight      | Spring (stiffness / damping) | Feel                                 |
|-------------|------------------------------|--------------------------------------|
| UI / labels | 420 / 34                     | Snappy, hardly any overshoot         |
| Cards/props | 260 / 18                     | Bouncy, a visible overshoot          |
| Hero type   | 180 / 16                     | Heavy, lands with a small rebound    |
| Camera      | 70 / 18 (critically damped)  | Slow, never overshoots               |

- Transitions come out of objects already on screen: the colon turns into the clock pivot,
  the clock face flattens into a cup rim, the empty seat turns into the cat, the
  minute hand sweeps into the CTA.
- No cross-dissolves. Changes happen through masks (circular iris, hard wipe), morphs,
  scale and camera moves.
- Cuts land on beats. Camera moves start just before the beat so they arrive on it.

## Texture

- A very light static paper grain (deterministic hash noise) at 3–4% opacity, so the
  flat colour doesn't band or look digital.
- No glow, no blur-as-style, no particles. The only "atmosphere" is coffee steam,
  drawn as deterministic sine ribbons.
- Real motion blur: each frame averages 6 sub-frames over a 180° shutter. Sub-samples are clamped
  to their own shot, so hard cuts stay hard.

## Sound

- 120 BPM (one beat = 0.5s = 30 frames). A dry, minimal kit: soft kick, a clock-tick hi-hat,
  a warm electric-piano chord loop (Fmaj9 → Em7 → Dm9 → Cmaj9 → resolution).
- SFX are tied to on-screen events: a paper slash, digit flips, a ceramic clink,
  a short falling "mew" glide, the minute-hand ratchet, and a bright final bell.
