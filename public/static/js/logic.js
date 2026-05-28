import { addTeam, renameTeam, removeTeam, awardPoints, initialState } from './state.js';

const VALID_TRANSITIONS = {
  spin:    new Set(['idle']),
  play:    new Set(['spinning']),
  replay:  new Set(['playing']),
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
        currentTrack: { id: payload.trackId, genre: payload.selectedGenre },
        revealedTrack: null,
        spinSeed: payload.spinSeed,
        audioStartTimestamp: null,
      };
    }

    case 'play': {
      expectPhase('play', state);
      return { ...state, phase: 'playing', audioStartTimestamp: payload.now };
    }

    case 'replay': {
      expectPhase('replay', state);
      return { ...state, audioStartTimestamp: payload.now };
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
        currentTrack: null,
        revealedTrack: null,
        spinSeed: 0,
        audioStartTimestamp: null,
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
