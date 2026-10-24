'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * A ref that is true while `target` is near the viewport and the tab is visible. It never re-renders: live widgets
 * read it in their timers / animation loops to skip work nobody can see (data keeps landing in their own refs).
 * `target` returns the element to watch (default: the ref's element); no element or no IntersectionObserver = always on.
 */
export function useOnScreen(target: RefObject<Element | null> | (() => Element | null | undefined), margin = '200px'): RefObject<boolean> {
  const on = useRef(true);
  useEffect(() => {
    const el = typeof target === 'function' ? target() : target.current;
    let inView = true;
    const sync = () => {
      on.current = inView && document.visibilityState !== 'hidden';
    };
    let io: IntersectionObserver | undefined;
    if (el && typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(
        ([e]) => {
          inView = e.isIntersecting;
          sync();
        },
        { rootMargin: margin },
      );
      io.observe(el);
    }
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      io?.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [margin]);
  return on;
}
