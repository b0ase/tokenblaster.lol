/**
 * "Downloading the game engine" card (owner, 29 Oct 2026: "it's not clear whether it's doing anything"). Plain
 * markup with no game code, so it paints at once: used by the route's loading.tsx and while the engine chunk loads.
 */
export function EngineLoading() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-5 px-4 text-center" role="status" aria-live="polite">
      <div className="font-black uppercase leading-none tracking-tight text-[#e0102a]" style={{ fontSize: 'clamp(2rem, 7vw, 4.5rem)' }}>
        Welcome to TERRORNODE
      </div>
      <div className="h-1.5 w-[min(320px,80vw)] overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-[#e0102a]" />
      </div>
      <p className="text-sm text-white/80 sm:text-base">Downloading the game engine. Please wait.</p>
      <p className="text-xs text-white/50">You only need to do this once: after this it opens straight away.</p>
    </div>
  );
}
