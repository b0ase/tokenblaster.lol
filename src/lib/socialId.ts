/**
 * Verified social identity (X/Twitter handle) for multiplayer name tags.
 *
 * The wallet holds a BRC-52 identity certificate, issued by the bWalletX certifier after the user
 * links their X account: type SOCIAL_X_TYPE, fields { handle, userId }. To show it to other players
 * we ask the wallet to PROVE the `handle` field to the well-known "anyone" key (private key 1), so
 * any peer can decrypt that one field and check the certifier's signature. No server is involved.
 * Contract for the wallet side: docs/handoff-bwalletx-social-identity.md.
 *
 * Until NEXT_PUBLIC_BWALLETX_CERTIFIER is set, nothing verifies and players show their typed name.
 */
import { Hash, PrivateKey, ProtoWallet, Utils, VerifiableCertificate, type WalletInterface } from '@bsv/sdk';

/** Certificate type id (32 bytes, base64): sha256 of the UTF-8 string 'bwalletx:social:x'. */
export const SOCIAL_X_TYPE = Utils.toBase64(Hash.sha256(Utils.toArray('bwalletx:social:x', 'utf8')));
/** bWalletX's certifier identity key (public). Empty = verified handles are off. */
export const CERTIFIER = process.env.NEXT_PUBLIC_BWALLETX_CERTIFIER ?? '';

const ANYONE = new PrivateKey(1);
const ANYONE_PUB = ANYONE.toPublicKey().toString();

/** What a player broadcasts: the certificate plus the keyring that opens its `handle` for anyone. */
export type SocialProof = {
  type: string;
  serialNumber: string;
  subject: string;
  certifier: string;
  revocationOutpoint: string;
  fields: Record<string, string>;
  signature: string;
  keyring: Record<string, string>;
  /** Session binding: the subject's signature over `session`, so a copied proof is useless. */
  session: string;
  sessionSig: number[];
};

const SESSION_PROTOCOL: [1, string] = [1, 'tokenblaster social'];

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/** Ask the connected wallet for a provable X handle. Null when it has none (or says no). */
export async function proveSocialX(wallet: WalletInterface, session: string): Promise<{ handle: string; proof: SocialProof } | null> {
  if (!CERTIFIER) return null;
  try {
    const { certificates } = await wallet.listCertificates({ certifiers: [CERTIFIER], types: [SOCIAL_X_TYPE], limit: 1 });
    const c = certificates[0];
    if (!c) return null;
    const { keyringForVerifier } = await wallet.proveCertificate({ certificate: c, fieldsToReveal: ['handle'], verifier: ANYONE_PUB });
    const { signature: sessionSig } = await wallet.createSignature({ data: Utils.toArray(session, 'utf8'), protocolID: SESSION_PROTOCOL, keyID: '1', counterparty: 'anyone' });
    const proof: SocialProof = { type: c.type, serialNumber: c.serialNumber, subject: c.subject, certifier: c.certifier, revocationOutpoint: c.revocationOutpoint, fields: c.fields, signature: c.signature ?? '', keyring: keyringForVerifier, session, sessionSig };
    const handle = await verifySocialX(proof, session);
    return handle ? { handle, proof } : null;
  } catch {
    return null;
  }
}

const checked = new Map<string, Promise<string | null>>();

/**
 * Check a peer's proof for the session they are playing as: right type and certifier, valid
 * certificate signature, the subject signed this session, decryptable handle. Cached.
 */
export function verifySocialX(p: SocialProof | null | undefined, session: string): Promise<string | null> {
  if (!p || !CERTIFIER || p.certifier !== CERTIFIER || p.type !== SOCIAL_X_TYPE || !p.keyring?.handle || p.session !== session || !Array.isArray(p.sessionSig)) return Promise.resolve(null);
  const key = `${p.serialNumber}:${p.subject}:${session}`;
  let r = checked.get(key);
  if (!r) {
    r = (async () => {
      try {
        const vc = new VerifiableCertificate(p.type, p.serialNumber, p.subject, p.certifier, p.revocationOutpoint, p.fields, p.keyring, p.signature);
        await vc.verify();
        const anyone = new ProtoWallet(ANYONE);
        const { valid } = await anyone.verifySignature({ data: Utils.toArray(session, 'utf8'), signature: p.sessionSig, protocolID: SESSION_PROTOCOL, keyID: '1', counterparty: p.subject });
        if (!valid) return null;
        const { handle } = await vc.decryptFields(anyone);
        return handle && HANDLE.test(handle) ? handle : null;
      } catch {
        return null;
      }
    })();
    checked.set(key, r);
  }
  return r;
}
