/**
 * The TERRORNODE Twetch-airdrop grant (api/terrornode/grant) may only ever pay the airdrop wallet.
 * Owner-approved 28 Oct 2026 (SIGNING-PATHS-AUDIT second pass, finding B): the destination is fixed here, not
 * chosen by the caller, so a leaked LAUNCH_SECRET cannot redirect the 1,286,000 TERRORNODE.
 * Public address only; the airdrop wallet's key is never in code.
 */
export const GRANT_TO = '1P9xhsoN9WqtBn3v3fUnDeXencHnaevv79';

/** The body `to` is optional; when sent it must equal GRANT_TO exactly. Returns the destination or null (reject). */
export function grantDestination(bodyTo: unknown): string | null {
  if (bodyTo === undefined || bodyTo === null || bodyTo === '') return GRANT_TO;
  return bodyTo === GRANT_TO ? GRANT_TO : null;
}
