/**
 * Gun key backups (db/025_gun_backups.sql). POST only, every request signed by the player's identity key
 * (src/lib/gunBackup.ts verifyBackupRequest):
 *   { op: 'put', identityKey, address, ciphertext, ts, signature } → stores the wallet-encrypted gun key for that address
 *   { op: 'get', identityKey, ts, signature } → { backups: [{ address, ciphertext }] }, newest first
 * The server only ever sees ciphertext the player's own wallet made; it can not decrypt it.
 */
import { NextResponse } from 'next/server';
import { rpc } from '@/lib/launch/server';
import { verifyBackupRequest, type BackupRequest, type GunBackup } from '@/lib/gunBackup';

export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  let b: BackupRequest;
  try {
    b = (await req.json()) as BackupRequest;
  } catch {
    return bad('Bad request.');
  }
  if (b?.op !== 'put' && b?.op !== 'get') return bad('Bad request.');
  if (!(await verifyBackupRequest(b))) return bad('Signature does not match.', 401);
  try {
    if (b.op === 'put') {
      await rpc('tokenblaster_gun_backup_put', { p_identity_key: b.identityKey, p_address: b.address, p_ciphertext: b.ciphertext });
      return NextResponse.json({ ok: true });
    }
    const rows = await rpc<GunBackup[]>('tokenblaster_gun_backup_list', { p_identity_key: b.identityKey });
    return NextResponse.json({ backups: (rows ?? []).map((r) => ({ address: r.address, ciphertext: r.ciphertext })) });
  } catch {
    return bad('Gun backups are not available right now.', 503);
  }
}
