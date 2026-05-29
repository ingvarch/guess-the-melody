export function initialState() {
  return {
    phase: 'idle',
    teams: [],
    selectedGenre: null,
    currentTrack: null,
    revealedTrack: null,
    playedTrackIds: [],
    spinSeed: 0,
    audioStartTimestamp: null,
    audioPausedTimestamp: null,
    genrePicked: false,
  };
}

export function addTeam(state, { id, name }) {
  return { ...state, teams: [...state.teams, { id, name, score: 0 }] };
}

export function renameTeam(state, { id, name }) {
  return {
    ...state,
    teams: state.teams.map((t) => (t.id === id ? { ...t, name } : t)),
  };
}

export function removeTeam(state, { id }) {
  return { ...state, teams: state.teams.filter((t) => t.id !== id) };
}

export function awardPoints(state, { teamId, points }) {
  if (points !== 1 && points !== 2) {
    throw new Error(`invalid points: ${points}`);
  }
  const idx = state.teams.findIndex((t) => t.id === teamId);
  if (idx < 0) throw new Error(`unknown team: ${teamId}`);
  const teams = state.teams.slice();
  teams[idx] = { ...teams[idx], score: teams[idx].score + points };
  return { ...state, teams };
}
