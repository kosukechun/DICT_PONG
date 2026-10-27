import { FIELD } from '../public/field.js';
export { FIELD };
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export function makeState() {
  return {
    paddles: [{ x: 90, y: 320, vx: 0, vy: 0 }, { x: 1110, y: 320, vx: 0, vy: 0 }],
    ball: { x: 600, y: 320, vx: 0, vy: 0 }, score: [0, 0], countdown: 2.5, rally: 0,
  };
}

export function movePaddle(p, input, side, dt, speed = FIELD.paddleSpeed) {
  let dx = clamp(Number(input?.dx) || 0, -1, 1), dy = clamp(Number(input?.dy) || 0, -1, 1);
  if (Number.isFinite(input?.x) && Number.isFinite(input?.y)) {
    dx = input.x - p.x; dy = input.y - p.y;
    const distance = Math.hypot(dx, dy);
    const scale = distance ? Math.min(1, distance / (speed * dt)) / distance : 0;
    dx *= scale; dy *= scale;
  } else {
    const length = Math.max(1, Math.hypot(dx, dy)); dx /= length; dy /= length;
  }
  const oldX = p.x, oldY = p.y;
  p.x = clamp(p.x + dx * speed * dt, side ? 655 : 35, side ? 1165 : 545);
  p.y = clamp(p.y + dy * speed * dt, 64, 576);
  p.vx = (p.x - oldX) / dt; p.vy = (p.y - oldY) / dt;
}

// Circle / rectangle contact: faces and rounded corner contacts work in all directions.
export function collidePaddle(ball, paddle) {
  const halfW = FIELD.paddleWidth / 2, halfH = FIELD.paddleHeight / 2;
  const nearX = clamp(ball.x, paddle.x - halfW, paddle.x + halfW);
  const nearY = clamp(ball.y, paddle.y - halfH, paddle.y + halfH);
  let nx = ball.x - nearX, ny = ball.y - nearY, distance = Math.hypot(nx, ny);
  if (distance > FIELD.radius) return false;
  if (distance < 0.0001) {
    const faces = [
      { gap: ball.x - (paddle.x - halfW), x: -1, y: 0 },
      { gap: paddle.x + halfW - ball.x, x: 1, y: 0 },
      { gap: ball.y - (paddle.y - halfH), x: 0, y: -1 },
      { gap: paddle.y + halfH - ball.y, x: 0, y: 1 },
    ].sort((a, b) => a.gap - b.gap);
    nx = faces[0].x; ny = faces[0].y; distance = -faces[0].gap;
  } else { nx /= distance; ny /= distance; }
  ball.x += nx * (FIELD.radius - distance + 0.1);
  ball.y += ny * (FIELD.radius - distance + 0.1);
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
  // Small fixed substeps prevent fast balls tunneling through a narrow paddle.
  const steps = Math.max(1, Math.ceil(dt / (1 / 240))), sub = dt / steps;
  for (let i = 0; i < steps; i++) {
    const b = state.ball;
    b.x += b.vx * sub; b.y += b.vy * sub;
    if (b.y < FIELD.radius) { b.y = 2 * FIELD.radius - b.y; b.vy = Math.abs(b.vy); }
    if (b.y > FIELD.height - FIELD.radius) { b.y = 2 * (FIELD.height - FIELD.radius) - b.y; b.vy = -Math.abs(b.vy); }
    for (const paddle of state.paddles) if (collidePaddle(b, paddle)) state.rally++;
    collideSideWalls(b);
    if (b.x < -FIELD.radius || b.x > FIELD.width + FIELD.radius) {
      const scorer = b.x < 0 ? 1 : 0;
      state.score[scorer]++;
      state.ball = { x: 600, y: 320, vx: 0, vy: 0 };
      state.paddles.forEach((p, side) => Object.assign(p, { x: side ? 1110 : 90, y: 320, vx: 0, vy: 0 }));
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
    paddles: [...state.paddles].reverse().map(p => ({ ...p, x: FIELD.width - p.x, vx: -p.vx })),
    ball: { ...state.ball, x: FIELD.width - state.ball.x, vx: -state.ball.vx },
  };
}
