import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELD, makeState, movePaddle, stepBall, viewState, cpuInput } from '../server/physics.js';

function seeded(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

test('larger mallets remain inside court bounds and cannot overlap across the center line', () => {
  assert.equal(FIELD.paddleRadius, 40);
  for (const side of [0, 1]) for (const x of [-1e9, 600, 1e9]) for (const y of [-1e9, 1e9]) {
    const p = { ...makeState().paddles[side] };
    movePaddle(p, { x, y, direct: true }, side, 1 / 60);
    assert.ok(p.x - FIELD.paddleRadius >= 0 && p.x + FIELD.paddleRadius <= FIELD.width);
    assert.ok(p.y - FIELD.paddleRadius >= 0 && p.y + FIELD.paddleRadius <= FIELD.height);
    assert.ok(side ? p.x - FIELD.paddleRadius > 600 : p.x + FIELD.paddleRadius < 600);
  }
});

test('puck stays inside top and bottom walls when a fast mallet presses it against the rail', () => {
  for (const bottom of [false, true]) {
    const state = makeState(); state.countdown = 0;
    const y = bottom ? FIELD.height - FIELD.radius : FIELD.radius;
    state.ball = { x: 240, y, vx: 0, vy: bottom ? -300 : 300 };
    state.paddles[0].x = 240; state.paddles[0].y = 200;
    movePaddle(state.paddles[0], { x: 240, y: bottom ? FIELD.height : 0, direct: true }, 0, 1 / 60);
    stepBall(state, 1 / 60);
    assert.ok(state.ball.y >= FIELD.radius && state.ball.y <= FIELD.height - FIELD.radius, JSON.stringify(state.ball));
  }
});

test('seeded mixed mouse/keyboard/dash simulation preserves finite states, bounds, scores and mirrored snapshots', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const random = seeded(seed), state = makeState(); state.countdown = 0;
    state.ball = { x: 100 + random() * 1000, y: 12 + random() * 616, vx: (random() - .5) * 1400, vy: (random() - .5) * 1400 };
    for (let tick = 0; tick < 360; tick++) {
      for (const side of [0, 1]) {
        const input = random() < .35 ? { x: random() * 1400 - 100, y: random() * 840 - 100, direct: true } : { dx: Math.floor(random() * 3) - 1, dy: Math.floor(random() * 3) - 1 };
        if (!input.direct && random() < .08) input.dash = { dx: input.dx, dy: input.dy };
        movePaddle(state.paddles[side], input, side, 1 / 60);
      }
      const score = [...state.score];
      stepBall(state, 1 / 60, random);
      for (const p of [...state.paddles, state.ball]) assert.ok([p.x, p.y, p.vx, p.vy].every(Number.isFinite), `seed=${seed} tick=${tick}`);
      for (const p of state.paddles) assert.ok(p.stamina >= 0 && p.stamina <= FIELD.staminaMax);
      assert.ok(state.ball.y >= FIELD.radius - .001 && state.ball.y <= FIELD.height - FIELD.radius + .001, `seed=${seed} tick=${tick}: ${JSON.stringify(state.ball)}`);
      assert.ok(state.score[0] >= score[0] && state.score[1] >= score[1]);
      assert.ok(state.score[0] + state.score[1] - score[0] - score[1] <= 1);
      if (tick % 30 === 0) {
        const reflected = viewState(state, 1);
        assert.equal(reflected.paddles[0].x, FIELD.width - state.paddles[1].x);
        assert.equal(reflected.ball.vx, -state.ball.vx);
        assert.deepEqual(reflected.score, [...state.score].reverse());
        reflected.paddles[0].x = -1; assert.notEqual(state.paddles[1].x, -1);
      }
    }
  }
});

test('CPU levels and mouse control complete prolonged rallies without invalid physics', () => {
  for (const level of [1, 2, 3]) {
    const random = seeded(600 + level), match = { level, state: makeState() };
    for (let tick = 0; tick < 3600; tick++) {
      const b = match.state.ball;
      movePaddle(match.state.paddles[0], { x: 120, y: b.y, direct: true }, 0, 1 / 60);
      const cpu = cpuInput(match, tick / 60);
      movePaddle(match.state.paddles[1], cpu.input, 1, 1 / 60, cpu.speed);
      stepBall(match.state, 1 / 60, random);
      assert.ok(Object.values(match.state.ball).every(Number.isFinite));
    }
  }
});
