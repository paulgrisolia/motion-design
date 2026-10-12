"""Deterministic soundtrack + SFX, synthesised from src/timeline.json (same cues as the visuals).
usage: python3 scripts/audio.py out/audio.wav
120 BPM. Every hit is placed on a cue time, so sync is exact by construction.
"""
import json
import sys
import wave

import numpy as np

SR = 48000
ROOT = __file__.rsplit('/scripts/', 1)[0]
TL = json.load(open(f'{ROOT}/src/timeline.json'))
Q = TL['cues']
DUR = TL['duration']
N = int(SR * (DUR + 0.0))

dry = np.zeros((2, N))
wet_send = np.zeros((2, N))


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(d):
    return np.arange(int(d * SR)) / SR


def place(sig, t0, gain=1.0, pan=0.0, send=0.0):
    i0 = int(round(t0 * SR))
    if i0 >= N:
        return
    if i0 < 0:
        sig = sig[-i0:]
        i0 = 0
    sig = sig[: N - i0]
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    dry[0, i0:i0 + len(sig)] += sig * gain * l * 1.414
    dry[1, i0:i0 + len(sig)] += sig * gain * r * 1.414
    if send:
        wet_send[0, i0:i0 + len(sig)] += sig * gain * send
        wet_send[1, i0:i0 + len(sig)] += sig * gain * send


def fft_band(x, lo=None, hi=None):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    g = np.ones_like(f)
    if lo:
        g *= 1 / (1 + (lo / np.maximum(f, 1)) ** 4)
    if hi:
        g *= 1 / (1 + (f / hi) ** 4)
    return np.fft.irfft(X * g, len(x))


def noise(d, seed):
    return np.random.default_rng(seed).standard_normal(int(d * SR))


def env(d, a=0.003, k=8.0):
    t = tt(d)
    return np.minimum(1, t / a) * np.exp(-t * k)


# ---------------------------------------------------------------- instruments
def kick(d=0.45, f0=130, f1=42, punch=1.0):
    t = tt(d)
    f = f1 + (f0 - f1) * np.exp(-t * 30)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 7) * punch + 0.3 * fft_band(noise(d, 1), 1000, 5000) * np.exp(-t * 90)


def clap(seed=2):
    d = 0.3
    t = tt(d)
    n = fft_band(noise(d, seed), 900, 4000)
    e = np.zeros_like(t)
    for o in (0, 0.011, 0.022):
        e += (t >= o) * np.exp(-(t - o).clip(0) * (60 if o < 0.02 else 18))
    return n * e * 0.6


def tick(hi=True, seed=3):
    d = 0.04
    n = fft_band(noise(d, seed), 5000 if hi else 3000, 12000 if hi else 7000)
    return n * env(d, 0.0005, 140) * 0.7


def ep(m, d=1.6, vel=1.0):
    t = tt(d)
    f = hz(m)
    s = np.zeros_like(t)
    for h, a, k in ((1, 1, 2.2), (2, 0.35, 4), (3, 0.12, 7), (4, 0.06, 9)):
        s += a * np.sin(2 * np.pi * f * h * t * (1 + 0.0007 * (h - 1))) * np.exp(-t * k)
    s += 0.08 * np.sin(2 * np.pi * f * 7.03 * t) * np.exp(-t * 40)  # tine bark
    trem = 1 + 0.08 * np.sin(2 * np.pi * 4.8 * t)
    return s * trem * np.minimum(1, t / 0.004) * vel


def chord(notes, t0, d=1.6, vel=0.13, pan_spread=0.4):
    for i, m in enumerate(notes):
        pan = (i / max(1, len(notes) - 1) - 0.5) * pan_spread
        place(ep(m, d, vel), t0 + i * 0.006, pan=pan, send=0.35)


def pad(notes, t0, d, vel=0.05, att=0.4, rel=0.6):
    t = tt(d + rel)
    e = np.minimum(1, t / att) * np.where(t > d, np.exp(-(t - d) * 6), 1)
    for i, m in enumerate(notes):
        f = hz(m)
        s = sum(np.sin(2 * np.pi * f * h * t * (1 + 0.002 * ((i + h) % 3 - 1))) / h ** 1.6 for h in range(1, 6))
        place(fft_band(s * e, None, 2200) * vel, t0, pan=(i % 2 - 0.5) * 0.6, send=0.5)


def bass(m, t0, d, vel=0.22):
    t = tt(d)
    f = hz(m)
    s = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)
    place(s * np.minimum(1, t / 0.01) * np.exp(-t * 1.6) * vel, t0)


# ---------------------------------------------------------------- sfx
def whoosh(d, rise=True, lo=300, hi=6000, seed=7):
    t = tt(d)
    n = noise(d, seed)
    # sweep by blending two bands
    a = fft_band(n, lo, lo * 4)
    b = fft_band(n, hi / 4, hi)
    x = t / d
    mix = x if rise else 1 - x
    e = (np.sin(np.pi * x) ** 2) if not rise else x ** 2.2 * (1 - np.exp(-(1 - x) * 40))
    return (a * (1 - mix) + b * mix) * e


def clink(f0, seed=0):
    d = 0.6
    t = tt(d)
    s = sum(a * np.sin(2 * np.pi * f0 * r * t) * np.exp(-t * k)
            for r, a, k in ((1, 1, 9), (2.76, 0.5, 14), (5.4, 0.3, 22), (8.9, 0.15, 30)))
    s = s * np.minimum(1, t / 0.0008) * 0.3
    k = tick(True, seed) * 0.3
    s[:len(k)] += k
    return s


def sip(seed):
    d = 0.22
    t = tt(d)
    n = fft_band(noise(d, seed), 400, 1600)
    am = 0.6 + 0.4 * np.sin(2 * np.pi * 28 * t)
    return n * am * np.sin(np.pi * t / d) ** 2 * 0.35


def blip(f0, f1, d=0.12, vel=0.4):
    t = tt(d)
    f = f0 * (f1 / f0) ** (t / d)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(d, 0.002, 18) * vel


def mew():
    d = 0.7
    t = tt(d)
    x = t / d
    f = 820 * np.exp(-x * 0.55) * (1 + 0.12 * np.sin(np.pi * np.minimum(1, x * 3))) * (1 + 0.012 * np.sin(2 * np.pi * 6 * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) + 0.5 * np.sin(2 * ph) + 0.25 * np.sin(3 * ph) + 0.12 * np.sin(4 * ph)
    e = np.minimum(1, t / 0.06) * np.exp(-np.maximum(0, x - 0.55) * 9) * (0.8 + 0.2 * np.sin(np.pi * x))
    return fft_band(s * e, 300, 3500) * 0.22


def bell(m):
    d = 3.0
    t = tt(d)
    f = hz(m)
    s = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * k)
            for r, a, k in ((1, 1, 1.4), (2.0, 0.5, 2.2), (2.76, 0.35, 3), (5.4, 0.15, 6)))
    return s * np.minimum(1, t / 0.001) * 0.18


def slash():
    d = 0.22
    t = tt(d)
    n = noise(d, 11)
    s = fft_band(n, 2500, 11000) * np.minimum(1, t / 0.12) ** 2 * np.exp(-np.maximum(0, t - 0.15) * 60)
    return s * 0.5


def ratchet(t0, d=0.38, n=11):
    for i in range(n):
        x = i / (n - 1)
        place(tick(True, 20 + i), t0 + d * (1 - (1 - x) ** 1.6), gain=0.55, pan=0.2)


# ---------------------------------------------------------------- arrangement
BEAT = 60 / TL['bpm']

# harmony (time, notes, length, bass root) — placed on the shot cues
FINAL = Q['lockup']
SAD = Q['lateBirds'] - 0.5          # music drops to pad-only for the sad cat
prog = [
    (0.0, [53, 57, 60, 64, 67], Q['shot2'], 41),                               # Fmaj9
    (Q['shot2'], [52, 55, 59, 62, 66], Q['shot3'] - Q['shot2'], 40),          # Em9
    (Q['shot3'], [57, 60, 64, 67, 71], 3.0, 45),                               # Am9
    (Q['shot3'] + 3.0, [50, 53, 57, 60, 64], SAD - Q['shot3'] - 3.0, 38),     # Dm9
    (SAD, [53, 56, 60, 62], Q['shot5'] - SAD, 41),                             # Fm6 (the sad borrowed iv)
    (Q['shot5'], [55, 60, 62, 65], 2.0, 43),                                   # G7sus
    (Q['shot5'] + 2.0, [55, 59, 62, 65], FINAL - Q['shot5'] - 2.0, 43),       # G7
    (FINAL, [48, 55, 59, 62, 64], DUR - FINAL, 36),                            # Cmaj9
]
for t0, notes, d, root in prog:
    if t0 >= FINAL:
        chord(notes, t0, 3.0, 0.15)
        pad(notes, t0, d - 1.2, 0.045, 0.02, 1.0)
        bass(root, t0, 2.5, 0.38)
        # relaxed outro: soft stabs once per bar
        for bar in np.arange(t0 + 2.0, DUR - 1.0, 2.0):
            chord([m + 12 for m in notes[1:]], bar, 1.6, 0.045)
            bass(root, bar, 1.8, 0.16)
        continue
    pad(notes, t0, d, 0.055 if t0 == SAD else 0.035, 0.25 if t0 else 0.02)
    if t0 == SAD:
        bass(root, t0, d, 0.22)
        for bar in np.arange(t0, t0 + d - 0.01, 2.5):
            chord([m + 12 for m in notes[1:]], bar + 0.02, 2.4, 0.06)
        continue
    for bar in np.arange(t0, t0 + d - 0.01, 2.0):
        bass(root, bar, 2.0)
        hits = [0, 0.75, 1.5] if t0 < Q['shot5'] else [0, 0.5]
        for h in hits:
            if bar + h < t0 + d:
                chord(notes, bar + h, 0.9, 0.11 if h == 0 else 0.07)

# drums: shot 1 only hits on the hook and the slash; groove from shot 2 until the sad cat
for b in np.arange(0, SAD, BEAT):
    beat_in_bar = int(round(b / BEAT)) % 4
    if b < Q['shot2']:
        if b in (Q['hookIn'], Q['slash']):
            place(kick(), b, 0.9)
        continue
    if beat_in_bar in (0, 2):
        place(kick(), b, 0.9)
    if b >= Q['shot3'] and beat_in_bar in (1, 3):
        place(clap(int(b * 10)), b, 0.5, pan=0.1, send=0.25)
# clock ticks: 8ths (tick / tock) through the clock and cups shots, quieter again in the outro
for i, b in enumerate(np.arange(Q['shot2'], SAD, BEAT / 2)):
    place(tick(i % 2 == 0, 30 + i), b, 0.7 if i % 2 == 0 else 0.4, pan=-0.25 if i % 2 else 0.25)
for i, b in enumerate(np.arange(Q['footer'], DUR - 0.75, BEAT)):
    place(tick(i % 2 == 0, 130 + i), b, 0.3 if i % 2 == 0 else 0.18, pan=-0.25 if i % 2 else 0.25)
for b in Q['punch']:
    place(kick(0.5, 150, 40, 1.2), b, 1.0)
    place(clap(int(b * 7)), b, 0.65, send=0.3)
    place(blip(110, 55, 0.25, 0.4), b)
place(kick(0.7, 120, 36, 1.2), Q['lockup'], 0.9)

# ---------------------------------------------------------------- sfx on cues
place(kick(0.8, 90, 30, 1.4), Q['hookIn'], 0.8)
for i in range(4):
    place(tick(False, 40 + i), max(0, -0.12 + i * 0.055 + 0.1), 0.6, pan=-0.3 + 0.2 * i)
place(slash(), Q['slash'] - 0.13, 0.9, pan=0.3, send=0.2)
place(clap(9), Q['slash'], 0.7, send=0.3)
for i in range(3):
    place(blip(500 - i * 80, 120, 0.2, 0.18), Q['drop'] + i * 0.05 + 0.08, pan=-0.4 + 0.4 * i)
place(whoosh(0.45, True, 120, 2500, 12), Q['iris'], 0.55, send=0.2)
place(blip(1200, 900, 0.06, 0.25), Q['clockIn'], send=0.3)
ratchet(Q['wedge'])
place(blip(1500, 1500, 0.08, 0.15), Q['wedge'] + 0.22, pan=0.3)
place(whoosh(0.5, True, 200, 7000, 13), Q['dive'], 0.7, send=0.3)
for i in range(5):
    place(clink(1900 * 2 ** (i * 2 / 12), 50 + i), Q['cupsIn'] + i * Q['cupStep'] + 0.1, 0.55, pan=-0.6 + 0.3 * i, send=0.25)
    place(sip(60 + i), Q['drainStart'] + i * Q['drainStep'] + 0.05, 0.8, pan=-0.6 + 0.3 * i)
place(whoosh(0.25, False, 800, 4000, 14), Q['headlineSwap'] - 0.05, 0.25)
place(blip(500, 1100, 0.09, 0.3), Q['earsPop'], pan=0.6)
place(blip(700, 1300, 0.07, 0.2), Q['catPeek'], pan=0.6)
place(whoosh(0.45, True, 100, 1500, 15), Q['pushIn'] - 0.05, 0.4)
place(mew(), Q['sadEyes'], 1.0, pan=0.25, send=0.45)
place(blip(1400, 2600, 0.12, 0.18), Q['tearDrop'] + 0.18, pan=-0.1, send=0.6)
place(whoosh(0.3, True, 300, 8000, 16), Q['roll'] - 0.2, 0.5, send=0.2)
place(tick(False, 70), Q['roll'] + 0.04, 0.8)
place(tick(False, 71), Q['roll'] + 0.1, 0.8)
place(bell(84), Q['lockup'], 1.0, send=0.5)
place(bell(91), Q['lockup'] + 0.12, 0.5, send=0.5)
place(blip(900, 1500, 0.08, 0.2), Q['happyCat'], pan=0.5, send=0.3)
place(blip(1100, 1800, 0.07, 0.15), Q['happyCat'] + 0.1, pan=0.5, send=0.3)
for b in Q['blink']:
    place(blip(1600, 2000, 0.04, 0.06), b, pan=0.5, send=0.4)

# ---------------------------------------------------------------- reverb + master
ir_d = 1.4
it = tt(ir_d)
ir = np.random.default_rng(99).standard_normal(len(it)) * np.exp(-it / 0.32)
ir = fft_band(ir, 200, 6000)
ir /= np.sqrt(np.sum(ir ** 2))
L = N + len(ir)
nfft = 1 << (L - 1).bit_length()
wet = np.stack([np.fft.irfft(np.fft.rfft(wet_send[c], nfft) * np.fft.rfft(ir, nfft), nfft)[:N] for c in range(2)])
# decorrelate the reverb a little
wet[1] = np.roll(wet[1], int(0.011 * SR))
mix = dry + wet * 0.55
mix = np.stack([fft_band(mix[c], 38, 16000) for c in range(2)])  # clean sub rumble

t = np.arange(N) / SR
mix *= np.minimum(1, (DUR - t) / 0.35).clip(0, 1) ** 1.5
mix = np.tanh(mix * 1.15) / np.tanh(1.15)
peak = np.max(np.abs(mix))
mix *= 0.80 / peak
out = sys.argv[1] if len(sys.argv) > 1 else f'{ROOT}/out/audio.wav'
pcm = (mix.T * 32767).astype('<i2')
with wave.open(out, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('audio ->', out, f'{DUR}s', 'peak normalised to -2 dBFS')
