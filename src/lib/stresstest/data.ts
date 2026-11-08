/**
 * The 31 Oct 2026 BSV stress test, TERRORNODE bots (owner, 8 Nov 2026: report at /stresstest).
 * A fixed record. Run figures come from each run's summary.json (run 6: the last tick of its events.jsonl, it wrote
 * no summary), produced by blaster/terror/cli.ts. Blocks and sample shots were read from WhatsOnChain on 8 Nov 2026.
 */

export const EXPLORER = 'https://bananablocks.com';
export const txUrl = (txid: string) => `${EXPLORER}/tx/${txid}`;
export const blockUrl = (h: number) => `${EXPLORER}/block/${h}`;
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;

/** The bots' funding wallet: every fan-out spends from it. */
export const BOT_WALLET = '1NbrP33mMxRmmFaNvo8ds7kMruqwZT1DVH';
export const FANOUT_LIST = '/stresstest/fanouts-2026-10-31.txt';

export type Run = {
  id: string;
  name: string;
  start: string; // UTC HH:MM:SS, 31 Oct 2026
  end: string;
  secs: number;
  accepted: number;
  fees: number; // sats, fan-outs included
  fanouts: number;
  lanes: number; // lanes per fan-out
  bytes: number;
  peak1s: number; // best single second, tx/s
  peakMin: number; // best 60 s, tx/s
  p50: number; // ms from send to accepted
  p95: number;
  sampled: number; // shots whose status was checked after sending
  seen: number;
  bots: number;
  label: 'bot names' | 'Halloween flags';
  stop: string;
  firstFan: string;
};

export const RUNS: Run[] = [
  {
    id: 'warmup', name: 'Warm-up', start: '04:32:37', end: '04:32:49', secs: 12, accepted: 0, fees: 34_027, fanouts: 1, lanes: 10_000,
    bytes: 0, peak1s: 0, peakMin: 0, p50: 0, p95: 0, sampled: 0, seen: 0, bots: 1, label: 'bot names',
    stop: 'Fan-out only: checked the split lands before any shots.', firstFan: '4993dcc694753426c1138249de3abb3afc119376e96722276f68cbffd9e3d6c7',
  },
  {
    id: 'early', name: 'Early test', start: '04:33:45', end: '04:35:17', secs: 98, accepted: 10_000, fees: 304_027, fanouts: 1, lanes: 10_000,
    bytes: 2_973_846, peak1s: 968, peakMin: 0, p50: 77_704, p95: 77_739, sampled: 83, seen: 78, bots: 1, label: 'bot names',
    stop: 'Finished: all 10,000 shots accepted.', firstFan: '042d2feccd072f135f889a49fa0f1b71a54ccd384c22f2fb5bc71c7aa17ad108',
  },
  {
    id: 'r1', name: 'Run 1', start: '12:09:40', end: '12:10:51', secs: 74, accepted: 17_250, fees: 1_539_830, fanouts: 20, lanes: 15_430,
    bytes: 5_384_752, peak1s: 975, peakMin: 279, p50: 1_444, p95: 9_208, sampled: 164, seen: 151, bots: 20, label: 'bot names',
    stop: 'Safety stop: broadcast errors passed 5% of the last 5,000 sends.', firstFan: '2a810f928a1e3200229311307b2f454a97409f214b16c4b882c3b73eb8e2b324',
  },
  {
    id: 'r2', name: 'Run 2', start: '12:11:09', end: '12:14:00', secs: 174, accepted: 0, fees: 1_049_780, fanouts: 20, lanes: 15_430,
    bytes: 0, peak1s: 0, peakMin: 0, p50: 0, p95: 0, sampled: 0, seen: 0, bots: 20, label: 'bot names',
    stop: 'Stopped by hand before any shots: 20 fan-outs sent at once timed out at the broadcaster. Fixed in #208 (fan-out cap and stagger).',
    firstFan: '2fd33b30e02119e356f64e3e5adf86f816ae996d17681976ef2986a84ac14cdd',
  },
  {
    id: 'r3', name: 'Run 3', start: '12:47:19', end: '13:52:23', secs: 3_905, accepted: 3_250_638, fees: 100_606_064, fanouts: 220, lanes: 15_430,
    bytes: 971_758_978, peak1s: 2_604, peakMin: 1_599, p50: 1_022, p95: 2_517, sampled: 32_634, seen: 32_620, bots: 20, label: 'bot names',
    stop: 'Safety stop: broadcast errors passed 5% of the last 5,000 sends.', firstFan: 'f1e439961c245ef31febfde4d85c5772f3b4f5bf5e0a7130863ba0c1f4affbad',
  },
  {
    id: 'r4', name: 'Run 4', start: '13:53:15', end: '14:02:25', secs: 552, accepted: 527_651, fees: 18_732_118, fanouts: 48, lanes: 13_367,
    bytes: 178_179_845, peak1s: 1_967, peakMin: 1_417, p50: 882, p95: 2_383, sampled: 5_316, seen: 5_289, bots: 20, label: 'Halloween flags',
    stop: 'Safety stop: broadcast errors passed 5% of the last 5,000 sends.', firstFan: '0efe84a5166d8827bc28817d5891e38144c0e090eae523687a066d71e9ff3c25',
  },
  {
    id: 'r5', name: 'Run 5', start: '14:02:53', end: '14:17:38', secs: 886, accepted: 449_896, fees: 18_597_275, fanouts: 55, lanes: 11_519,
    bytes: 175_333_937, peak1s: 2_030, peakMin: 1_323, p50: 819, p95: 2_136, sampled: 4_514, seen: 2_521, bots: 20, label: 'Halloween flags',
    stop: 'Safety stop: broadcast errors passed 5% of the last 5,000 sends.', firstFan: 'c371602489dfe1c2cddefb10e673c9640f4e74cb0eeed2ee6ec165eb9bce519a',
  },
  {
    id: 'r6', name: 'Run 6', start: '14:18:06', end: '15:43:09', secs: 5_103, accepted: 4_340_103, fees: 175_044_793, fanouts: 413, lanes: 11_519,
    bytes: 1_692_989_963, peak1s: 2_057, peakMin: 1_277, p50: 1_004, p95: 2_271, sampled: 43_469, seen: 43_435, bots: 20, label: 'Halloween flags',
    stop: 'The biggest run. It wrote no summary; these figures are its last log line.', firstFan: '4f8e10bf3f36562d2a380392a522190a151d224ff9a5afb406fe56ec2e4dcd58',
  },
  {
    id: 'r7', name: 'Run 7', start: '16:14:25', end: '18:25:45', secs: 7_883, accepted: 587_469, fees: 29_458_789, fanouts: 212, lanes: 11_519,
    bytes: 228_559_024, peak1s: 1_307, peakMin: 750, p50: 328, p95: 945, sampled: 5_810, seen: 5_149, bots: 20, label: 'Halloween flags',
    stop: 'Finished at its 1 BSV budget (the fees set aside for the shots it had planned). Not one broadcast error.',
    firstFan: 'bc9561ce24d222d82928a830fabd6b836efd3d5fc26769be1021fd0c093bdcd5',
  },
];

const sum = (k: keyof Run) => RUNS.reduce((a, r) => a + (r[k] as number), 0);
export const TOTALS = {
  accepted: sum('accepted'), // 9,183,007
  fees: sum('fees'), // 345,366,703 sats
  fanouts: sum('fanouts'), // 990
  bytes: sum('bytes'),
  sampled: sum('sampled'),
  seen: sum('seen'),
  peak1s: Math.max(...RUNS.map((r) => r.peak1s)),
  peakMin: Math.max(...RUNS.map((r) => r.peakMin)),
};
/** The BSV price the runner used for its USD projections that day. */
export const USD_PER_BSV = 17.19;

/** Blocks that carried the runs (31 Oct, 12:40 to 19:07 UTC). Counts are every transaction in the block: the whole
 * network was stress testing that day, so they include other teams' traffic, not just ours. */
export const BLOCKS: { h: number; t: number; txs: number; bytes: number; miner: string }[] = [
  { h: 973462, t: 1793450451, txs: 136071, bytes: 58598738, miner: 'TAAL' },
  { h: 973463, t: 1793451023, txs: 27, bytes: 9958, miner: 'Kryptex' },
  { h: 973464, t: 1793451352, txs: 279038, bytes: 99073749, miner: 'GorillaPool' },
  { h: 973465, t: 1793454981, txs: 3184172, bytes: 910563606, miner: 'SA100' },
  { h: 973466, t: 1793455293, txs: 257465, bytes: 69823808, miner: 'CUVVE' },
  { h: 973467, t: 1793455320, txs: 13721, bytes: 3361291, miner: 'TAAL' },
  { h: 973468, t: 1793455545, txs: 112751, bytes: 35720481, miner: 'SA100' },
  { h: 973469, t: 1793458012, txs: 1440309, bytes: 499999257, miner: 'GorillaPool' },
  { h: 973470, t: 1793458102, txs: 372078, bytes: 130716148, miner: 'CUVVE' },
  { h: 973471, t: 1793458694, txs: 628866, bytes: 228186200, miner: 'qdlnk' },
  { h: 973472, t: 1793459371, txs: 930983, bytes: 316455163, miner: 'CUVVE' },
  { h: 973473, t: 1793461602, txs: 2319048, bytes: 826408705, miner: 'CUVVE' },
  { h: 973474, t: 1793461775, txs: 101332, bytes: 27566451, miner: 'KardanPool' },
  { h: 973475, t: 1793462407, txs: 557146, bytes: 282452758, miner: 'CUVVE' },
  { h: 973476, t: 1793463479, txs: 898384, bytes: 202343278, miner: 'KardanPool' },
  { h: 973477, t: 1793463809, txs: 356035, bytes: 121388679, miner: 'qdlnk' },
  { h: 973478, t: 1793465394, txs: 84, bytes: 25023, miner: 'Kryptex' },
  { h: 973479, t: 1793466697, txs: 4014228, bytes: 897891094, miner: 'CUVVE' },
  { h: 973480, t: 1793467816, txs: 9569, bytes: 2333067, miner: 'Kryptex' },
  { h: 973481, t: 1793467877, txs: 916160, bytes: 193593089, miner: 'SA100' },
  { h: 973482, t: 1793467905, txs: 24182, bytes: 5479083, miner: 'qdlnk' },
  { h: 973483, t: 1793469867, txs: 318, bytes: 84173, miner: 'Kryptex' },
  { h: 973484, t: 1793470592, txs: 1052750, bytes: 251035335, miner: 'GorillaPool' },
  { h: 973485, t: 1793472288, txs: 1, bytes: 251, miner: 'Mining-Dutch' },
  { h: 973486, t: 1793472666, txs: 51, bytes: 18417, miner: 'Kryptex' },
  { h: 973487, t: 1793472970, txs: 5, bytes: 3199, miner: 'Kryptex' },
  { h: 973488, t: 1793473642, txs: 371164, bytes: 128931562, miner: 'TAAL' },
];

/** Real shots, decoded from the chain. Push 4 is the shot number in that bot's run, push 6 the flag. */
export const SHOTS: { bot: string; txid: string; block: number; time: string; bytes: number; n: string; flag: string }[] = [
  { bot: 'terrornode-bot03', txid: '2bf3e7cd25c7a9ed7e981915d7d2cbd3aab34bfc930559578aa64c89a7d027d1', block: 973465, time: '13:56', bytes: 260, n: '148489', flag: 'terrornode-bot03' },
  { bot: 'terrornode-bot07', txid: 'da20c10b3bc145c6e2a4e61b66d847a684702003a1af20f717c3454e70d8b221', block: 973471, time: '14:58', bytes: 367, n: '85527', flag: '😈👹👺💀☠️🔥🎃👻 PLAY TERRORNODE · tokenblaster.lol/arcade/terrornode 👹🧟🕷️🦇😈💀👻🎃' },
  { bot: 'terrornode-bot14', txid: 'd5e88e1439f998c378abfbe393d24f69a13359265a36b9d3754c9647c567dbd8', block: 973477, time: '16:23', bytes: 340, n: '210185', flag: '🎃👻💀😈🦇🕷️🧟👹 bWalletX · bwalletx.com 👹🧟🕷️🦇😈💀👻🎃' },
];

/** The flags every bot rotated through, one per shot, from run 4 on (blaster/terror/plan.ts FLAGS). */
export const FLAGS = [
  'terrornode.com',
  'PLAY tokenblaster.lol/arcade/terrornode',
  'bmusicx.com/listen/terrornode',
  'bchatx.com/t/terrornode',
  '$TERRORNODE · badvertisingx.com/campaign/terrornode',
  'FREE DR KWEG FROM THE EVIL EROBOTZ',
  'PLAY TERRORNODE',
  'Welcome to TERRORNODE',
  'STORM nSLAVE CORPORATION',
  'bWalletX · bwalletx.com',
  'bChatX · bchatx.com',
  'ARCADE · tokenblaster.lol/arcade',
  'NINJA PUNK GIRLS · ninjapunkgirls.com',
  'KWEGWONG · kwegwong.com',
  'b0ase.com',
  'bAdvertisingX · badvertisingx.com',
];

/** Clean-up on 1 Nov: stranded lanes consolidated (pnpm terror:sweep, #216), then the leftover sent home in one tx. */
export const SWEEP = { txs: [320, 1_480], leftoverBsv: 0.69793933, leftoverTx: '6efedf8c8fc08dc0dda0420b2274873f14df0e10043d3f500b54e301532a1010', block: 973582, inputs: 1_801 };
