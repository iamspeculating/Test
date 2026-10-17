#!/usr/bin/env python3
"""Synthesize the Citelight score (numpy only).

Every cue is read from audio/events.json, exported by the film itself
(`node tools/render.cjs --events audio/events.json`), so sound lands on
the exact frame. The radar section doubles as a step sequencer: each cited
prompt sits on a 16th-note slot and rings when the sweep passes it.

    python3 tools/score.py                # → audio/score.wav, .webm (Opus) and .mp3
"""

import json
import os
import subprocess
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIO = os.path.join(HERE, "..", "audio")
SR = 48000
RNG = np.random.default_rng(2026)

EV = json.load(open(os.path.join(AUDIO, "events.json")))
DUR = float(EV["duration"])
N = int(SR * DUR)
BEAT = 60.0 / EV["bpm"]

dry = np.zeros((2, N))
send = np.zeros((2, N))  # reverb send

NAMES = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def hz(name):
    return 440.0 * 2 ** ((12 * (int(name[-1]) + 1) + NAMES[name[:-1]] - 69) / 12)


def tt(n):
    return np.arange(n) / SR


# ───────────────────────────────────────────── dsp helpers

def stft_shape(x, gain_fn, nfft=2048, hop=512):
    """Time-varying spectral filter. gain_fn(frame_times, freqs) -> (F, K)."""
    win = np.hanning(nfft + 1)[:-1]
    xp = np.concatenate([np.zeros(nfft), x, np.zeros(2 * nfft)])
    nfr = 1 + (len(xp) - nfft) // hop
    idx = np.arange(nfft)[None, :] + hop * np.arange(nfr)[:, None]
    X = np.fft.rfft(xp[idx] * win, axis=1)
    times = (np.arange(nfr) * hop + nfft / 2 - nfft) / SR
    X *= gain_fn(times, np.fft.rfftfreq(nfft, 1 / SR))
    y = np.fft.irfft(X, n=nfft, axis=1) * win
    out = np.zeros(len(xp))
    for i in range(nfr):
        out[i * hop:i * hop + nfft] += y[i]
    return out[nfft:nfft + len(x)] / 1.5


def lowpass_curve(fc_of_t, order=2):
    def g(T, F):
        fc = np.maximum(fc_of_t(T), 20.0)[:, None]
        return 1.0 / np.sqrt(1.0 + (F[None, :] / fc) ** (2 * order))
    return g


def band_curve(fc_of_t, width_oct):
    def g(T, F):
        fc = np.maximum(fc_of_t(T), 20.0)[:, None]
        lf = np.log2(np.maximum(F[None, :], 1.0) / fc)
        return np.exp(-0.5 * (lf / width_oct) ** 2)
    return g


def keyed(keys, log=False):
    ks = np.array([k for k, _ in keys])
    vs = np.array([v for _, v in keys], dtype=float)
    if log:
        vs = np.log(vs)

    def f(T):
        y = np.interp(T, ks, vs)
        return np.exp(y) if log else y
    return f


def saw(freq, n, phase=0.0):
    """PolyBLEP sawtooth; freq may be a scalar or per-sample array."""
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    p = (phase + np.cumsum(f) / SR) % 1.0
    dt = f / SR
    y = 2 * p - 1
    m = p < dt
    x = p[m] / dt[m]
    y[m] -= x + x - x * x - 1
    m = p > 1 - dt
    x = (p[m] - 1) / dt[m]
    y[m] -= x * x + x + x + 1
    return y


def fade(n, a, r):
    e = np.ones(n)
    a, r = int(a * SR), int(r * SR)
    if a > 0:
        e[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    if r > 0:
        e[-r:] *= np.cos(np.linspace(0, np.pi / 2, r)) ** 2
    return e


def place(sig, t0, gain=1.0, pan=0.0, rev=0.0):
    """Add a mono or stereo signal at time t0 with equal-power pan and reverb send."""
    if sig.ndim == 1:
        a = (np.clip(pan, -1, 1) + 1) * np.pi / 4
        sig = np.vstack([sig * np.cos(a), sig * np.sin(a)]) * np.sqrt(2)
    i0 = int(round(t0 * SR))
    s0 = max(0, -i0)
    i0 = max(0, i0)
    i1 = min(N, i0 + sig.shape[1] - s0)
    if i1 <= i0:
        return
    chunk = sig[:, s0:s0 + (i1 - i0)] * gain
    dry[:, i0:i1] += chunk
    if rev:
        send[:, i0:i1] += chunk * rev


# ───────────────────────────────────────────── instruments

def bell(f, dur=1.8, bright=1.0, ratio=3.5):
    n = int(dur * SR)
    t = tt(n)
    idx = 2.4 * bright * np.exp(-t / 0.09)
    y = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * ratio * t)) * np.exp(-t / (0.38 * dur))
    y += 0.22 * np.sin(2 * np.pi * 2.001 * f * t) * np.exp(-t / 0.22)
    return y * fade(n, 0.002, 0.05)


def pluck(f, dur=1.0, tone=1.0):
    n = int(dur * SR)
    t = tt(n)
    y = np.zeros(n)
    for k in range(1, 7):
        y += k ** -1.25 * np.sin(2 * np.pi * k * f * t + RNG.random() * 6.28) * np.exp(-t * (2.2 + 2.6 * k / tone))
    return y * fade(n, 0.0025, 0.05)


def kick(dur=0.45, f0=118, f1=44, depth=1.0):
    n = int(dur * SR)
    t = tt(n)
    f = f1 + (f0 - f1) * np.exp(-t / 0.035)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (0.16 * depth))
    y += 0.12 * RNG.standard_normal(n) * np.exp(-t / 0.004)
    return y * fade(n, 0.001, 0.03)


def boom(dur=2.6, f0=74, f1=36.7):
    n = int(dur * SR)
    t = tt(n)
    f = f1 + (f0 - f1) * np.exp(-t / 0.18)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.9)
    return y * fade(n, 0.004, 0.2)


def noise_sweep(dur, f0, f1, width=0.7, shape="swell", seed=0):
    n = int(dur * SR)
    t = tt(n)
    x = np.random.default_rng(seed).standard_normal(n)
    y = stft_shape(x, band_curve(lambda T: f0 * (f1 / f0) ** np.clip(T / dur, 0, 1), width))
    if shape == "swell":       # rises, then lets go
        e = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.6
    elif shape == "rise":      # builds to the end, cut clean
        e = (t / dur) ** 2.4 * fade(n, 0, 0.03)
    else:                      # "fall": quick attack, long tail
        e = (1 - np.exp(-t / 0.03)) * np.exp(-t / (0.35 * dur))
    y *= e
    return y / (np.max(np.abs(y)) + 1e-9)


def click(seed, f=2600):
    n = int(0.03 * SR)
    t = tt(n)
    r = np.random.default_rng(seed)
    y = r.standard_normal(n) * np.exp(-t / 0.0025)
    y += 0.6 * np.sin(2 * np.pi * f * (0.85 + 0.3 * r.random()) * t) * np.exp(-t / 0.006)
    y += 0.5 * np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.012)
    return y * fade(n, 0.0005, 0.005)


def grain(f, dur=0.35):
    n = int(dur * SR)
    t = tt(n)
    return np.sin(2 * np.pi * f * t) * np.exp(-t / (dur / 5)) * fade(n, 0.004, 0.02)


# ───────────────────────────────────────────── harmony bed

CHORDS = [
    (0.0, 7.0, "D3 A3 C#4 E4 F#4", "D2"),
    (7.0, 10.0, "B2 F#3 A3 C#4 D4", "B1"),
    (10.0, 12.0, "G2 D3 F#3 A3 B3", "G1"),
    (12.0, 14.2, "A2 E3 B3 C#4 E4", "A1"),
    (14.2, 19.3, "D3 A3 C#4 E4 F#4", "D2"),
    (19.3, 22.0, "B2 F#3 A3 D4 E4", "B1"),
    (22.0, 24.0, "D3 A3 D4 F#4", "D2"),
    (24.0, 26.0, "B2 F#3 B3 D4", "B1"),
    (26.0, 28.0, "G2 D3 B3 F#4", "G1"),
    (28.0, 30.0, "A2 E3 A3 C#4 E4", "A1"),
    (30.0, 32.0, "E3 B3 D4 F#4 G4", "E2"),
    (32.0, 34.0, "G2 D3 F#3 B3 D4", "G1"),
    (34.0, 36.0, "B2 F#3 A3 D4 E4", "B1"),
    (36.0, 38.3, "A2 E3 A3 C#4 E4", "A1"),
    (38.3, 39.5, "A2 E3 G3 B3 D4", "A1"),
    (39.5, 45.0, "D3 A3 C#4 E4 F#4 A4", "D2"),
]

pad = np.zeros((2, N))
bass = np.zeros(N)
for c0, c1, voicing, root in CHORDS:
    rel = 1.3 if c1 < DUR else 0.0
    n = int((c1 - c0 + rel) * SR)
    env = fade(n, 0.45 if c0 > 0 else 1.2, rel + (0.4 if c1 >= DUR else 0))
    for note in voicing.split():
        f = hz(note)
        for ch in range(2):
            v = np.zeros(n)
            for cents in (-9, 0, 9):
                v += saw(f * 2 ** ((cents + (3 if ch else -3)) / 1200), n, RNG.random())
            i0 = int(c0 * SR)
            pad[ch, i0:i0 + n] += (v / 3 * env)[:N - i0]
    fb = hz(root)
    t = tt(n)
    b = np.sin(2 * np.pi * fb * t) + 0.18 * np.sin(4 * np.pi * fb * t)
    i0 = int(c0 * SR)
    bass[i0:i0 + n] += (b * env)[:N - i0]

PAD_FC = keyed([(0, 420), (3.5, 900), (6.6, 1500), (7.0, 650), (9.9, 1150), (12.7, 2000), (14.2, 800),
                (15.5, 2800), (19.0, 1500), (22.0, 1300), (26.0, 2100), (29.9, 3600), (30.2, 900),
                (33.9, 2600), (38.2, 1100), (39.3, 700), (39.5, 4600), (42.0, 2700), (45.0, 1400)], log=True)
for ch in range(2):
    pad[ch] = stft_shape(pad[ch], lowpass_curve(PAD_FC))

T = tt(N)
pad_gain = keyed([(0, 0.0), (0.4, 0.8), (6.5, 0.95), (7.0, 0.7), (14.2, 0.6), (15.5, 0.95), (19.3, 0.8),
                  (22.0, 0.75), (30.0, 0.9), (34.0, 0.95), (38.3, 0.85), (39.4, 0.5), (39.5, 1.15), (45.0, 1.0)])(T)

# sidechain pump while the pulse runs
pump = np.ones(N)
pulse_beats = [22 + i * BEAT for i in range(int(8 / BEAT))] + [30 + i * BEAT for i in range(int(4 / BEAT))]
for b in pulse_beats:
    i0 = int(b * SR)
    k = np.arange(N - i0) / SR
    pump[i0:] *= 1 - 0.32 * np.exp(-k / 0.11)

place(pad * pad_gain * pump * 0.085, 0, rev=0.55)
bass_gain = keyed([(0, 0.0), (1.0, 0.6), (14.2, 0.7), (22, 0.85), (34, 0.75), (39.4, 0.0), (39.5, 1.0), (45, 0.8)])(T)
place(bass * bass_gain * pump * 0.06, 0)

# ───────────────────────────────────────────── 1 · the question

for i, t0 in enumerate(EV["typing"]):
    place(click(i), t0, 0.05 * (0.7 + 0.5 * RNG.random()), pan=RNG.uniform(-0.15, 0.15), rev=0.1)
s = EV["send"]
n = int(0.16 * SR)
place(np.sin(2 * np.pi * np.cumsum(np.linspace(520, 1250, n)) / SR) * fade(n, 0.003, 0.1), s, 0.07, rev=0.4)
place(click(99, 1800), s, 0.08)
for i, t0 in enumerate(EV["words"]):
    place(grain(hz(["A6", "B6", "D7", "E7", "F#7"][i % 5]) * (1 + 0.004 * RNG.standard_normal())), t0, 0.012, pan=RNG.uniform(-0.5, 0.5), rev=0.6)
for i, t0 in enumerate(EV["chips"]):
    place(bell(hz(["A5", "B5", "D6"][i]), 1.2, 0.6), t0, 0.07, pan=-0.2 + 0.2 * i, rev=0.5)
for i, t0 in enumerate(EV["sources"]):
    place(pluck(hz(["D5", "E5", "F#5"][i]), 0.6, 0.6), t0, 0.04, rev=0.4)
place(noise_sweep(1.3, 7000, 900, 0.8, "swell", 11), EV["dissolve"] - 0.15, 0.08, rev=0.6)
for i in range(18):
    place(grain(hz(["D7", "E7", "F#7", "A7", "B7"][i % 5]), 0.5), EV["dissolve"] + i * 0.045, 0.012, pan=RNG.uniform(-0.7, 0.7), rev=0.8)

# ───────────────────────────────────────────── 2 · the shift

for i, t0 in enumerate(EV["links"]):
    place(click(200 + i, 1500 + i * 140), t0, 0.035, pan=0.35, rev=0.3)
for t0 in EV["big"]:
    place(kick(0.6, 96, 38, 1.6), t0 + 0.04, 0.26, rev=0.25)
    place(noise_sweep(0.5, 900, 300, 1.2, "fall", int(t0 * 10)), t0 + 0.04, 0.06, rev=0.5)
place(noise_sweep(0.75, 600, 5200, 0.6, "rise", 31), EV["block"] - 0.7, 0.07, pan=0.3, rev=0.4)
place(bell(hz("A5"), 2.0, 0.8), EV["block"], 0.08, pan=0.3, rev=0.7)
for sw in EV["swipes"]:
    place(noise_sweep(0.48, 1100, 4200, 0.45, "swell", int(sw * 7)), sw - 0.02, 0.11, rev=0.25)

# ───────────────────────────────────────────── 3 · the mark

ig = EV["ignite"]
place(noise_sweep(ig - EV["morph"], 300, 7000, 0.7, "rise", 41), EV["morph"], 0.11, rev=0.5)
n = int((ig - EV["morph"]) * SR)
place(np.sin(2 * np.pi * np.cumsum(np.geomspace(147, 587, n)) / SR) * np.linspace(0, 1, n) ** 2 * fade(n, 0.05, 0.02), EV["morph"], 0.04, rev=0.5)
place(boom(2.8, 80, 36.7), ig, 0.3)
for k, note in enumerate(["D5", "A5", "F#6", "D4"]):
    place(bell(hz(note), 3.2, 1.2), ig + k * 0.012, 0.11 if k < 3 else 0.08, pan=[-0.25, 0.25, 0, 0][k], rev=0.85)
d0, d1 = EV["decode"]
for i, t0 in enumerate(np.arange(d0, d1, 0.042)):
    place(click(400 + i, 3400), t0, 0.022, pan=RNG.uniform(-0.3, 0.3), rev=0.2)
place(noise_sweep(0.8, 2400, 500, 0.8, "swell", 51), EV["bracketsOut"] - 0.1, 0.08, rev=0.6)

# ───────────────────────────────────────────── 4 · the radar

r0 = EV["rings"]
for k, (dt, g) in enumerate([(0, 1), (0.375, 0.45), (0.75, 0.22), (1.125, 0.1)]):
    place(grain(hz("D6"), 1.6), r0 + dt, 0.07 * g, pan=[0, -0.4, 0.4, 0][k], rev=0.9)
place(noise_sweep(1.6, 200, 1200, 1.0, "swell", 61), EV["tilt"], 0.06, rev=0.5)

RING_NOTE = {5: "D4", 4: "F#4", 3: "A4", 2: "B4", 1: "D5", 0: "E5"}
for h in EV["hits"]:
    f = hz(RING_NOTE[h["ring"]])
    place(bell(f, 1.6, 0.9), h["t"], 0.13, pan=0.7 * h["pan"], rev=0.45)
    place(bell(f * 2, 0.6, 0.4), h["t"], 0.025, pan=-0.5 * h["pan"], rev=0.6)

for b in pulse_beats:
    place(kick(0.45, 110, 44, 1.0), b, 0.17 if b < 26 else 0.21)
for i in range(16):
    t0 = 24 + i * BEAT + BEAT / 2
    hn = int(0.06 * SR)
    hat = stft_shape(RNG.standard_normal(hn), lambda T, F: (F[None, :] > 7000) * 1.0) * np.exp(-tt(hn) / 0.012)
    place(hat, t0, 0.05 if t0 < 30 else 0.035, pan=0.25 * (-1) ** i, rev=0.1)
place(noise_sweep(2.0, 400, 6000, 0.7, "rise", 71), 28.0, 0.07, rev=0.4)
place(noise_sweep(0.9, 3000, 300, 0.9, "swell", 72), EV["flatten"], 0.08, rev=0.5)

# ───────────────────────────────────────────── 5 · the proof

l0, l1 = EV["line"]
you = [4, 4.6, 5.3, 7.1, 9.4, 12.2, 15.1, 18.4, 21.7, 25.0, 28.3, 31.0]
scale = ["D4", "E4", "F#4", "A4", "B4", "D5", "E5", "F#5", "A5", "B5", "D6", "E6", "F#6"]
for i, t0 in enumerate(np.arange(l0, l1 + 1e-6, BEAT / 4)):
    u = (t0 - l0) / (l1 - l0)
    k = 0.5 - 0.5 * np.cos(np.pi * np.clip(u, 0, 1))  # same ease as the chart head
    v = np.interp(k * 11, np.arange(12), you)
    note = scale[int(round((v - 4) / 27 * (len(scale) - 1)))]
    place(pluck(hz(note), 0.9, 1.2), t0, 0.07, pan=-0.5 + u, rev=0.5)
place(bell(hz("A5"), 2.2, 1.0), EV["cross"], 0.09, rev=0.7)
place(bell(hz("D6"), 2.2, 1.0), EV["cross"] + 0.02, 0.06, rev=0.7)
for i, t0 in enumerate(EV["kpis"]):
    place(pluck(hz(["D5", "F#5", "A5"][i]), 1.2, 1.4), t0, 0.08, pan=0.35, rev=0.5)
    place(click(600 + i, 2200), t0, 0.04, pan=0.35)
place(kick(0.7, 90, 36, 1.8), EV["grow"] + 0.05, 0.24, rev=0.3)
# a quiet ostinato carries the KPIs into the finale
for i, t0 in enumerate(np.arange(EV["grow"], EV["fly"] - 0.1, BEAT / 2)):
    chord = ["B4", "F#5", "D5", "F#5"] if t0 < 36 else ["A4", "E5", "C#5", "E5"]
    place(pluck(hz(chord[i % 4]), 0.8, 1.0), t0, 0.045 * (1 - 0.5 * (t0 - EV["grow"]) / (EV["fly"] - EV["grow"])), pan=0.3 * (-1) ** i, rev=0.55)

# ───────────────────────────────────────────── 6 · the brand

sl = EV["slam"]
place(noise_sweep(sl - EV["fly"], 250, 9000, 0.6, "rise", 81), EV["fly"], 0.16, rev=0.4)
n = int((sl - EV["fly"]) * SR)
riser = saw(np.geomspace(110, 880, n), n) * np.linspace(0, 1, n) ** 3 * fade(n, 0.1, 0.01)
riser = stft_shape(riser, lowpass_curve(lambda T: 600 + 3000 * np.clip(T / (sl - EV["fly"]), 0, 1)))
place(riser, EV["fly"], 0.05, rev=0.4)
place(boom(3.4, 92, 36.7), sl, 0.42)
place(kick(0.5, 150, 50, 1.2), sl, 0.26)
place(noise_sweep(1.8, 5000, 700, 1.4, "fall", 91), sl, 0.12, rev=0.8)
for k, note in enumerate(["D4", "A4", "D5", "F#5", "A5", "D6"]):
    place(bell(hz(note), 4.5, 1.1), sl + k * 0.008, 0.075, pan=-0.5 + k * 0.2, rev=0.9)
for i, note in enumerate(["D5", "E5", "F#5", "A5", "B5", "D6", "E6", "F#6", "A6"]):
    place(pluck(hz(note), 1.4, 1.4), EV["word"] + i * 0.034, 0.06, pan=-0.6 + i * 0.15, rev=0.6)
place(bell(hz("A5"), 2.6, 0.7), EV["cta"], 0.06, rev=0.8)
place(bell(hz("D6"), 3.0, 0.6), EV["tag"], 0.05, rev=0.8)

# ───────────────────────────────────────────── mix

def make_ir(rt=3.6, secs=4.2):
    n = int(secs * SR)
    t = tt(n)
    ir = RNG.standard_normal((2, n)) * np.exp(-6.9 * t / rt)
    for ch in range(2):
        ir[ch] = stft_shape(ir[ch], lowpass_curve(lambda T: 1600 + 8000 * np.exp(-np.maximum(T, 0) / 0.5)))
    ir *= fade(n, 0.004, 0.3)
    ir = np.concatenate([np.zeros((2, int(0.024 * SR))), ir], axis=1)
    return ir / np.sqrt(np.sum(ir ** 2) / 2)


ir = make_ir()
nf = 1 << (N + ir.shape[1]).bit_length()
wet = np.fft.irfft(np.fft.rfft(send, nf) * np.fft.rfft(ir, nf), nf)[:, :N]
mix = dry + 0.3 * wet

for ch in range(2):  # clear rumble and DC
    mix[ch] = stft_shape(mix[ch], lambda T, F: 1.0 / np.sqrt(1.0 + (28.0 / np.maximum(F[None, :], 1.0)) ** 4))

mix *= keyed([(0, 0), (0.05, 1), (EV["fadeOut"], 1), (DUR, 0)])(T)

rms = np.sqrt(np.mean(mix ** 2))
mix *= 10 ** (-17 / 20) / rms                       # loudness target
knee = 0.7
over = np.abs(mix) > knee
mix[over] = np.sign(mix[over]) * (knee + (1 - knee) * np.tanh((np.abs(mix[over]) - knee) / (1 - knee)))
mix *= 0.89 / max(1e-9, np.max(np.abs(mix)))         # -1 dBFS ceiling

out_wav = os.path.join(AUDIO, "score.wav")
with wave.open(out_wav, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.clip(mix.T, -1, 1) * 32767).astype("<i2").tobytes())

peak_db = 20 * np.log10(np.max(np.abs(mix)))
rms_db = 20 * np.log10(np.sqrt(np.mean(mix ** 2)))
print(f"score.wav  {DUR:.1f}s  peak {peak_db:.1f} dBFS  rms {rms_db:.1f} dBFS")

if "--no-encode" not in sys.argv:
    out_mp3 = os.path.join(AUDIO, "score.mp3")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", out_wav, "-c:a", "libmp3lame", "-b:a", "192k", out_mp3], check=True)
    print("score.mp3 ", os.path.getsize(out_mp3) // 1024, "KB")
    out_webm = os.path.join(AUDIO, "score.webm")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", out_wav, "-c:a", "libopus", "-b:a", "128k", out_webm], check=True)
    print("score.webm", os.path.getsize(out_webm) // 1024, "KB")
