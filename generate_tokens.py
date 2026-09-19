#!/usr/bin/env python3
"""Female-ish fee / see tokens with a clear s vs f contrast."""

from pathlib import Path
import numpy as np
import wave

sr = 44100
out = Path("/agent/hearing-demo/audio")
out.mkdir(exist_ok=True)
rng = np.random.default_rng(7)


def write_wav(path, x):
    x = np.clip(x, -1, 1)
    y = (x * 32767).astype(np.int16)
    with wave.open(str(path), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(y.tobytes())


def env(n, a=0.01, r=0.04):
    y = np.ones(n)
    na, nr = int(a * sr), int(r * sr)
    if na:
        y[:na] = np.linspace(0, 1, na)
    if nr:
        y[-nr:] *= np.linspace(1, 0, nr)
    return y


def band_noise(n, lo, hi, tilt=0.0):
    x = rng.normal(0, 1, n)
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(n, 1 / sr)
    mask = (freqs >= lo) & (freqs <= hi)
    ramp = np.zeros_like(freqs)
    ramp[mask] = 1.0
    if tilt:
        safe = np.maximum(freqs, 200)
        ramp *= np.power(safe / 200.0, tilt, where=ramp > 0)
        ramp = np.nan_to_num(ramp, nan=0.0, posinf=0.0, neginf=0.0)
        ramp = np.clip(ramp, 0, None)
    spec *= ramp
    y = np.fft.irfft(spec, n)
    return y / (np.max(np.abs(y)) + 1e-9)


def resonator(x, freq, bw):
    r = np.exp(-np.pi * bw / sr)
    theta = 2 * np.pi * freq / sr
    a1 = 2 * r * np.cos(theta)
    a2 = -(r * r)
    gain = 1 - r
    y = np.zeros_like(x)
    for i in range(2, len(x)):
        y[i] = gain * x[i] + a1 * y[i - 1] + a2 * y[i - 2]
    return y


def glottal(n, f0):
    t = np.arange(n) / sr
    phase = np.cumsum(2 * np.pi * f0 * (1 + 0.012 * np.sin(2 * np.pi * 4.2 * t)) / sr)
    pulse = np.maximum(0, np.cos(phase)) ** 3
    pulse -= pulse.mean()
    return pulse


def vowel_i(dur, f0, amp=0.28):
    n = int(dur * sr)
    src = glottal(n, f0)
    # female-ish /i/
    y = (
        1.0 * resonator(src, 310, 70)
        + 0.75 * resonator(src, 2700, 110)
        + 0.35 * resonator(src, 3300, 150)
    )
    y *= env(n, 0.02, 0.07)
    return amp * y / (np.max(np.abs(y)) + 1e-9)


def syllable(kind, f0, fric_dur, vow_dur):
    if kind == "see":
        fric = band_noise(int(fric_dur * sr), 4200, 8500, tilt=0.4) * env(int(fric_dur * sr), 0.02, 0.03)
        fric *= 0.22
    else:
        fric = band_noise(int(fric_dur * sr), 1400, 8000, tilt=-0.35) * env(int(fric_dur * sr), 0.025, 0.04)
        fric *= 0.085
    vow = vowel_i(vow_dur, f0)
    pad = np.zeros(int(0.12 * sr))
    y = np.concatenate([pad, fric, vow, pad])
    y *= 0.92 / (np.max(np.abs(y)) + 1e-9)
    return y


specs = [
    ("fee-a", "fee", 198, 0.13, 0.36),
    ("fee-b", "fee", 186, 0.15, 0.40),
    ("fee-c", "fee", 210, 0.12, 0.34),
    ("see-a", "see", 198, 0.14, 0.36),
    ("see-b", "see", 186, 0.16, 0.40),
    ("see-c", "see", 210, 0.13, 0.34),
]

for name, kind, f0, fd, vd in specs:
    path = out / f"{name}.wav"
    write_wav(path, syllable(kind, f0, fd, vd))
    print(path.name, path.stat().st_size)