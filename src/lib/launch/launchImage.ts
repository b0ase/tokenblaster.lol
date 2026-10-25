/**
 * Output 0 of a BlastPad launch: the coin image, the creator's. (The deploy+mint is output 1 and goes
 * to the coin's POOL key, never the wallet: /api/launch/new checks that.) In bWalletX the image goes
 * to an ordinal key it picked, as a plain inscription into '1sat'; other wallets keep the MAP-tagged
 * inscription to the creator's address.
 */
import type { WalletInterface } from '@bsv/sdk';
import { inscriptionScript } from '../inscribe';
import { imageOrdinalOutput } from '../walletDeploy';

export function launchImageOutput(w: { client: WalletInterface; address: string }, f: { sym: string; image: { bytes: Uint8Array; type: string } }) {
  const file = { contentType: f.image.type, data: Array.from(f.image.bytes) };
  const what = `$${f.sym} image (yours)`;
  return imageOrdinalOutput(w.client, file, what, () => ({
    lockingScript: inscriptionScript(w.address, file, { app: 'tokenblaster.lol', type: 'launch', sym: f.sym }).toHex(),
    satoshis: 1,
    outputDescription: what,
  }));
}
