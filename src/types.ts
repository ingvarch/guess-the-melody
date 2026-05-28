// Shared types for the Worker. Bindings live on Env; room-state shapes
// are colocated so both the Worker entry and the DO see the same types.

import type { MelodyRoom } from './melody-room';

export interface Env {
  ASSETS: Fetcher;
  MELODY_ROOM: DurableObjectNamespace<MelodyRoom>;
  CATALOG: D1Database;
  AUDIO: R2Bucket;
  SESSION_RATE_LIMITER?: RateLimit;
  ADMIN_PASSWORD: string;
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
}

export type Phase = 'idle' | 'spinning' | 'playing' | 'revealed';

export interface Team {
  id: string;
  name: string;
  score: number;
}

export interface CurrentTrack {
  id: string;
  genre: string;
}

export interface RevealedTrack {
  artist: string;
  title: string;
  year: number;
  artworkUrl?: string;
}

export interface RoomState {
  phase: Phase;
  teams: Team[];
  selectedGenre: string | null;
  currentTrack: CurrentTrack | null;
  revealedTrack: RevealedTrack | null;
  playedTrackIds: string[];
  spinSeed: number;
  audioStartTimestamp: number | null;
}
