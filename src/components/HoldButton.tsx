'use client';

/** A touch button that holds a game key down while pressed (pointer capture, no context menu). */
import type { ReactNode, RefObject } from 'react';

type Ctl = RefObject<{ key: (k: string, down: boolean) => void } | null>;

export function HoldButton({ ctl, k, className, children }: { ctl: Ctl; k: string; className: string; children: ReactNode }) {
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        ctl.current?.key(k, true);
      }}
      onPointerUp={() => ctl.current?.key(k, false)}
      onPointerCancel={() => ctl.current?.key(k, false)}
      onContextMenu={(e) => e.preventDefault()}
      className={className}
    >
      {children}
    </button>
  );
}
