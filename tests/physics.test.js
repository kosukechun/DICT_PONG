import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELD, makeState, movePaddle, collidePaddle, stepBall, viewState, cpuInput } from '../server/physics.js';

test('both participants see their paddle on the left and their own score first', () => {
  const state = makeState(); state.ball = { x: 234, y: 280, vx: 600, vy: -100 }; state.score = [4, 2];
  const view = viewState(state, 1);
  assert.equal(view.paddles[0].x, 90); assert.equal(view.ball.x, 966); assert.equal(view.ball.vx, -600);
  assert.equal(view.ball.y, 280); assert.deepEqual(view.score, [2, 4]);
  view.paddles[0].x = 1; assert.equal(state.paddles[1].x, 1110);
});

test('all four paddle faces reflect an approaching ball', () => {
  const paddle = { x: 200, y: 320, vx: 0, vy: 0 };
  for (const ball of [
    { x: 181, y: 320, vx: 560, vy: 0 }, { x: 219, y: 320, vx: -560, vy: 0 },
    { x: 200, y: 257, vx: 0, vy: 560 }, { x: 200, y: 383, vx: 0, vy: -560 },
  ]) {
    const before = { ...ball }; assert.equal(collidePaddle(ball, paddle), true);
    if (before.vx) assert.ok(before.vx * ball.vx < 0);
    else assert.ok(before.vy * ball.vy < 0);
    assert.ok(Math.hypot(ball.vx, ball.vy) <= 1000.01);
  }
});

test('corner contact and penetrating contact produce finite positions and velocities', () => {
  const paddle = { x: 200, y: 320, vx: 0, vy: 0 };
  const corner = { x: 183, y: 258, vx: 400, vy: 400 };
  assert.equal(collidePaddle(corner, paddle), true); assert.ok(corner.vx < 0 && corner.vy < 0);
  const embedded = { x: 200, y: 320, vx: 560, vy: 10 }; collidePaddle(embedded, paddle);
  assert.ok(Object.values(embedded).every(Number.isFinite)); assert.ok(Math.abs(embedded.x - 200) >= 21);
});

test('separating balls are not reflected a second time', () => {
  const b = { x: 180, y: 320, vx: -560, vy: 0 };
  assert.equal(collidePaddle(b, { x: 200, y: 320 }), false); assert.equal(b.vx, -560);
});

test('movement is speed limited, diagonal-normalized and restricted to own half', () => {
  const a = { x: 100, y: 320 }, b = { x: 100, y: 320 };
  movePaddle(a, { dx: 1, dy: 1 }, 0, 1 / 60); movePaddle(b, { dx: 1, dy: 0 }, 0, 1 / 60);
  assert.ok(Math.abs(Math.hypot(a.x - 100, a.y - 320) - (b.x - 100)) < 0.001);
  for (let i = 0; i < 500; i++) movePaddle(a, { x: 9000, y: -9000 }, 0, 1 / 60);
  assert.ok(a.x <= 545 && a.y >= 64);
  const right = { x: 1110, y: 320 }; movePaddle(right, { x: 0, y: 0 }, 1, 1);
  assert.ok(right.x >= 655 && right.y >= 64);
});

test('top and bottom walls bounce while a ball through the central opening scores', () => {
  const state = makeState(); state.countdown = 0; state.ball = { x: 500, y: 13, vx: 100, vy: -560 };
  stepBall(state, 1 / 60); assert.ok(state.ball.vy > 0);
  state.ball = { x: 500, y: 627, vx: 100, vy: 560 }; stepBall(state, 1 / 60); assert.ok(state.ball.vy < 0);
  state.ball = { x: 1210, y: 320, vx: 560, vy: 0 }; assert.equal(stepBall(state, 1 / 60), 0);
  assert.deepEqual(state.score, [1, 0]); assert.equal(state.ball.x, 600); assert.equal(state.countdown, 2);
});

test('both side walls reflect shots above and below the goal without scoring', () => {
  for (const side of [0, 1]) for (const y of [80, FIELD.goalTop - 1, FIELD.goalBottom + 1, 560]) {
    const state = makeState(); state.countdown = 0;
    state.ball = { x: side ? FIELD.width - 13 : 13, y, vx: side ? 1000 : -1000, vy: 0 };
    assert.equal(stepBall(state, 1 / 60), null);
    assert.ok(side ? state.ball.vx < 0 : state.ball.vx > 0);
    assert.deepEqual(state.score, [0, 0]);
  }
});

test('a clean shot can score through either opening, but only after the whole ball crosses', () => {
  for (const side of [0, 1]) {
    const state = makeState(); state.countdown = 0;
    state.ball = { x: side ? FIELD.width - 13 : 13, y: 320, vx: side ? 560 : -560, vy: 0 };
    assert.equal(stepBall(state, 1 / 60), null); assert.deepEqual(state.score, [0, 0]);
    let scorer = null;
    for (let i = 0; i < 5 && scorer === null; i++) scorer = stepBall(state, 1 / 60);
    assert.equal(scorer, side ? 0 : 1); assert.equal(state.score[side ? 0 : 1], 1);
  }
});

test('the ball radius collides with both goalposts on each side', () => {
  for (const side of [0, 1]) for (const y of [FIELD.goalTop + 4, FIELD.goalBottom - 4]) {
    const state = makeState(); state.countdown = 0;
    state.ball = { x: side ? FIELD.width - 13 : 13, y, vx: side ? 560 : -560, vy: 0 };
    assert.equal(stepBall(state, 1 / 60), null);
    assert.ok(side ? state.ball.vx < 0 : state.ball.vx > 0);
    assert.deepEqual(state.score, [0, 0]);
    assert.ok(y < 320 ? state.ball.vy > 0 : state.ball.vy < 0);
  }
});

test('fast ball cannot pass through a paddle between ticks', () => {
  const state = makeState(); state.countdown = 0;
  state.ball = { x: 125, y: 320, vx: -1000, vy: 0 };
  for (let i = 0; i < 4; i++) stepBall(state, 1 / 60);
  assert.ok(state.ball.vx > 0); assert.deepEqual(state.score, [0, 0]);
});

test('a match can reach exactly five, with reset and serve between each goal', () => {
  const state = makeState();
  for (let i = 0; i < FIELD.target; i++) {
    state.countdown = 0; state.ball = { x: 1211, y: 320, vx: 560, vy: 0 };
    assert.equal(stepBall(state, 1 / 60), 0);
    assert.equal(state.score[0], i + 1);
  }
  assert.equal(state.score[0], 5);
});

test('CPU levels have different speed and reaction intervals', () => {
  const values = [1, 2, 3].map(level => {
    const match = { level, state: makeState() }; const value = cpuInput(match, 10);
    return { speed: value.speed, next: match.cpu.next };
  });
  assert.ok(values[0].speed < values[1].speed && values[1].speed < values[2].speed);
  assert.ok(values[0].next > values[1].next && values[1].next > values[2].next);
});
