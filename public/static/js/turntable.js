// Turntable motion for the display: the platter spins up and down, and the
// tonearm lifts, swings and lowers the way a real deck cues a record.
// stepDeck is pure; attachTurntable drives it frame by frame and writes the
// result into CSS custom properties.

const DEG_PER_SEC = 200; // 33 1/3 rpm
const SPEED_TAU_SEC = 0.35;
export const LIFT_SEC = 0.25;
export const SWING_SEC = 0.9;

export const RESTING_DECK = Object.freeze({ speed: 0, angle: 0, arm: 0, lift: 0 });

function approach(value, target, maxStep) {
  return value < target ? Math.min(target, value + maxStep) : Math.max(target, value - maxStep);
}

// `arm`: 0 = on the rest, 1 = on the record. `lift`: 0 = lowered, 1 = raised.
export function stepDeck(deck, dt, on) {
  const target = on ? 1 : 0;
  let speed = deck.speed + (target - deck.speed) * (1 - Math.exp(-dt / SPEED_TAU_SEC));
  if (Math.abs(speed - target) < 0.005) speed = target;
  const angle = (deck.angle + speed * DEG_PER_SEC * dt) % 360;

  let { arm, lift } = deck;
  if (arm !== target) {
    if (lift < 1) lift = approach(lift, 1, dt / LIFT_SEC);
    else arm = approach(arm, target, dt / SWING_SEC);
  } else {
    lift = approach(lift, 0, dt / LIFT_SEC);
  }
  return { speed, angle, arm, lift };
}

function isSettled(deck, on) {
  return deck.speed === 0 && deck.lift === 0 && deck.arm === (on ? 1 : 0);
}

function smoothstep(x) {
  return x * x * (3 - 2 * x);
}

function css(n) {
  return String(Number(n.toFixed(4)));
}

export function deckStyle(deck) {
  const lift = smoothstep(deck.lift);
  return {
    '--disc-angle': `${css(deck.angle)}deg`,
    '--arm': css(smoothstep(deck.arm)),
    '--lift': css(lift),
    '--contact': css(deck.arm === 1 ? 1 - lift : 0),
  };
}

export function attachTurntable(el, { raf = (cb) => requestAnimationFrame(cb), reduceMotion = false } = {}) {
  let deck = RESTING_DECK;
  let on = false;
  let looping = false;
  let last = null;

  const paint = () => {
    for (const [k, v] of Object.entries(deckStyle(deck))) el.style.setProperty(k, v);
  };

  const frame = (t) => {
    // Capped so a frame after a hidden tab does not jump the deck.
    const dt = last === null ? 0 : Math.min(0.1, (t - last) / 1000);
    last = t;
    deck = stepDeck(deck, dt, on);
    paint();
    if (on || !isSettled(deck, on)) {
      raf(frame);
    } else {
      looping = false;
      last = null;
    }
  };

  paint();
  return {
    set(next) {
      if (next === on) return;
      on = next;
      if (reduceMotion) {
        deck = { ...deck, speed: 0, arm: on ? 1 : 0, lift: 0 };
        paint();
        return;
      }
      if (!looping) {
        looping = true;
        raf(frame);
      }
    },
  };
}
