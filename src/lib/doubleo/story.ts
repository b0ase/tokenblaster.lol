/**
 * Double-O Satoshi: the campaign, as dialogue. Every line in the game lives here.
 *
 * The arc: a syndicate called S.U.S.P.E.N.D. (the Syndicate of Unbacked Securities, Paused Exits
 * and Never-ending Delays) is freezing everyone's coins. Its faceless chairman, NUMBER ONE, sends
 * a different cartoon villain to stop Kweg in each mission; M briefs, Q kits him out, and the trail
 * leads from a fake-block bunker through the casino tower, the hash farm and the vault to the
 * syndicate's yacht. Parody characters only: no real names, photos, likenesses or logos.
 */
import { BRIAN, BRIAN_CO, CZ, CZ_EXCHANGE, MICHAEL, MINER, SAM, SAM_CO } from './names';

export type Speaker = 'm' | 'q' | 'one' | 'kweg' | 'cz' | 'brian' | 'michael' | 'jihan' | 'sam';

export const SPEAKERS: Record<Speaker, { name: string; role: string; color: string }> = {
  m: { name: 'M', role: 'Head of Section', color: '#cfe8ff' },
  q: { name: 'Q', role: 'Quartermaster', color: '#60ff90' },
  one: { name: 'NUMBER ONE', role: 'Chairman, S.U.S.P.E.N.D.', color: '#ff6060' },
  kweg: { name: 'KWEG', role: 'Special Agent', color: '#ffd24d' },
  cz: { name: CZ, role: `${CZ_EXCHANGE} "exchange"`, color: '#7ad8ff' },
  brian: { name: BRIAN, role: `CEO, ${BRIAN_CO}`, color: '#e8e8ff' },
  michael: { name: MICHAEL, role: 'Professional Hodler', color: '#ff4050' },
  jihan: { name: MINER, role: 'Hash Farm Foreman', color: '#9effb8' },
  sam: { name: SAM, role: `Founder, ${SAM_CO}`, color: '#40e0ff' },
};

export type Line = { who: Speaker; text: string };

/** Radio events the game raises while you play. */
export type RadioEvent = 'start' | 'objective' | 'intel' | 'allIntel' | 'lowHealth' | 'bossHalf' | 'bossDown' | 'setPiece';

export type Chapter = {
  /** Before the mission: M's brief, Q's kit note, then the villain's taunt. */
  brief: Line[];
  /** Radio chatter during play. Arrays pick a line at random; `objective` follows the objective index. */
  radio: Partial<Record<Exclude<RadioEvent, 'objective'>, Line[]>> & { objective?: Line[] };
  /** The set-piece moment (the locked doors swing open for the boss), shouted big on screen. */
  setPiece?: string;
  /** After the mission. */
  debrief: Line[];
};

export const STORY: Record<string, Chapter> = {
  facility: {
    brief: [
      { who: 'm', text: "Good evening, Kweg. Coins are vanishing all over the world. Not stolen: 'paused'. Someone is freezing withdrawals on an industrial scale." },
      { who: 'm', text: 'We traced it to a bunker under the moors. They are mining FAKE blocks down there and selling them as real. Plant a real node in their mainframe and the whole lie collapses.' },
      { who: 'q', text: "Your gadget gun fires whatever tokens you load into it. Do try not to spend them all on the wallpaper, 007... sorry, Agent Kweg." },
      { who: 'one', text: "Ah, Mister Kweg. I have been expecting you. My guard bots have been expecting you too. They are less polite." },
    ],
    radio: {
      start: [{ who: 'one', text: 'Welcome to S.U.S.P.E.N.D. Your withdrawal request has been received. Estimated wait: forever.' }],
      objective: [
        { who: 'm', text: 'Server room secured. Now the mainframe, Kweg. Quietly, if you know the meaning of the word.' },
        { who: 'one', text: 'You planted a REAL node?! Do you know how much it costs to pretend? Guards!' },
      ],
      intel: [
        { who: 'm', text: 'A S.U.S.P.E.N.D. memo. "Phase two: the casino." Keep looking.' },
        { who: 'q', text: 'Paperwork! Marvellous. Bring it back unshot, please.' },
      ],
      allIntel: [{ who: 'm', text: 'Every file in the bunker. The board will be furious. Splendid.' }],
      lowHealth: [
        { who: 'q', text: 'Kweg, your vitals are doing something unflattering. Find a medkit.' },
        { who: 'one', text: 'Your health has been paused for maintenance, Mister Kweg. Estimated resume: never.' },
      ],
    },
    debrief: [
      { who: 'm', text: 'The fake blocks are offline. But the memo you found mentions a casino that calls itself an exchange. Pack a dinner jacket.' },
      { who: 'one', text: 'One bunker. I have many bunkers, Mister Kweg. Seizey will entertain you next.' },
    ],
  },
  tower: {
    brief: [
      { who: 'm', text: `${CZ_EXCHANGE} has paused withdrawals "for maintenance". The maintenance is in its four-hundredth day. ${CZ} runs the floor.` },
      { who: 'm', text: 'Find the withdrawal office, unfreeze the desks, and give our customers their coins back. Then deal with him.' },
      { who: 'q', text: "His suit has a giant WITHDRAW button on the front. Shoot it. I've always wanted to say that." },
      { who: 'cz', text: 'Funds are SAFU, Mister Kweg. Very safu. So safu that nobody can touch them. Including the owners.' },
    ],
    radio: {
      start: [{ who: 'cz', text: 'Welcome to the casino. Sorry, the EXCHANGE. Please enjoy our slot machines while your withdrawal is processed.' }],
      objective: [
        { who: 'cz', text: 'That office is staff only! Staff! Only me!' },
        { who: 'm', text: 'Desks unfrozen. Coins are flowing back to their owners. Now, Kweg: the man in the button suit.' },
        { who: 'm', text: 'Elevator is at the far end. Get out before the house wins.' },
      ],
      bossHalf: [
        { who: 'cz', text: 'SECURITY! Pause this agent! Pause him for maintenance!' },
        { who: 'cz', text: 'This is FUD! Four. U. D. Funds are SAFU!' },
      ],
      bossDown: [{ who: 'cz', text: 'Funds are... sa... fu...' }],
      intel: [{ who: 'm', text: 'Seizey kept a ledger. Half the "reserves" are an IOU from a hash farm in the mountains.' }],
      allIntel: [{ who: 'one', text: 'You read my mail, Mister Kweg. That was not on the terms of service.' }],
      lowHealth: [
        { who: 'cz', text: 'Your health has been paused, Mister Kweg. Please hold.' },
        { who: 'cz', text: 'We have detected unusual bleeding. Your account is under review.' },
      ],
    },
    setPiece: 'THE HIGH-ROLLER FLOOR IS OPEN',
    debrief: [
      { who: 'm', text: `${CZ_EXCHANGE} is honouring withdrawals for the first time in a year. The ledger points to a vault under the city, run by ${BRIAN}.` },
      { who: 'one', text: 'Seizey always did talk too much. The vault, then. Brian will ask for your ID.' },
    ],
  },
  vault: {
    brief: [
      { who: 'm', text: `${BRIAN} of ${BRIAN_CO} guards a vault of IOUs he calls "custody". Next to him, ${MICHAEL} sits on a pile he swears he will never spend.` },
      { who: 'm', text: 'Crack the vault. Not your keys, not their coins. Then get out with the keys.' },
      { who: 'q', text: 'The vault door is rather thick. Finish the job inside and it should open for you. I put a little something on it.' },
      { who: 'brian', text: 'Before we proceed, Mister Kweg, please upload a selfie holding today\'s newspaper and your mother\'s maiden name.' },
      { who: 'michael', text: "I'm not selling. Not to you, not to anyone. I'll just buy more!" },
    ],
    radio: {
      start: [{ who: 'brian', text: 'Your account is under review. Please do not move. Moving voids your account.' }],
      objective: [
        { who: 'brian', text: 'Ticket number four-eight-two-one-three received. A specialist will shoot you within 5 to 7 business days.' },
        { who: 'm', text: 'The keys are yours, Kweg. Now get out of that hole.' },
      ],
      bossHalf: [
        { who: 'michael', text: "I'll just buy more armour! I'll just buy MORE!" },
        { who: 'brian', text: 'Please verify your identity again. And again.' },
      ],
      bossDown: [{ who: 'brian', text: 'Your complaint has been... closed.' }],
      intel: [{ who: 'm', text: 'Statements from the vault. The IOUs are backed by... hashpower futures. From the farm.' }],
      allIntel: [{ who: 'q', text: "That's the whole audit, Kweg. More than their auditors ever saw." }],
      lowHealth: [
        { who: 'michael', text: 'You look weak, Kweg. Weak hands. Very weak hands.' },
        { who: 'brian', text: 'Please verify you are still alive by uploading a selfie.' },
      ],
    },
    setPiece: 'VAULT DOOR OPENING',
    debrief: [
      { who: 'm', text: `The vault is empty, which is to say it was always empty. The money trail runs up the mountain to a hash farm run by ${MINER}.` },
      { who: 'one', text: 'You keep breaking my things, Mister Kweg. The farm is where I make the power to break you back.' },
    ],
  },
  farm: {
    brief: [
      { who: 'm', text: `${MINER}'s hash farm is mining nothing but empty blocks, on purpose, to slow the chain to a crawl so S.U.S.P.E.N.D. can keep pausing things.` },
      { who: 'm', text: 'Get to the cooling plant, then flip the whole farm to big, full blocks and let the network breathe.' },
      { who: 'q', text: 'It is very loud in there and very hot. The fans are on our side. The hazmat chaps are not.' },
      { who: 'jihan', text: 'Small blocks, small blocks! Big blocks are dangerous, Mister Kweg. Someone might use them.' },
    ],
    radio: {
      start: [{ who: 'jihan', text: 'Welcome to the farm. Everything here is empty. The blocks, the promises, my heart.' }],
      objective: [
        { who: 'jihan', text: 'Not the cooling room! The machines need cooling! The machines need EMPTINESS!' },
        { who: 'm', text: 'Full blocks, Kweg. Look at that throughput. Now get to the yard: the syndicate has a boat waiting.' },
        { who: 'm', text: 'Out of the exit. Number One is running for his yacht.' },
      ],
      intel: [{ who: 'm', text: 'Shipping manifests. Everything goes out on a yacht called the Margin Call.' }],
      allIntel: [{ who: 'one', text: 'The manifests too? Very well. Come to the yacht, Mister Kweg. Dress code: insolvent.' }],
      lowHealth: [{ who: 'jihan', text: 'You are running hot, Mister Kweg. Like an old miner. Time to switch you off.' }],
    },
    debrief: [
      { who: 'm', text: 'The farm is mining full blocks. The chain is fast again, so S.U.S.P.E.N.D. has nowhere to hide its pauses.' },
      { who: 'one', text: `Enough. Come to the yacht. ${SAM} is throwing a party, and you are the entertainment.` },
    ],
  },
  yacht: {
    brief: [
      { who: 'm', text: `The yacht Margin Call. ${SAM} of ${SAM_CO} is hosting the syndicate's last party, and the guests' coins are the canapés.` },
      { who: 'm', text: 'Get below deck, copy the backdoor ledger, then settle the bill on the main deck. This ends tonight, Kweg.' },
      { who: 'q', text: 'Everything I have, Kweg. Every gun in the store, if you own it. Do bring the boat back; it is evidence.' },
      { who: 'sam', text: "Hey, man. Look, it's complicated. Some of the money was in a different, uh, column? It was a rounding error." },
      { who: 'one', text: 'Stop him, Sam. Or I will pause you too.' },
    ],
    radio: {
      start: [{ who: 'sam', text: 'Welcome aboard! Free drinks! The drinks are customer funds, but, like, effectively free.' }],
      objective: [
        { who: 'sam', text: "Below deck is off limits! I mean, it's open to everyone. Except you. Different column." },
        { who: 'm', text: "Ledger copied. Their backdoor is on the record now. Now the deck, Kweg: he's out there." },
        { who: 'm', text: 'Jump to the speedboat. Bring the evidence home.' },
      ],
      bossHalf: [{ who: 'sam', text: 'Okay, okay! What if we just... paused this fight? Like, indefinitely?' }],
      bossDown: [
        { who: 'sam', text: 'I... I don\'t recall... any of this...' },
        { who: 'one', text: 'You have cost me everything, Mister Kweg. We will meet again. Your withdrawal is... approved.' },
      ],
      intel: [{ who: 'q', text: 'The real books! Columns and columns. Most of them say "oops".' }],
      allIntel: [{ who: 'm', text: 'Every page of the real ledger. The regulators will need a bigger boat.' }],
      lowHealth: [{ who: 'sam', text: 'Your health is, like, a rounding error now, man.' }],
    },
    setPiece: 'THE DECK IS OPEN: FINISH IT',
    debrief: [
      { who: 'm', text: 'S.U.S.P.E.N.D. is finished. Withdrawals are flowing everywhere. Number One got away in a lifeboat, but his keys did not.' },
      { who: 'kweg', text: 'Not his keys. Not his coins.' },
      { who: 'm', text: 'Quite. Take a holiday, Kweg. Somewhere withdrawals are never paused.' },
    ],
  },
};

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

/** The radio line for an event in a mission (the `objective` event is indexed by the objective just done). */
export function radioLine(level: string, ev: RadioEvent, objective = 0): Line | null {
  const c = STORY[level];
  if (!c) return null;
  if (ev === 'objective') return c.radio.objective?.[objective] ?? null;
  if (ev === 'setPiece') return c.setPiece ? { who: 'q', text: c.setPiece } : null;
  const a = c.radio[ev];
  return a?.length ? pick(a) : null;
}
