export { movePaddle } from '../public/movement.js';
import { FIELD } from '../public/field.js';
export { FIELD };
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export function makeState() {
  return {
    paddles: [90, 1110].map(x => ({ x, y: 320, vx: 0, vy: 0, stamina: FIELD.staminaMax, dashRemaining: 0, dashCooldown: 0, regenDelay: 0 })),
    ball: { x: 600, y: 320, vx: 0, vy: 0 }, score: [0, 0], countdown: 2.5, rally: 0,
  };
}

// A circular mallet and circular puck share the exact radii used for rendering.
export function collidePaddle(ball, paddle) {
  const contactRadius = FIELD.paddleRadius + FIELD.radius;
  let nx = ball.x - paddle.x, ny = ball.y - paddle.y, distance = Math.hypot(nx, ny);
  if (distance > contactRadius) return false;
  if (distance < 0.0001) {
    const rvx = ball.vx - (paddle.vx || 0), rvy = ball.vy - (paddle.vy || 0);
    const speed = Math.hypot(rvx, rvy);
    nx = speed ? -rvx / speed : 1; ny = speed ? -rvy / speed : 0;
  } else { nx /= distance; ny /= distance; }
  ball.x += nx * (contactRadius - distance + 0.1);
  ball.y += ny * (contactRadius - distance + 0.1);
  const pvx = paddle.vx || 0, pvy = paddle.vy || 0;
  const approach = (ball.vx - pvx) * nx + (ball.vy - pvy) * ny;
  if (approach >= 0) return false;
  ball.vx -= 2 * approach * nx; ball.vy -= 2 * approach * ny;
  ball.vy += pvy * 0.15; ball.vx += pvx * 0.15;
  let speed = Math.hypot(ball.vx, ball.vy);
  const target = clamp(speed * 1.025, FIELD.speed, 1000);
  if (!speed) { ball.vx = nx * target; ball.vy = ny * target; }
  else { ball.vx *= target / speed; ball.vy *= target / speed; }
  // Avoid near-vertical rallies that never reach a goal.
  if (Math.abs(ball.vx) < 160) {
    ball.vx = (Math.sign(ball.vx) || Math.sign(nx) || 1) * 160;
    ball.vy = (Math.sign(ball.vy) || 1) * Math.sqrt(Math.max(0, target ** 2 - 160 ** 2));
  }
  return true;
}

function collideSideWalls(ball) {
  const { width, radius, goalTop, goalBottom } = FIELD;
  // The parts above/below each goal are solid side walls.
  if (ball.y <= goalTop || ball.y >= goalBottom) {
    if (ball.x < radius) { ball.x = 2 * radius - ball.x; ball.vx = Math.abs(ball.vx); }
    if (ball.x > width - radius) { ball.x = 2 * (width - radius) - ball.x; ball.vx = -Math.abs(ball.vx); }
    return;
  }
  // Rounded contact at the ends of the opening also checks the ball's radius.
  // A ball clipping a goalpost must bounce instead of passing through it.
  const postY = ball.y < (goalTop + goalBottom) / 2 ? goalTop : goalBottom;
  for (const postX of [0, width]) {
    const dx = ball.x - postX, dy = ball.y - postY, distance = Math.hypot(dx, dy);
    if (distance >= radius || distance === 0) continue;
    const nx = dx / distance, ny = dy / distance;
    ball.x += nx * (radius - distance + 0.001);
    ball.y += ny * (radius - distance + 0.001);
    const approach = ball.vx * nx + ball.vy * ny;
    if (approach < 0) { ball.vx -= 2 * approach * nx; ball.vy -= 2 * approach * ny; }
  }
}

function collideHorizontalWalls(ball) {
  if (ball.y < FIELD.radius) { ball.y = 2 * FIELD.radius - ball.y; ball.vy = Math.abs(ball.vy); }
  if (ball.y > FIELD.height - FIELD.radius) { ball.y = 2 * (FIELD.height - FIELD.radius) - ball.y; ball.vy = -Math.abs(ball.vy); }
}

export function stepBall(state, dt, random = Math.random) {
  if (state.countdown > 0) {
    state.countdown = Math.max(0, state.countdown - dt);
    if (!state.countdown) {
      const angle = (random() - 0.5) * 0.8;
      state.ball.vx = Math.cos(angle) * FIELD.speed * (state.serveDirection || (random() < 0.5 ? 1 : -1));
      state.ball.vy = Math.sin(angle) * FIELD.speed;
    }
    return null;
  }
  // Sweep mallets through their movement too: a fast mouse stroke must hit the
  // puck even when neither endpoint overlaps it. Bounds keep this work finite.
  const travel = Math.max(...state.paddles.map(p => Math.hypot(p.x - (p.previousX ?? p.x), p.y - (p.previousY ?? p.y))));
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)), Math.ceil(travel / (FIELD.paddleRadius / 2))), sub = dt / steps;
  for (let i = 0; i < steps; i++) {
    const b = state.ball;
    b.x += b.vx * sub; b.y += b.vy * sub;
    collideHorizontalWalls(b);
    for (const p of state.paddles) {
      const fraction = (i + 1) / steps;
      const paddle = { ...p, x: (p.previousX ?? p.x) + (p.x - (p.previousX ?? p.x)) * fraction, y: (p.previousY ?? p.y) + (p.y - (p.previousY ?? p.y)) * fraction };
      if (collidePaddle(b, paddle)) state.rally++;
    }
    // Mallet separation can push a puck into a rail after integration already
    // handled it. Resolve the rail again before publishing or checking a goal.
    collideHorizontalWalls(b);
    collideSideWalls(b);
    if (b.x < -FIELD.radius || b.x > FIELD.width + FIELD.radius) {
      const scorer = b.x < 0 ? 1 : 0;
      state.score[scorer]++;
      state.ball = { x: 600, y: 320, vx: 0, vy: 0 };
      state.paddles.forEach((p, side) => Object.assign(p, { x: side ? 1110 : 90, previousX: side ? 1110 : 90, y: 320, previousY: 320, vx: 0, vy: 0, dashRemaining: 0 }));
      state.countdown = 2; state.serveDirection = scorer ? -1 : 1; state.rally = 0;
      return scorer;
    }
  }
  return null;
}

export function cpuInput(match, now) {
  const config = [{ speed: 270, reaction: 0.3, error: 95 }, { speed: 400, reaction: 0.16, error: 44 }, { speed: 510, reaction: 0.07, error: 12 }][match.level - 1];
  if (!match.cpu || now >= match.cpu.next) {
    const b = match.state.ball, p = match.state.paddles[1];
    let y = 320;
    if (b.vx > 0) {
      const t = Math.max(0, (p.x - b.x) / b.vx);
      const span = FIELD.height - FIELD.radius * 2;
      const projected = ((b.y - FIELD.radius + b.vy * t) % (span * 2) + span * 2) % (span * 2);
      y = FIELD.radius + (projected > span ? span * 2 - projected : projected);
    }
    match.cpu = { next: now + config.reaction, x: b.vx > 0 ? 1080 : 1050, y: y + (Math.random() - 0.5) * config.error * 2 };
  }
  return { input: { x: match.cpu.x, y: match.cpu.y }, speed: config.speed };
}

export function viewState(state, side) {
  if (!side) return { ...state, paddles: state.paddles.map(p => ({ ...p })), ball: { ...state.ball }, score: [...state.score] };
  return {
    ...state, score: [...state.score].reverse(),
    paddles: [...state.paddles].reverse().map(p => ({ ...p, x: FIELD.width - p.x, previousX: FIELD.width - (p.previousX ?? p.x), vx: -p.vx, dashX: -(p.dashX || 0) })),
    ball: { ...state.ball, x: FIELD.width - state.ball.x, vx: -state.ball.vx },
  };
}
