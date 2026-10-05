/**
 * Online play transport for NPG Card Battle: a broadcast room (two players, plus presence).
 * Each site supplies a factory (Supabase Realtime here); the game only sees this interface.
 */
export type NetStatus = 'connecting' | 'live' | 'off';
export type NetHandlers = {
  onMsg: (event: string, payload: unknown) => void;
  onPeers: (ids: string[]) => void;
  onStatus: (s: NetStatus) => void;
};
export type Net = { send: (event: string, payload: unknown) => void; close: () => void };
export type NetFactory = (topic: string, myId: string, h: NetHandlers) => Net;
