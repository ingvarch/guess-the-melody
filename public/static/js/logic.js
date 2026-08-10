import { addTeam, renameTeam, removeTeam, awardPoints, initialState } from './state.js';

const VALID_TRANSITIONS = {
  spin:    new Set(['idle']),
  play:    new Set(['spinning']),
  replay:  new Set(['playing']),
  pause:   new Set(['playing']),
  resume:  new Set(['playing']),
  seek:    new Set(['playing']),
  reveal:  new Set(['playing']),
  next:    new Set(['playing', 'revealed']),
  award:   new Set(['playing', 'revealed']),
};

function expectPhase(action, state) {
  const allowed = VALID_TRANSITIONS[action];
  if (!allowed || !allowed.has(state.phase)) {
    throw new Error(`invalid transition: ${action} from ${state.phase}`);
  }
}

export function applyAction(state, payload) {
  switch (payload.action) {
    case 'team.add':    return addTeam(state, { id: payload.id, name: payload.name });
    case 'team.rename': return renameTeam(state, { id: payload.id, name: payload.name });
    case 'team.remove': return removeTeam(state, { id: payload.id });

    case 'spin': {
      expectPhase('spin', state);
      return {
        ...state,
        phase: 'spinning',
        selectedGenre: payload.selectedGenre,
        genrePicked: payload.genrePicked ?? false,
        currentTrack: { id: payload.trackId, genre: payload.selectedGenre },
        revealedTrack: null,
        spinSeed: payload.spinSeed,
        audioStartTimestamp: null,
        audioPausedTimestamp: null,
      };
    }

    case 'play': {
      expectPhase('play', state);
      return { ...state, phase: 'playing', audioStartTimestamp: payload.now, audioPausedTimestamp: null };
    }

    case 'replay': {
      expectPhase('replay', state);
      return { ...state, audioStartTimestamp: payload.now, audioPausedTimestamp: null };
    }

    case 'pause': {
      expectPhase('pause', state);
      // Idempotent: a second pause keeps the original instant.
      if (state.audioPausedTimestamp != null) return state;
      return { ...state, audioPausedTimestamp: payload.now };
    }

    case 'resume': {
      expectPhase('resume', state);
      if (state.audioPausedTimestamp == null) return state;
      // Shift the start forward by however long we were paused so the clip
      // continues from where it stopped (keeps every viewer in sync).
      const pausedFor = payload.now - state.audioPausedTimestamp;
      return {
        ...state,
        audioStartTimestamp: state.audioStartTimestamp + pausedFor,
        audioPausedTimestamp: null,
      };
    }

    case 'seek': {
      expectPhase('seek', state);
      if (!Number.isFinite(payload.positionSec)) {
        throw new Error('seek: positionSec must be a finite number');
      }
      // Seeks both ways. A paused clip keeps its frozen clock as the anchor, so
      // repositioning while paused holds the pause at the new spot. Positions
      // past the clip's length simply read as "ended" via audioCurrentTime.
      const frozenNow = state.audioPausedTimestamp ?? payload.now;
      const target = Math.max(0, payload.positionSec);
      return { ...state, audioStartTimestamp: frozenNow - target * 1000 };
    }

    case 'reveal': {
      expectPhase('reveal', state);
      return { ...state, phase: 'revealed', revealedTrack: payload.track };
    }

    case 'next': {
      expectPhase('next', state);
      const played = state.currentTrack
        ? [...state.playedTrackIds, state.currentTrack.id]
        : state.playedTrackIds;
      return {
        ...state,
        phase: 'idle',
        selectedGenre: null,
        genrePicked: false,
        currentTrack: null,
        revealedTrack: null,
        spinSeed: 0,
        audioStartTimestamp: null,
        audioPausedTimestamp: null,
        playedTrackIds: played,
      };
    }

    case 'award': {
      expectPhase('award', state);
      return awardPoints(state, { teamId: payload.teamId, points: payload.points });
    }

    case 'endgame': {
      const fresh = initialState();
      return payload.resetScores
        ? { ...fresh, teams: state.teams.map((t) => ({ ...t, score: 0 })) }
        : { ...fresh, teams: state.teams };
    }

    default:
      throw new Error(`unknown action: ${payload.action}`);
  }
}
