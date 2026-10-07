'use client';

import { useSyncExternalStore } from 'react';

/**
 * Preview switch for the site palettes (tokens in src/app/globals.css). ?palette=signal|paper|wipeout|volt also works
 * (the inline script in layout.tsx applies it before paint and remembers it). Remove this component, or set
 * NEXT_PUBLIC_TB_PALETTE_TOGGLE=0, once a palette is chosen.
 */
export const PALETTES = [
  ['signal', 'Signal', 'red on ink'],
  ['paper', 'Paper', 'red, black, white'],
  ['wipeout', 'Wipe', 'white, orange, cyan'],
  ['volt', 'Volt', 'black and acid'],
] as const;

const KEY = 'tb.palette';
const listeners = new Set<() => void>();
const read = () => document.documentElement.dataset.palette || 'signal';

function set(name: string) {
  if (name === 'signal') delete document.documentElement.dataset.palette;
  else document.documentElement.dataset.palette = name;
  try {
    localStorage.setItem(KEY, name);
  } catch {
    /* storage blocked */
  }
  listeners.forEach((f) => f());
}

export function PaletteToggle({ className = '' }: { className?: string }) {
  const now = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => 'signal',
  );
  if (process.env.NEXT_PUBLIC_TB_PALETTE_TOGGLE === '0') return null;
  return (
    <div role="group" aria-label="Preview palette" className={`flex items-center gap-1 ${className}`}>
      <span className="dr-code mr-1 hidden sm:inline">Palette</span>
      {PALETTES.map(([id, label, title]) => (
        <button key={id} type="button" title={title} aria-pressed={now === id} onClick={() => set(id)} className={`btn !px-2 !py-0.5 !text-[11px] ${now === id ? 'btn-on' : ''}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Runs before paint: ?palette= wins, then the remembered choice. */
export const PALETTE_SCRIPT = `(function(){try{var ok={paper:1,wipeout:1,volt:1,signal:1};var q=new URLSearchParams(location.search).get('palette');var p=q&&ok[q]?q:localStorage.getItem('${KEY}');if(q&&ok[q])localStorage.setItem('${KEY}',q);if(p&&ok[p]&&p!=='signal')document.documentElement.dataset.palette=p;}catch(e){}})();`;
