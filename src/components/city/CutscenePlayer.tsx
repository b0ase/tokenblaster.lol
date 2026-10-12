'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CAST } from '@/lib/city/story/cast';
import type { Cutscene, Shot } from '@/lib/city/story/types';

/**
 * In-engine cutscene: letterbox bars, a title card, typewriter dialogue with speaker plates. Each line can cut the
 * city camera to a shot (via onShot). Click / Space / Enter: finish the line, then next. Esc: skip the scene.
 */
export function CutscenePlayer({ scene, onShot, onDone }: { scene: Cutscene; onShot: (s: Shot) => void; onDone: () => void }) {
  const [i, setI] = useState(-1); // -1 = title card
  const [shown, setShown] = useState(0);
  const line = i >= 0 ? scene.lines[i] : null;
  const done = useRef(false);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDone();
  }, [onDone]);

  const next = () => {
    if (line && shown < line.text.length) return setShown(line.text.length);
    if (i + 1 >= scene.lines.length) return finish();
    setI(i + 1);
    setShown(0);
  };

  // Cut the camera when a line names a shot (title card uses shot 0).
  useEffect(() => {
    const s = i < 0 ? 0 : scene.lines[i]?.shot;
    if (s !== undefined && scene.shots[s]) onShot(scene.shots[s]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cut only when the line changes
  }, [i, scene]);

  // Typewriter, then auto-advance after a read pause.
  useEffect(() => {
    if (i < 0) {
      const t = setTimeout(() => setI(0), 2200);
      return () => clearTimeout(t);
    }
    if (!line) return;
    if (shown < line.text.length) {
      const t = setTimeout(() => setShown((n) => n + 2), 22);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => next(), 1600 + line.text.length * 35);
    return () => clearTimeout(t);
  });

  useEffect(() => {
    const onK = (e: KeyboardEvent) => {
      if (e.code === 'Escape') finish();
      else if (e.code === 'Space' || e.code === 'Enter') next();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onK, true);
    return () => window.removeEventListener('keydown', onK, true);
  });

  const who = line ? CAST[line.who] : null;
  return (
    <div className="absolute inset-0 z-40 select-none" onClick={next} role="dialog" aria-label={scene.title ?? 'Cutscene'}>
      <div className="absolute inset-x-0 top-0 h-[11%] bg-black" />
      <div className="absolute inset-x-0 bottom-0 h-[11%] bg-black" />
      {i < 0 && scene.title && (
        <div className="absolute inset-0 flex items-center justify-center">
          <h2 className="animate-pulse font-mono text-2xl font-bold tracking-[0.35em] text-white drop-shadow-[0_0_18px_rgba(255,63,180,0.8)] sm:text-4xl">{scene.title}</h2>
        </div>
      )}
      {line && who && (
        <div className="absolute inset-x-0 bottom-[13%] mx-auto max-w-3xl px-4">
          {who.name && (
            <span className="mb-1 inline-block px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-black" style={{ background: who.colour }}>
              {who.name}
            </span>
          )}
          <p className={`border-l-2 bg-black/70 px-4 py-3 text-base leading-relaxed text-white backdrop-blur-sm sm:text-lg ${who.name ? '' : 'italic text-white/80'}`} style={{ borderColor: who.colour }}>
            {line.text.slice(0, shown)}
          </p>
        </div>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          finish();
        }}
        className="absolute right-4 top-[12%] font-mono text-[11px] uppercase tracking-[0.25em] text-white/60 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      >
        Skip · Esc
      </button>
    </div>
  );
}
