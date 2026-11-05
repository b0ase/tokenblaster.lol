/**
 * Free play (owner, 5 Nov 2026): every coin-op game is free until payments are wired up properly. Players were paying
 * and then not finding a way to play. With FREE_PLAY on, the cabinet is a PLAY FREE button over the attract screen,
 * every game's PLAY starts an unpaid run (the demo path, without the 20 s limit), nothing is charged and no scores
 * are posted. bWalletX sign-in still works as normal; only payments are off.
 * Turn payments back on with NEXT_PUBLIC_TB_FREE_PLAY=0.
 */
export const FREE_PLAY = process.env.NEXT_PUBLIC_TB_FREE_PLAY !== '0';
