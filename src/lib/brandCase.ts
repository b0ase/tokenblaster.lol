/**
 * Brand casing. The corporation is always "nSLAVE" (lower-case n), even in caps-styled text.
 * Use brandCase() instead of toUpperCase() on user-facing text, and <Brand> (components/Brand.tsx)
 * wherever CSS text-transform: uppercase would turn the n into an N.
 */
export const NSLAVE_NAME = 'nSLAVE';
const RE = /(nslave)/i;

/** Upper-cases everything except the nSLAVE name, which keeps its lower-case n. */
export function brandCase(text: string): string {
  return text.split(RE).map((p, i) => (i % 2 ? NSLAVE_NAME : p.toUpperCase())).join('');
}

/** Splits text into plain parts and nSLAVE brand parts (odd indexes are the brand). */
export function brandParts(text: string): string[] {
  return text.split(RE).map((p, i) => (i % 2 ? NSLAVE_NAME : p));
}
