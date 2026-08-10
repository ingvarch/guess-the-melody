// Sound gate: owns starting audible playback on the display. Shows the
// "tap for sound" overlay while the browser blocks sound (rejected play()
// or suspended AudioContext), unlocks from a real click.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createSoundGate } from '../../public/static/js/sound-gate.js';

function makeDoc() {
  const win = new Window();
  const doc = win.document;
  doc.body.innerHTML = `
    <div id="sound-gate" hidden><span id="sound-gate-message">Tap anywhere for sound</span></div>
    <audio id="audio"></audio>
  `;
  return doc;
}

function makeAudio(doc, { playResult = Promise.resolve(), paused = true } = {}) {
  const audio = doc.getElementById('audio');
  audio.play = () => playResult;
  audio.pause = () => {};
  Object.defineProperty(audio, 'paused', { get: () => paused, configurable: true });
  return audio;
}

const shown = (doc) => !doc.getElementById('sound-gate').hasAttribute('hidden');
const tick = () => new Promise((r) => setTimeout(r, 0));

test('blocked play() shows the overlay', async () => {
  const doc = makeDoc();
  const audio = makeAudio(doc, { playResult: Promise.reject(new Error('NotAllowedError')) });
  const gate = createSoundGate({ doc, audio });
  gate.sync(true);
  await tick();
  assert.ok(shown(doc));
});

test('successful play() with a running context hides the overlay', async () => {
  const doc = makeDoc();
  const audio = makeAudio(doc);
  const gate = createSoundGate({ doc, audio, getWaveform: () => ({ suspended: () => false }) });
  gate.sync(true);
  await tick();
  assert.ok(!shown(doc));
});

test('successful play() but suspended AudioContext still shows the overlay', async () => {
  const doc = makeDoc();
  const audio = makeAudio(doc);
  const gate = createSoundGate({ doc, audio, getWaveform: () => ({ suspended: () => true }) });
  gate.sync(true);
  await tick();
  assert.ok(shown(doc));
});

test('sync(false) hides the overlay and does not call play', async () => {
  const doc = makeDoc();
  let plays = 0;
  const audio = makeAudio(doc);
  audio.play = () => { plays += 1; return Promise.resolve(); };
  const gate = createSoundGate({ doc, audio });
  gate.sync(false);
  await tick();
  assert.ok(!shown(doc));
  assert.equal(plays, 0);
});

test('clicking the overlay resumes the context and retries play', async () => {
  const doc = makeDoc();
  let resumed = 0;
  let plays = 0;
  const audio = makeAudio(doc);
  audio.play = () => { plays += 1; return Promise.resolve(); };
  createSoundGate({
    doc,
    audio,
    getWaveform: () => ({ suspended: () => false, resume: () => { resumed += 1; return Promise.resolve(); } }),
  });
  doc.getElementById('sound-gate').dispatchEvent(new doc.defaultView.Event('click'));
  await tick();
  assert.equal(resumed, 1);
  assert.equal(plays, 1);
});

test('audio error event surfaces the overlay with a failure message', () => {
  const doc = makeDoc();
  const audio = makeAudio(doc);
  createSoundGate({ doc, audio });
  audio.dispatchEvent(new doc.defaultView.Event('error'));
  assert.ok(shown(doc));
  assert.match(doc.getElementById('sound-gate-message').textContent, /failed/i);
});
