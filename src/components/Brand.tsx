import { brandParts } from '@/lib/brandCase';

/**
 * Renders text with every "nSLAVE" protected from CSS text-transform: uppercase,
 * so caps-styled headings still read nSLAVE, never with a capital N.
 */
export function Brand({ children }: { children: string | number | null | undefined }) {
  if (children == null) return null;
  const parts = brandParts(String(children));
  if (parts.length === 1) return <>{parts[0]}</>;
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <span key={i} data-brand="nslave" className="normal-case">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}
