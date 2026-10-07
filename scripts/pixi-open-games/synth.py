"""Original, procedurally synthesised SFX + music for the TokenBlaster arcade ports.
Generated from scratch (sine/square/noise maths), so there is no third-party audio. Dedicated to the public domain (CC0)."""
import sys, os, wave, subprocess
import numpy as np

SR = 22050
rng = np.random.default_rng(7)


def env(n, a=0.005, d=None, power=2.0):
    t = np.arange(n) / SR
    dur = n / SR
    d = d if d is not None else dur
    e = np.clip(1 - t / d, 0, 1) ** power
    att = np.clip(t / a, 0, 1)
    return e * att


def tone(f0, dur, f1=None, kind='sine', vol=0.5, power=2.0, a=0.004):
    n = int(SR * dur)
    f1 = f0 if f1 is None else f1
    f = np.linspace(f0, f1, n)
    ph = 2 * np.pi * np.cumsum(f) / SR
    if kind == 'sine':
        w = np.sin(ph)
    elif kind == 'square':
        w = np.sign(np.sin(ph)) * 0.6
    elif kind == 'tri':
        w = 2 / np.pi * np.arcsin(np.sin(ph))
    else:
        w = np.sin(ph)
    return w * env(n, a, None, power) * vol


def noise(dur, vol=0.4, power=2.0, lp=0.0):
    n = int(SR * dur)
    x = rng.uniform(-1, 1, n)
    if lp:
        for i in range(1, n):
            x[i] = x[i - 1] * lp + x[i] * (1 - lp)
        x /= max(1e-6, np.abs(x).max())
    return x * env(n, 0.002, None, power) * vol


def seq(parts):
    return np.concatenate(parts)


def mix(*a):
    n = max(len(x) for x in a)
    out = np.zeros(n)
    for x in a:
        out[: len(x)] += x
    return out


def silence(d):
    return np.zeros(int(SR * d))


def save(path, x):
    x = np.clip(x, -1, 1)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())


def note(n):
    return 440 * 2 ** ((n - 69) / 12)


def music(seconds_bars, bpm, prog, lead_seed, bass_oct=36, lead_vol=0.12):
    beat = 60 / bpm
    r = np.random.default_rng(lead_seed)
    pent = [0, 3, 5, 7, 10, 12, 15]
    bars = []
    for root in prog:
        bar = []
        for b in range(8):  # eighth notes
            dur = beat / 2
            bass = tone(note(root + bass_oct - 24 + (12 if b % 4 == 3 else 0)), dur * 0.9, kind='tri', vol=0.22, power=1.2)
            arp = tone(note(root + 12 + [0, 7, 12, 7][b % 4]), dur * 0.8, kind='square', vol=0.05, power=1.5)
            lead = silence(dur)
            if r.random() < 0.55:
                lead = tone(note(root + 24 + pent[r.integers(0, len(pent))]), dur * r.choice([0.9, 1.8]), kind='sine', vol=lead_vol, power=1.3)
            bar.append(mix(bass, arp, lead)[: int(SR * dur)] if len(mix(bass, arp, lead)) >= int(SR * dur) else np.pad(mix(bass, arp, lead), (0, int(SR * dur) - len(mix(bass, arp, lead)))))
        bars.append(np.concatenate(bar))
    return np.concatenate(bars * (seconds_bars // len(prog)))


def to_mp3(wav, mp3):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-b:a', '64k', mp3], check=True)


def bubbo(out):
    save(f'{out}/bubble-land-sfx.wav', mix(tone(520, 0.09, 260, vol=0.5, power=2), noise(0.03, 0.15)))
    save(f'{out}/cannon-move.wav', tone(180, 0.05, 140, kind='square', vol=0.25))
    save(f'{out}/primary-button-press.wav', seq([tone(660, 0.07, kind='square', vol=0.3), tone(990, 0.12, kind='square', vol=0.3)]))
    save(f'{out}/secondary-button-press.wav', tone(740, 0.08, 600, kind='tri', vol=0.45))
    save(f'{out}/bubbles-falling.wav', mix(tone(900, 0.7, 120, vol=0.35, power=1.5), noise(0.7, 0.2, 1.5, lp=0.8)))
    save(f'{out}/powerup-super.wav', seq([tone(note(n), 0.09, kind='square', vol=0.3) for n in (72, 76, 79, 84, 88)]))
    save(f'{out}/powerup-bomb.wav', mix(noise(0.6, 0.7, 2.0, lp=0.9), tone(110, 0.5, 40, vol=0.6, power=1.5)))
    save(f'{out}/powerup-time.wav', seq([tone(880, 0.05, kind='square', vol=0.3), silence(0.07)] * 3 + [tone(1320, 0.18, vol=0.4)]))
    save(f'{out}/_bgm.wav', music(16, 118, [57, 53, 60, 55], 3))


def potions(out):
    save(f'{out}/sfx-hover.wav', tone(900, 0.04, 1100, kind='tri', vol=0.25))
    save(f'{out}/sfx-press.wav', seq([tone(500, 0.05, kind='square', vol=0.3), tone(750, 0.1, kind='square', vol=0.3)]))
    save(f'{out}/sfx-correct.wav', seq([tone(note(n), 0.1, vol=0.45) for n in (72, 79, 84)]))
    save(f'{out}/sfx-incorrect.wav', seq([tone(220, 0.12, 180, kind='square', vol=0.3), tone(150, 0.2, 110, kind='square', vol=0.3)]))
    save(f'{out}/sfx-bubble.wav', mix(tone(400, 0.12, 900, vol=0.4, power=1.2), noise(0.04, 0.1)))
    save(f'{out}/sfx-match.wav', seq([tone(note(n), 0.07, kind='tri', vol=0.5) for n in (67, 71, 74, 79)]))
    save(f'{out}/sfx-special.wav', mix(seq([tone(note(n), 0.08, kind='square', vol=0.25) for n in (60, 64, 67, 72, 76, 79, 84)]), noise(0.6, 0.15, 3.0, lp=0.6)))
    save(f'{out}/sfx-countdown.wav', tone(660, 0.18, kind='tri', vol=0.5))
    save(f'{out}/sfx-points.wav', tone(1200, 0.05, 1500, kind='tri', vol=0.3))
    save(f'{out}/_main.wav', music(16, 100, [60, 65, 67, 62], 11))
    save(f'{out}/_game.wav', music(16, 128, [57, 60, 65, 62], 21))
    to_mp3(f'{out}/_main.wav', f'{out}/bgm-main.mp3')
    to_mp3(f'{out}/_game.wav', f'{out}/bgm-game.mp3')
    os.remove(f'{out}/_main.wav')
    os.remove(f'{out}/_game.wav')


if __name__ == '__main__':
    which, out = sys.argv[1], sys.argv[2]
    {'bubbo': bubbo, 'potions': potions}[which](out)
