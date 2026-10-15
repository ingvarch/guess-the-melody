// Display bootstrap. Renders the cinematic display, mirrors host SSE, AND
// drives the gameplay control surface (spin/play/reveal/next/award/teams).
// Anonymous viewers see the same controls; their POSTs will 403 against the
// DO owner-cookie check. Acceptable for the MVP — the URL is unguessable.

import {
  render,
  renderClock,
  runSpin,
  renderPlaybackControls,
  showGenreChoice,
  shouldBeAudible,
  deckMode,
  needleAt,
  paintProgress,
  showActionError,
  clearActionError,
} from './display-ui.js';
import { connectStateStream } from './sse.js';
import { createSoundGate } from './sound-gate.js';
import {
  fetchGenres,
  fetchState,
  addTeam,
  removeTeam,
  renameTeam,
  spin,
  play,
  replay,
  pause,
  resume,
  seek,
  award,
  reveal,
  next,
} from './host-actions.js';
import { attachWaveform } from './waveform.js';
import { attachTurntable } from './turntable.js';
import { attachLever } from './lever.js';
import { createCuePlayer, playCue, createNeedleSounds, playNeedle, playLever, playSpin } from './jukebox-sound.js';
import { attachRingSeek } from './ring-seek.js';

const sessionId = document.querySelector('meta[name="session-id"]')?.content ?? '';
const TICK_MS = 250;

const DO_ERRORS = {
  'no tracks available': 'No tracks available (all genres are empty or archived)',
  'no current track': 'No current track',
  'track not found': 'Track not found',
};

function teamId() {
  return 't_' + Math.random().toString(36).slice(2, 10);
}

// Every failed host action is now visible on the page. A silent failure here
// is indistinguishable from a broken feature — it cost hours of debugging.
function reportActionError(err) {
  const raw = err instanceof Error ? err.message : String(err);
  const mapped = Object.entries(DO_ERRORS).find(([k]) => raw.includes(k))?.[1];
  showActionError(document, mapped ? new Error(mapped) : err);
}

function boot() {
  if (!sessionId) {
    document.body.textContent = 'no session id';
    return;
  }

  const view = { state: {}, genres: [], sessionId, picking: false };
  let prevPhase = null;

  // The analyser and its audio context live for the whole page: attached
  // once (createMediaElementSource throws on a second call) and early, so the
  // jukebox sounds have a context before the first clip. It draws only while
  // a clip plays.
  const waveformCtrl = attachWaveform({
    audioEl: document.getElementById('audio'),
    canvas: document.getElementById('waveform'),
  });

  // Jukebox sounds play through the analyser, so the ring shows them too. A
  // locked context is woken (that works once the page has had a tap).
  // playIfAwake returns null meanwhile, for players that retry every tick;
  // playWhenAwake plays a one-off sound as soon as the context wakes.
  function playIfAwake(play) {
    const ctx = waveformCtrl.context;
    if (!ctx) return null;
    if (ctx.state === 'running') return play(ctx, waveformCtrl.input);
    ctx.resume().catch(() => {});
    return null;
  }
  function playWhenAwake(play) {
    const ctx = waveformCtrl.context;
    if (!ctx) return null;
    if (ctx.state === 'running') return play(ctx, waveformCtrl.input);
    ctx.resume().then(() => play(ctx, waveformCtrl.input), () => {});
    return null;
  }

  // Owns starting audible playback: retried on every state frame and clock
  // tick, so a blocked autoplay recovers as soon as the page gets a gesture.
  const gate = createSoundGate({
    doc: document,
    audio: document.getElementById('audio'),
    getWaveform: () => waveformCtrl,
  });

  // The record turns from the Play press: the jukebox puts it on, then the
  // clip plays. A pause lifts the needle while the record keeps turning.
  const deck = attachTurntable(document.getElementById('turntable'), {
    reduceMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  });

  const cue = createCuePlayer({
    play: (inSec) => playIfAwake((ctx, out) => playCue(ctx, out, inSec)),
  });
  const needle = createNeedleSounds({
    play: (kind) => playWhenAwake((ctx, out) => playNeedle(ctx, out, kind)),
  });
  const spinSound = {
    spin: (ticksMs, landMs) => playWhenAwake((ctx, out) => playSpin(ctx, out, ticksMs, landMs)),
  };

  function syncSound() {
    gate.sync(shouldBeAudible(view.state));
    deck.set(deckMode(view.state));
    cue.sync(view.state, Date.now());
    needle.sync(needleAt(view.state));
  }

  // The clock tick can land up to TICK_MS after the music start; start it on time.
  let musicTimer = null;
  function armMusicStart() {
    clearTimeout(musicTimer);
    const wait = view.state.audioStartTimestamp - Date.now();
    if (view.state.phase === 'playing' && wait > 0) musicTimer = setTimeout(syncSound, wait);
  }

  function onState() {
    // The jukebox stays up until its drum stops; only then the Play screen shows.
    const spinStarted = prevPhase !== 'spinning' && view.state.phase === 'spinning';
    if (spinStarted) view.picking = true;
    render(document, view);

    if (spinStarted) {
      void runSpin(document, view.state, view.genres, { getPhase: () => view.state.phase, sound: spinSound })
        .finally(() => {
          view.picking = false;
          render(document, view);
        });
    }

    if (view.state.phase === 'playing') {
      void waveformCtrl.resume?.();
    } else if (prevPhase === 'playing') {
      // Leaving playback (reveal or skip): pause the render loop only. The
      // AudioContext stays open so the next round still produces sound.
      waveformCtrl.stop();
    }

    prevPhase = view.state.phase;
    syncSound();
    armMusicStart();
  }

  async function init() {
    try {
      const [s, g] = await Promise.all([
        fetchState(fetch, sessionId),
        fetchGenres(fetch).catch(() => []),
      ]);
      view.state = s;
      view.genres = g;
      prevPhase = s.phase;
      onState();
    } catch (e) {
      document.body.insertAdjacentHTML('beforeend', `<p style="color:red">${e.message}</p>`);
    }
  }

  function connectSse() {
    connectStateStream({
      url: `/s/${sessionId}/api/events`,
      onState: (s) => {
        view.state = s;
        onState();
      },
    });
  }

  function wireEvents() {
    const genreSelect = document.getElementById('genre-select');
    genreSelect?.addEventListener('change', () => showGenreChoice(document, view.genres));

    const lever = document.getElementById('spin-btn');
    // The clunk sounds with the pull itself, for a tap here or a spin from
    // the console; on a tap it also wakes the audio inside the gesture.
    lever?.addEventListener('leverpull', () => playWhenAwake((ctx, out) => playLever(ctx, out)));
    if (lever) {
      attachLever(lever, {
        onPull: () => {
          // Empty value = "Surprise me (Auto)" → no genre; the server picks at random.
          const genre = genreSelect?.value || null;
          spin(fetch, sessionId, genre).then(() => clearActionError(document), reportActionError);
        },
      });
    }

    const playBtn = document.getElementById('play-btn');
    playBtn?.addEventListener('click', () => {
      // Context-aware: start the clip while spinning, otherwise toggle
      // pause/resume during playback. The DO stamps the authoritative `now`.
      const st = view.state;
      if (st.phase === 'spinning') {
        play(fetch, sessionId).then(() => clearActionError(document), reportActionError);
      } else if (st.phase === 'playing') {
        const act = st.audioPausedTimestamp != null ? resume : pause;
        act(fetch, sessionId).then(() => clearActionError(document), reportActionError);
      }
    });

    const replayBtn = document.getElementById('replay-btn');
    replayBtn?.addEventListener('click', () => {
      // Re-stamp the start timestamp on the DO so every viewer restarts in sync.
      replay(fetch, sessionId).then(() => clearActionError(document), reportActionError);
    });

    // Seeking: drag around the ring that circles the record, or use the
    // hidden range input from the keyboard. While seeking, the position
    // belongs to the user (data-scrubbing stops the clock tick from fighting
    // it); the POST goes out on release, and the DO restamps the start so
    // every viewer lands on the same spot.
    const scrubber = document.getElementById('scrubber');
    const endScrub = () => { if (scrubber) delete scrubber.dataset.scrubbing; };
    const scrubTo = (sec) => {
      scrubber.value = String(sec);
      scrubber.dataset.scrubbing = '1';
      paintProgress(document);
    };
    const commitSeek = () => {
      endScrub();
      seek(fetch, sessionId, Number(scrubber.value)).then(() => clearActionError(document), reportActionError);
    };
    scrubber?.addEventListener('input', () => scrubTo(scrubber.value));
    scrubber?.addEventListener('change', commitSeek);

    const ring = document.getElementById('progress-ring');
    if (ring && scrubber) {
      const toSec = (share) => share * Number(scrubber.max);
      attachRingSeek(ring, {
        enabled: () => !scrubber.disabled,
        onScrub: (share) => scrubTo(toSec(share)),
        onSeek: (share) => {
          scrubTo(toSec(share));
          commitSeek();
        },
        // Without this the clock would never move the ring again.
        onCancel: endScrub,
      });
    }

    const revealBtn = document.getElementById('reveal-btn');
    revealBtn?.addEventListener('click', () => {
      reveal(fetch, sessionId).then(() => clearActionError(document), reportActionError);
    });

    const nextBtn = document.getElementById('next-btn');
    nextBtn?.addEventListener('click', () => {
      next(fetch, sessionId).then(() => clearActionError(document), reportActionError);
    });

    // Exit: leave the game and return to the landing page. The session keeps
    // living server-side, so the URL still works if reopened.
    const endBtn = document.getElementById('endgame-btn');
    endBtn?.addEventListener('click', () => {
      if (!confirm('Leave the game?')) return;
      window.location.href = '/';
    });

    // Award buttons delegated from scoreboard footer.
    const scoreboard = document.getElementById('scoreboard-list');
    scoreboard?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action="award"]');
      if (!btn) return;
      const id = btn.dataset.teamId;
      const points = Number(btn.dataset.points);
      if (!id || !(points === 1 || points === 2)) return;
      award(fetch, sessionId, id, points).then(() => clearActionError(document), reportActionError);
    });

    // Teams panel toggle.
    const teamsPanel = document.getElementById('teams-panel');
    const teamsToggle = document.getElementById('teams-toggle-btn');
    const teamsClose = document.getElementById('teams-panel-close-btn');
    teamsToggle?.addEventListener('click', () => {
      if (teamsPanel?.hasAttribute('hidden')) teamsPanel.removeAttribute('hidden');
      else teamsPanel?.setAttribute('hidden', '');
    });
    teamsClose?.addEventListener('click', () => teamsPanel?.setAttribute('hidden', ''));

    // Add team form.
    const addForm = document.getElementById('add-team-form');
    addForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('add-team-input');
      const name = input?.value.trim();
      if (!name) return;
      addTeam(fetch, sessionId, teamId(), name)
        .then(() => { if (input) input.value = ''; })
        .then(() => clearActionError(document), reportActionError);
    });

    // Teams list rename/remove.
    const teamsList = document.getElementById('teams-list');
    teamsList?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.dataset.teamId;
      if (!id) return;
      if (btn.dataset.action === 'remove') {
        removeTeam(fetch, sessionId, id).then(() => clearActionError(document), reportActionError);
      } else if (btn.dataset.action === 'rename') {
        const current = view.state.teams?.find((t) => t.id === id)?.name ?? '';
        const proposed = prompt('New team name', current);
        if (proposed === null) return;
        const trimmed = proposed.trim();
        if (!trimmed) return;
        renameTeam(fetch, sessionId, id, trimmed).then(() => clearActionError(document), reportActionError);
      }
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void init();
  });

  void init();
  connectSse();
  wireEvents();
  setInterval(() => {
    renderClock(document, view.state);
    // Surface Reveal/Repeat the moment the 30s clip elapses, without a server msg.
    renderPlaybackControls(document, view.state, view.picking);
    syncSound();
  }, TICK_MS);
}

boot();
