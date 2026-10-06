import type { Metadata } from 'next';
import Link from 'next/link';
import { HOUSE_BPS, INDEX_FEE, INDEX_LAUNCH, LAUNCH_FEE, ROUTE_BPS } from '@/lib/launch/curve';
import { ROUTES } from '@/lib/launch/shape';
import { CurveSlider } from '@/components/launch/CurveSlider';
import { LaunchNav } from '@/components/launch/LaunchNav';

export const metadata: Metadata = { title: 'How it works · BlastPad · TokenBlaster.lol' };

const pct = (bps: bigint) => `${(Number(bps) / 100).toFixed(2)}%`;

export default function How() {
  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-3 p-2.5">
      <LaunchNav />
      <section className="panel">
        <p className="text-xs text-muted">{'// BLASTPAD · HOW IT WORKS'}</p>
        <h1 className="text-2xl font-bold text-hot">A coin, a curve and one BSV transaction per trade.</h1>
        <p className="mt-1 text-dim">No order book, no listing, no account. This is the whole machine: what moves the price, what every trade costs and where each satoshi goes.</p>
      </section>

      <section className="panel">
        <h2 className="panel-title">01 In one minute</h2>
        <ol className="mt-2 list-decimal pl-5 text-dim">
          <li><b className="text-fg">Launch.</b> Pick a ticker, a name and an image. One transaction from your wallet mints a fixed 1,000,000,000 tokens straight into the coin’s bonding curve. Nothing is set aside for anyone: the creator’s first buy is on the curve too.</li>
          <li><b className="text-fg">Trade.</b> Buying takes tokens out of the curve and moves the price up; selling puts them back and moves it down. Each trade is one atomic transaction: your BSV and the tokens change hands together, or not at all.</li>
          <li><b className="text-fg">Graduate.</b> When 793,100,000 tokens have been bought the coin graduates. It keeps its crown and keeps trading on the same curve, which stays as permanent liquidity.</li>
          <li><b className="text-fg">Play.</b> Every coin is ammo in the TokenBlaster games. Shoot it in the Arena or blast it with the gun: every shot is a real transaction of that coin.</li>
        </ol>
      </section>

      <section className="panel">
        <h2 className="panel-title">02 The bonding curve</h2>
        <p className="mt-2 text-dim">You trade against the curve itself. It follows one rule: (1 BSV + the BSV in the pool) × (1.073B − tokens sold) stays constant, so the price depends only on how many tokens have been sold. The same amount at the same point costs the same for everyone.</p>
        <CurveSlider />
        <p className="mt-2 text-dim">A new coin starts at a market cap of about 0.93 BSV and graduates near 13.7 BSV, with about 2.83 BSV in its pool. The pool is solvent by construction: selling every token ever bought walks the curve back to the start and pays out exactly what went in, minus fees.</p>
      </section>

      <section className="panel">
        <h2 className="panel-title">03 One trade, one transaction</h2>
        <p className="mt-2 text-dim">The server proposes the trade: the pool’s coins as inputs and the pool’s outputs. Your browser checks them against its own quote (same curve code), your wallet adds your coins and shows you every output, then the pool signs its inputs and your wallet signs yours. If the transaction would take more than you agreed, or give you less, nobody signs.</p>
        <p className="mt-2 text-dim">One coin trades one trade at a time: if someone else’s trade is settling, yours waits a second and re-quotes. Your slippage limit cancels the trade if the price moved too far.</p>
      </section>

      <section className="panel">
        <h2 className="panel-title">04 What it costs</h2>
        <table className="mt-2 w-full text-left text-sm">
          <tbody>
            <tr className="border-t border-line-dim"><td className="py-1">Trading fee</td><td>{pct(HOUSE_BPS + ROUTE_BPS)} of the BSV side</td><td className="text-dim">{pct(HOUSE_BPS)} to TokenBlaster, {pct(ROUTE_BPS)} to the coin’s route</td></tr>
            <tr className="border-t border-line-dim"><td className="py-1">Launch</td><td>{LAUNCH_FEE.toLocaleString()} sats</td><td className="text-dim">TokenBlaster, once, in the launch transaction</td></tr>
            <tr className="border-t border-line-dim"><td className="py-1">Token index (launch)</td><td>{(INDEX_LAUNCH / 1e8).toFixed(1)} BSV</td><td className="text-dim">Once, in the launch transaction, into the token’s GorillaPool BSV-21 fund. GorillaPool only indexes a token once its fund reaches 0.1 BSV; from then on wallets and explorers see your tokens and sells can be verified straight away.</td></tr>
            <tr className="border-t border-line-dim"><td className="py-1">Token index (trades)</td><td>{INDEX_FEE.toLocaleString()} sats per token output</td><td className="text-dim">Keeps the fund topped up. Never more than 5,000 sats a trade.</td></tr>
            <tr className="border-t border-line-dim"><td className="py-1">Network</td><td>a few hundred sats</td><td className="text-dim">The miners, by transaction size</td></tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">That is all of it. Holding costs nothing. One buy is between 0.0001 and 20 BSV.</p>
      </section>

      <section className="panel">
        <h2 className="panel-title">05 Where the {pct(ROUTE_BPS)} goes</h2>
        <p className="mt-2 text-dim">At launch the creator picks one route and signs it with their wallet key. It can never be changed afterwards, by the creator or by TokenBlaster. Every coin page shows the signed message.</p>
        <ul className="mt-2 flex flex-col gap-2">
          {ROUTES.map((r) => (
            <li key={r.kind} className="inset p-2"><b className="text-hot">{r.title}.</b> <span className="text-dim">{r.about}</span></li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2 className="panel-title">06 Who holds what</h2>
        <p className="mt-2 text-dim"><b className="text-fg">Your wallet: yours alone.</b> Tokens you buy land on a key in your own wallet and stay there, whatever happens to this site.</p>
        <p className="mt-2 text-dim"><b className="text-fg">The pools and vaults: held by the TokenBlaster server.</b> Each coin’s curve is a pair of addresses (tokens, BSV) and a fee vault whose keys the server holds. That is custody, and we say it plainly. What they hold is public: every coin page has a proof of reserves that checks the pool against the curve and against the chain. The creator has no key to the pool.</p>
      </section>

      <section className="panel">
        <h2 className="panel-title">07 Questions</h2>
        <dl className="mt-2 flex flex-col gap-2 text-dim">
          <dt className="text-fg">Can the supply change?</dt><dd>It can never grow: all 1,000,000,000 are minted at launch with no mint afterwards. It can shrink when a buyback burns tokens.</dd>
          <dt className="text-fg">Another wallet doesn’t show my tokens yet.</dt><dd>Other apps see them once the BSV-21 index has validated the transaction, usually within a minute or two.</dd>
          <dt className="text-fg">“The price moved”?</dt><dd>Someone else’s trade landed first and moved the curve past your slippage limit. Nothing was spent. Quote again.</dd>
        </dl>
      </section>

      <p className="text-center text-xs text-muted">Memecoins are toys. Prices can go to zero and every trade is final on-chain. Nothing here is investment advice. <Link href="/launch/new" className="underline">Launch a coin</Link></p>
    </main>
  );
}
