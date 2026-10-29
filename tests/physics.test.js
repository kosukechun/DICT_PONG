import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELD, makeState, movePaddle, collidePaddle, stepBall, viewState, cpuInput } from '../server/physics.js';

test('dash is faster, spends stamina once and has equal diagonal distance', () => {
  const [straight, diagonal] = [0, 1].map(() => ({ ...makeState().paddles[0], x: 250 }));
  const start = { x: 250, y: 320 };
  for (let n = 0; n < 8; n++) {
    movePaddle(straight, n === 0 ? { dash: { dx: 1, dy: 0 } } : {}, 0, 1 / 60);
    movePaddle(diagonal, n === 0 ? { dash: { dx: 1, dy: -1 } } : {}, 0, 1 / 60);
  }
  assert.ok(straight.x - start.x > FIELD.paddleSpeed * 8 / 60 * 2);
  assert.ok(Math.abs(straight.x - start.x - Math.hypot(diagonal.x - start.x, diagonal.y - start.y)) < 0.001);
  assert.equal(straight.stamina, 65); assert.equal(diagonal.stamina, 65);
  assert.equal(straight.dashRemaining, 0);
});

test('stamina, cooldown, recovery delay and all eight dash directions are enforced', () => {
  for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
    if (!dx && !dy) continue;
    const p = { ...makeState().paddles[0], x: 280 };
    movePaddle(p, { dash: { dx, dy } }, 0, 1 / 60);
    assert.equal(p.stamina, 65);
    const stamina = p.stamina;
    movePaddle(p, { dash: { dx, dy } }, 0, 1 / 60);
    assert.equal(p.stamina, stamina);
    for (let i = 0; i < 38; i++) movePaddle(p, {}, 0, 1 / 60);
    assert.ok(p.stamina > 65 && p.stamina < 66);
    for (let i = 0; i < 400; i++) movePaddle(p, {}, 0, 1 / 60);
    assert.equal(p.stamina, 100);
  }
  const p = { ...makeState().paddles[0], stamina: 20 };
  movePaddle(p, { dash: { dx: 1, dy: 0 } }, 0, 1 / 60);
  assert.equal(p.x, 90); assert.equal(p.dashRemaining, 0);
  for (const side of [0, 1]) {
    const p = { ...makeState().paddles[side] };
    for (let i = 0; i < 120; i++) movePaddle(p, { dx: side ? -1 : 1, dy: -1, dash: { dx: side ? -1 : 1, dy: -1 } }, side, 1 / 60);
    assert.ok(p.x >= (side ? 600 + FIELD.centerInset : FIELD.paddleInset) && p.x <= (side ? 1200 - FIELD.paddleInset : 600 - FIELD.centerInset));
    assert.ok(p.y >= FIELD.paddleInset && p.stamina >= 0);
  }
});

test('widened goal admits shots in the new opening on both sides', () => {
  assert.equal(FIELD.goalBottom - FIELD.goalTop, 248);
  for (const side of [0, 1]) for (const y of [218, 422]) {
    const state = makeState(); state.countdown = 0;
    state.ball = { x: side ? 1199 : 1, y, vx: side ? 560 : -560, vy: 0 };
    let scorer = null;
    for (let n = 0; n < 5 && scorer === null; n++) scorer = stepBall(state, 1 / 60);
    assert.equal(scorer, side ? 0 : 1);
  }
});

test('both participants see their paddle on the left and their own score first', () => {
  const state = makeState(); state.ball = { x: 234, y: 280, vx: 600, vy: -100 }; state.score = [4, 2];
  const view = viewState(state, 1);
  assert.equal(view.paddles[0].x, 90); assert.equal(view.ball.x, 966); assert.equal(view.ball.vx, -600);
  assert.equal(view.ball.y, 280); assert.deepEqual(view.score, [2, 4]);
  view.paddles[0].x = 1; assert.equal(state.paddles[1].x, 1110);
});

test('round mallet reflects approaching pucks on all four sides', () => {
  const paddle = { x: 200, y: 320, vx: 0, vy: 0 };
  for (const ball of [
    { x: 157, y: 320, vx: 560, vy: 0 }, { x: 243, y: 320, vx: -560, vy: 0 },
    { x: 200, y: 277, vx: 0, vy: 560 }, { x: 200, y: 363, vx: 0, vy: -560 },
  ]) {
    const before = { ...ball }; assert.equal(collidePaddle(ball, paddle), true);
    if (before.vx) assert.ok(before.vx * ball.vx < 0);
    else assert.ok(before.vy * ball.vy < 0);
    assert.ok(Math.hypot(ball.vx, ball.vy) <= 1000.01);
  }
});

test('circular diagonal contact and coincident centers produce finite separation', () => {
  const paddle = { x: 200, y: 320, vx: 0, vy: 0 };
  const corner = { x: 170, y: 290, vx: 400, vy: 400 };
  assert.equal(collidePaddle(corner, paddle), true); assert.ok(corner.vx < 0 && corner.vy < 0);
  const embedded = { x: 200, y: 320, vx: 560, vy: 10 }; collidePaddle(embedded, paddle);
  assert.ok(Object.values(embedded).every(Number.isFinite)); assert.ok(Math.hypot(embedded.x - 200, embedded.y - 320) >= FIELD.paddleRadius + FIELD.radius);
  const outsideCircle = { x: 200 + (FIELD.paddleRadius + FIELD.radius) * .9, y: 320 + (FIELD.paddleRadius + FIELD.radius) * .9, vx: -400, vy: -400 };
  assert.equal(collidePaddle(outsideCircle, paddle), false);
});

test('separating balls are not reflected a second time', () => {
  const b = { x: 157, y: 320, vx: -560, vy: 0 };
  assert.equal(collidePaddle(b, { x: 200, y: 320 }), false); assert.equal(b.vx, -560);
});

test('movement is speed limited, diagonal-normalized and restricted to own half', () => {
  const a = { x: 100, y: 320 }, b = { x: 100, y: 320 };
  movePaddle(a, { dx: 1, dy: 1 }, 0, 1 / 60); movePaddle(b, { dx: 1, dy: 0 }, 0, 1 / 60);
  assert.ok(Math.abs(Math.hypot(a.x - 100, a.y - 320) - (b.x - 100)) < 0.001);
  for (let i = 0; i < 500; i++) movePaddle(a, { x: 9000, y: -9000 }, 0, 1 / 60);
  assert.ok(a.x <= 600 - FIELD.centerInset && a.y >= FIELD.paddleInset);
  const right = { x: 1110, y: 320 }; movePaddle(right, { x: 0, y: 0 }, 1, 1);
  assert.ok(right.x >= 600 + FIELD.centerInset && right.y >= FIELD.paddleInset);
});

test('mouse reaches its target in one simulation tick while CPU and keyboard retain speed limits', () => {
  const mouse = { x: 90, y: 320 }, cpu = { x: 90, y: 320 }, keyboard = { x: 90, y: 320 };
  movePaddle(mouse, { x: 550, y: 100, direct: true }, 0, 1 / 60);
  assert.equal(mouse.x, 550); assert.equal(mouse.y, 100);
  movePaddle(cpu, { x: 550, y: 100 }, 0, 1 / 60, 270);
  assert.ok(Math.hypot(cpu.x - 90, cpu.y - 320) <= 270 / 60 + .001);
  movePaddle(keyboard, { dx: 1 }, 0, 1 / 60);
  assert.ok(Math.abs(keyboard.x - 90 - FIELD.paddleSpeed / 60) < .001);
  movePaddle(mouse, { x: 9000, y: -9000, direct: true }, 0, 1 / 60);
  assert.equal(mouse.x, 600 - FIELD.centerInset); assert.equal(mouse.y, FIELD.paddleInset);
  assert.ok(mouse.x + FIELD.paddleRadius < 600 && mouse.y - FIELD.paddleRadius > 0);
});

test('fast mouse strokes hit pucks along their full path on either side', () => {
  for (const side of [0, 1]) {
    const state = makeState(); state.countdown = 0;
    const p = state.paddles[side]; p.x = side ? 1100 : 100;
    state.ball = { x: side ? 900 : 300, y: 320, vx: 0, vy: 0 };
    movePaddle(p, { x: side ? 700 : 500, y: 320, direct: true }, side, 1 / 60);
    stepBall(state, 1 / 60);
    assert.ok(side ? state.ball.vx < 0 : state.ball.vx > 0);
    assert.ok(Math.hypot(state.ball.vx, state.ball.vy) <= 1000.01);
    assert.ok(state.rally > 0);
  }
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
