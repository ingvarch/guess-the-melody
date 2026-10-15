import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  LEVER_SWING_DEG,
  LEVER_CATCH,
  TAP_SLOP_PX,
  leverPull,
  leverRelease,
  pullLever,
  attachLever,
} from '../../public/static/js/lever.js';

const ROD = 100;
const SWING = (LEVER_SWING_DEG * Math.PI) / 180;
// How far down the knob sits when the lever is pulled by `p`.
const knobDrop = (p) => ROD * (1 - Math.cos(p * SWING));

function makeLever() {
  const win = new Window();
  const lever = win.document.createElement('button');
  win.document.body.append(lever);
  const pulls = [];
  attachLever(lever, { onPull: () => pulls.push(1), rodLength: () => ROD });
  const pointer = (type, clientY) =>
    lever.dispatchEvent(new win.PointerEvent(type, { clientY, pointerId: 1, bubbles: true }));
  const click = (detail) => lever.dispatchEvent(new win.MouseEvent('click', { detail, bubbles: true }));
  return { win, lever, pulls, pointer, click };
}

test('leverPull: the knob follows the finger along its arc', () => {
  assert.equal(leverPull(0, ROD), 0);
  for (const p of [0.1, 0.25, 0.5, 0.8, 1]) {
    assert.ok(Math.abs(leverPull(knobDrop(p), ROD) - p) < 1e-9, `pull ${p}`);
  }
});

test('leverPull: stays between rest and fully down', () => {
  assert.equal(leverPull(-40, ROD), 0);
  assert.equal(leverPull(knobDrop(1) + 500, ROD), 1);
});

test('leverRelease: a still finger is a tap, a long pull spins, a short one springs back', () => {
  assert.equal(leverRelease(TAP_SLOP_PX - 1, ROD), 'tap');
  assert.equal(leverRelease(knobDrop(LEVER_CATCH) + 1, ROD), 'pull');
  assert.equal(leverRelease(knobDrop(LEVER_CATCH) - 5, ROD), 'cancel');
  assert.equal(leverRelease(-60, ROD), 'cancel', 'pushing it up does not spin');
});

test('pullLever: plays once, from where the knob is, until the animation ends', () => {
  const { win, lever } = makeLever();
  pullLever(lever, 0.7);
  assert.ok(lever.classList.contains('lever--pulling'));
  assert.equal(lever.style.getPropertyValue('--pull-from'), '0.7');

  pullLever(lever, 0);
  assert.equal(lever.style.getPropertyValue('--pull-from'), '0.7', 'a pull under way is left alone');

  lever.dispatchEvent(new win.AnimationEvent('animationend', { animationName: 'lever-pull' }));
  assert.ok(!lever.classList.contains('lever--pulling'));
});

test('pullLever: a cancelled animation (lever hidden mid-pull) frees the lever too', () => {
  const { win, lever } = makeLever();
  pullLever(lever);
  lever.dispatchEvent(new win.AnimationEvent('animationcancel', { animationName: 'lever-pull' }));
  assert.ok(!lever.classList.contains('lever--pulling'));
});

test('attachLever: a tap pulls the lever and spins', () => {
  const { lever, pulls, pointer, click } = makeLever();
  pointer('pointerdown', 200);
  pointer('pointerup', 202);
  click(1);
  assert.equal(pulls.length, 1, 'the click that follows a tap does not spin twice');
  assert.ok(lever.classList.contains('lever--pulling'));
});

test('attachLever: dragging the knob moves the lever with the finger', () => {
  const { lever, pointer } = makeLever();
  pointer('pointerdown', 200);
  pointer('pointermove', 200 + knobDrop(0.3));
  assert.ok(lever.classList.contains('lever--dragging'));
  assert.ok(Math.abs(Number(lever.style.getPropertyValue('--pull')) - 0.3) < 1e-3);
});

test('attachLever: a drag past the catch spins and the lever carries on from the finger', () => {
  const { lever, pulls, pointer, click } = makeLever();
  pointer('pointerdown', 200);
  pointer('pointermove', 200 + knobDrop(0.8));
  pointer('pointerup', 200 + knobDrop(0.8));
  click(1);
  assert.equal(pulls.length, 1);
  assert.ok(!lever.classList.contains('lever--dragging'));
  assert.equal(lever.style.getPropertyValue('--pull'), '');
  assert.ok(Math.abs(Number(lever.style.getPropertyValue('--pull-from')) - 0.8) < 1e-3);
});

test('attachLever: letting go before the catch springs back without a spin', () => {
  const { lever, pulls, pointer, click } = makeLever();
  pointer('pointerdown', 200);
  pointer('pointermove', 200 + knobDrop(0.3));
  pointer('pointerup', 200 + knobDrop(0.3));
  click(1);
  assert.equal(pulls.length, 0);
  assert.ok(!lever.classList.contains('lever--dragging'));
  assert.ok(!lever.classList.contains('lever--pulling'));
  assert.equal(lever.style.getPropertyValue('--pull'), '');
});

test('attachLever: a cancelled drag springs back without a spin', () => {
  const { lever, pulls, pointer } = makeLever();
  pointer('pointerdown', 200);
  pointer('pointermove', 200 + knobDrop(0.9));
  pointer('pointercancel', 200 + knobDrop(0.9));
  assert.equal(pulls.length, 0);
  assert.equal(lever.style.getPropertyValue('--pull'), '');
});

test('attachLever: Enter or Space on the focused lever spins', () => {
  const { pulls, click } = makeLever();
  click(0);
  assert.equal(pulls.length, 1);
});

test('attachLever: a disabled lever does nothing', () => {
  const { lever, pulls, pointer, click } = makeLever();
  lever.disabled = true;
  pointer('pointerdown', 200);
  pointer('pointermove', 200 + knobDrop(0.9));
  pointer('pointerup', 200 + knobDrop(0.9));
  click(0);
  assert.equal(pulls.length, 0);
  assert.equal(lever.style.getPropertyValue('--pull'), '');
});

test('pullLever: announces each pull once, so the clunk sounds with the animation', () => {
  const { win, lever } = makeLever();
  let pulls = 0;
  lever.addEventListener('leverpull', () => { pulls += 1; });
  pullLever(lever);
  pullLever(lever);
  assert.equal(pulls, 1, 'a pull under way is not announced again');
  lever.dispatchEvent(new win.AnimationEvent('animationend', { animationName: 'lever-pull' }));
  pullLever(lever);
  assert.equal(pulls, 2);
});
