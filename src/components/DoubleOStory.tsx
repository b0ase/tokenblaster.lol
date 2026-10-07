'use client';

/**
 * Double-O Satoshi's story UI: comic-panel dialogue (briefings, debriefs) and a radio strip during
 * play. Portraits are drawn on a canvas as cartoon parodies (no likenesses).
 */
import { useEffect, useRef, useState } from 'react';
import { SPEAKERS, type Line, type Speaker } from '@/lib/doubleo/story';

/** A stylised cartoon head for a speaker, drawn once into a small canvas. */
function drawPortrait(c: HTMLCanvasElement, who: Speaker) {
  const g = c.getContext('2d');
  if (!g) return;
  const SS = 3; // drawn at 3x so edges stay crisp on retina screens
  const W = c.width / SS;
  const H = c.height / SS;
  g.setTransform(SS, 0, 0, SS, 0, 0);
  g.imageSmoothingQuality = 'high';
  const sp = SPEAKERS[who];
  g.clearRect(0, 0, W, H);
  // Studio backdrop: dark gradient with a coloured key-light glow behind the head.
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#16181e');
  bg.addColorStop(1, '#050507');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W * 0.62, H * 0.35, 2, W * 0.55, H * 0.4, W * 0.75);
  glow.addColorStop(0, sp.color);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = 0.45;
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 1;
  const finish = () => {
    // Cinematic lighting over the finished drawing: soft side shadow, face highlight, rim light, vignette.
    const sh = g.createLinearGradient(0, 0, W, 0);
    sh.addColorStop(0, 'rgba(0,0,0,0.0)');
    sh.addColorStop(0.55, 'rgba(0,0,0,0.0)');
    sh.addColorStop(1, 'rgba(0,0,0,0.5)');
    g.fillStyle = sh;
    g.fillRect(0, 0, W, H);
    const hl = g.createRadialGradient(W * 0.42, H * 0.38, 1, W * 0.45, H * 0.42, W * 0.32);
    hl.addColorStop(0, 'rgba(255,240,220,0.28)');
    hl.addColorStop(1, 'rgba(255,240,220,0)');
    g.fillStyle = hl;
    g.fillRect(0, 0, W, H);
    const vg = g.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.65)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = sp.color;
    g.globalAlpha = 0.5;
    g.lineWidth = 1.2;
    g.strokeRect(0.6, 0.6, W - 1.2, H - 1.2);
    g.globalAlpha = 1;
  };
  const cx = W / 2;
  const skin = who === 'one' ? '#1a1a1a' : who === 'kweg' ? '#9aa0a8' : '#f2c9a0';
  // Shoulders / suit.
  const suit: Record<Speaker, string> = { m: '#2a3140', q: '#5a4630', one: '#111', kweg: '#202028', cz: '#1c1c22', brian: '#3a4a6a', michael: '#222', jihan: '#e0a020', sam: '#3a7a5a' };
  g.fillStyle = suit[who];
  g.beginPath();
  g.ellipse(cx, H * 1.02, W * 0.46, H * 0.32, 0, Math.PI, 0);
  g.fill();
  if (who !== 'sam' && who !== 'jihan') {
    g.fillStyle = '#f4f4f4';
    g.beginPath();
    g.moveTo(cx - W * 0.1, H * 0.72);
    g.lineTo(cx + W * 0.1, H * 0.72);
    g.lineTo(cx, H * 0.9);
    g.fill();
    g.fillStyle = who === 'cz' ? '#f5b800' : who === 'michael' ? '#ff2030' : '#8a1020';
    g.fillRect(cx - 4, H * 0.74, 8, H * 0.16);
  }
  if (who === 'sam') {
    g.fillStyle = '#e8e8e8';
    g.font = `bold ${W * 0.09}px sans-serif`;
    g.textAlign = 'center';
    g.fillText('FTXTRA', cx, H * 0.95);
  }
  // Head.
  g.fillStyle = skin;
  g.beginPath();
  g.ellipse(cx, H * 0.46, W * 0.24, H * 0.27, 0, 0, Math.PI * 2);
  g.fill();
  // Ears.
  g.beginPath();
  g.ellipse(cx - W * 0.24, H * 0.47, W * 0.04, H * 0.06, 0, 0, Math.PI * 2);
  g.ellipse(cx + W * 0.24, H * 0.47, W * 0.04, H * 0.06, 0, 0, Math.PI * 2);
  g.fill();
  // Hair / hats.
  if (who === 'sam') {
    g.fillStyle = '#3a2412';
    for (let i = 0; i < 16; i++) {
      g.beginPath();
      g.arc(cx + Math.cos((i / 16) * Math.PI) * W * 0.24, H * 0.26 - Math.sin((i / 16) * Math.PI) * H * 0.1, W * 0.08, 0, Math.PI * 2);
      g.fill();
    }
  } else if (who === 'jihan') {
    g.fillStyle = '#f5b800';
    g.beginPath();
    g.ellipse(cx, H * 0.27, W * 0.28, H * 0.12, 0, Math.PI, 0);
    g.fill();
    g.fillRect(cx - W * 0.32, H * 0.26, W * 0.64, H * 0.03);
  } else if (who === 'm') {
    g.fillStyle = '#d8d8d8';
    g.beginPath();
    g.ellipse(cx, H * 0.27, W * 0.24, H * 0.09, 0, Math.PI, 0);
    g.fill();
  } else if (who === 'q') {
    g.fillStyle = '#bbb';
    g.fillRect(cx - W * 0.25, H * 0.33, W * 0.06, H * 0.14);
    g.fillRect(cx + W * 0.19, H * 0.33, W * 0.06, H * 0.14);
  } else if (who === 'michael') {
    g.fillStyle = '#ddd';
    g.beginPath();
    g.ellipse(cx, H * 0.24, W * 0.18, H * 0.04, 0, 0, Math.PI * 2);
    g.fill();
  } else if (who === 'kweg') {
    g.fillStyle = '#7a8088';
    g.beginPath();
    g.ellipse(cx - W * 0.3, H * 0.42, W * 0.12, H * 0.18, -0.3, 0, Math.PI * 2);
    g.ellipse(cx + W * 0.3, H * 0.42, W * 0.12, H * 0.18, 0.3, 0, Math.PI * 2);
    g.fill();
  }
  if (who === 'one') {
    // Number One: only a silhouette, two eyes and a white cat.
    g.fillStyle = '#ff3030';
    g.fillRect(cx - W * 0.11, H * 0.44, W * 0.06, H * 0.03);
    g.fillRect(cx + W * 0.05, H * 0.44, W * 0.06, H * 0.03);
    g.fillStyle = '#f4f4f4';
    g.beginPath();
    g.ellipse(cx + W * 0.2, H * 0.92, W * 0.16, H * 0.08, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(cx + W * 0.3, H * 0.86);
    g.lineTo(cx + W * 0.33, H * 0.78);
    g.lineTo(cx + W * 0.36, H * 0.86);
    g.fill();
    finish();
    return;
  }
  // Eyes.
  const eye = who === 'michael' ? '#ff2030' : '#111';
  g.fillStyle = eye;
  g.beginPath();
  g.arc(cx - W * 0.09, H * 0.44, W * 0.03, 0, Math.PI * 2);
  g.arc(cx + W * 0.09, H * 0.44, W * 0.03, 0, Math.PI * 2);
  g.fill();
  if (who === 'michael') {
    g.strokeStyle = '#ff2030';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx - W * 0.09, H * 0.44);
    g.lineTo(0, H * 0.3);
    g.moveTo(cx + W * 0.09, H * 0.44);
    g.lineTo(W, H * 0.3);
    g.stroke();
  }
  if (who === 'cz' || who === 'q') {
    g.strokeStyle = '#222';
    g.lineWidth = 2;
    g.strokeRect(cx - W * 0.15, H * 0.4, W * 0.12, H * 0.08);
    g.strokeRect(cx + W * 0.03, H * 0.4, W * 0.12, H * 0.08);
  }
  // Brows and mouth: villains scowl, allies smile.
  const villain = who === 'cz' || who === 'brian' || who === 'michael' || who === 'jihan' || who === 'sam';
  g.strokeStyle = '#222';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(cx - W * 0.14, H * (villain ? 0.36 : 0.37));
  g.lineTo(cx - W * 0.04, H * (villain ? 0.39 : 0.36));
  g.moveTo(cx + W * 0.14, H * (villain ? 0.36 : 0.37));
  g.lineTo(cx + W * 0.04, H * (villain ? 0.39 : 0.36));
  g.stroke();
  g.beginPath();
  if (villain) g.arc(cx, H * 0.6, W * 0.08, Math.PI + 0.3, -0.3);
  else g.arc(cx, H * 0.55, W * 0.08, 0.3, Math.PI - 0.3);
  g.stroke();
  finish();
}

export function Portrait({ who, size = 96 }: { who: Speaker; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawPortrait(ref.current, who);
  }, [who]);
  return <canvas ref={ref} width={size * 3} height={size * 3} className="shrink-0 rounded-sm border" style={{ borderColor: SPEAKERS[who].color, width: size, height: size, boxShadow: `0 0 18px ${SPEAKERS[who].color}55, 0 6px 18px #000` }} aria-label={SPEAKERS[who].name} role="img" />;
}

/** Text that types itself out; `full` shows it all at once. */
function useTyped(text: string, full: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    void Promise.resolve().then(() => setN(0));
    const id = setInterval(() => setN((x) => (x >= text.length ? x : x + 2)), 22);
    return () => clearInterval(id);
  }, [text]);
  return full ? text : text.slice(0, n);
}

/**
 * A run of comic panels (briefing / debrief). Click, tap, Space or Enter: finish the line, then the
 * next one; Esc skips the lot. `onDone` runs from that user gesture (so it can lock the pointer).
 */
export function Dialogue({ lines, title, onDone, doneLabel = 'GO' }: { lines: Line[]; title: string; onDone: () => void; doneLabel?: string }) {
  const [i, setI] = useState(0);
  const [full, setFull] = useState(false);
  const line = lines[Math.min(i, lines.length - 1)];
  const typed = useTyped(line.text, full);
  const last = i >= lines.length - 1;
  const advance = () => {
    if (typed.length < line.text.length) return setFull(true);
    if (last) return onDone();
    setFull(false);
    setI(i + 1);
  };
  const advanceRef = useRef(advance);
  const doneRef = useRef(onDone);
  useEffect(() => {
    advanceRef.current = advance;
    doneRef.current = onDone;
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') doneRef.current();
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        advanceRef.current();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const sp = SPEAKERS[line.who];
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-between bg-black/80 backdrop-blur-md" onClick={advance} role="dialog" aria-label={title} style={{ background: `radial-gradient(ellipse at 50% 60%, ${sp.color}22, rgba(0,0,0,0.88) 70%)` }}>
      <div className="w-full bg-black px-4 py-2 text-center text-[11px] tracking-[0.35em] text-dim">{title}</div>
      <div className="flex w-full max-w-3xl flex-col items-center gap-4 px-4">
        <div className="flex w-full items-end gap-5">
          <Portrait who={line.who} size={176} />
          <div className="min-w-0 flex-1 rounded-sm border border-white/10 bg-black/55 p-4 text-left shadow-[0_10px_40px_rgba(0,0,0,0.7)] backdrop-blur" style={{ borderLeft: `3px solid ${sp.color}` }}>
            <p className="text-sm font-bold uppercase tracking-[0.25em]" style={{ color: sp.color }}>
              {sp.name} <span className="text-[11px] font-normal normal-case tracking-normal text-dim">· {sp.role}</span>
            </p>
            <p className="mt-2 min-h-[6rem] text-lg leading-snug text-white sm:text-2xl">
              {typed}
              {typed.length < line.text.length && <span className="blink">▌</span>}
            </p>
          </div>
        </div>
      <div className="flex items-center gap-2">
        {lines.map((_, j) => (
          <span key={j} className={`h-1.5 w-6 ${j <= i ? 'bg-fg' : 'bg-white/20'}`} />
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-fire"
          onClick={(e) => {
            e.stopPropagation();
            if (last && typed.length >= line.text.length) onDone();
            else advance();
          }}
        >
          {last && typed.length >= line.text.length ? doneLabel : 'NEXT ▶'}
        </button>
        {!last && (
          <button
            type="button"
            className="btn px-3 py-1"
            onClick={(e) => {
              e.stopPropagation();
              onDone();
            }}
          >
            SKIP (Esc)
          </button>
        )}
      </div>
      </div>
      <div className="h-10 w-full bg-black" />
    </div>
  );
}

/** One radio line during play: portrait plus typed text, top-left, fades after a few seconds. */
export function Radio({ line }: { line: (Line & { key: number }) | null }) {
  const [shown, setShown] = useState<(Line & { key: number }) | null>(null);
  useEffect(() => {
    if (!line) return;
    void Promise.resolve().then(() => setShown(line));
    const id = setTimeout(() => setShown((s) => (s?.key === line.key ? null : s)), Math.max(5500, line.text.length * 85));
    return () => clearTimeout(id);
  }, [line]);
  const typed = useTyped(shown?.text ?? '', false);
  if (!shown) return null;
  const sp = SPEAKERS[shown.who];
  // Villains get a big red-edged card: their taunts are half the fun.
  const bad = shown.who !== 'm' && shown.who !== 'q' && shown.who !== 'kweg';
  return (
    <div className={`pointer-events-none absolute left-2 top-24 z-20 flex items-start gap-3 rounded-sm border bg-black/80 p-2 backdrop-blur-sm ${bad ? 'max-w-[min(38rem,92vw)] p-3' : 'max-w-[min(30rem,80vw)]'}`} style={{ borderColor: sp.color, boxShadow: bad ? `0 0 24px ${sp.color}66` : undefined }} aria-live="polite">
      <Portrait who={shown.who} size={bad ? 76 : 56} />
      <div className="min-w-0 text-left">
        <p className="text-[11px] font-bold tracking-widest" style={{ color: sp.color }}>
          {bad ? '☠' : '📻'} {sp.name} {bad && <span className="font-normal text-dim">· {sp.role}</span>}
        </p>
        <p className={bad ? 'text-base font-semibold text-white sm:text-lg' : 'text-sm text-white'}>{typed}</p>
      </div>
    </div>
  );
}
