// Shared movement: direct mouse tracking, speed-limited keyboard/CPU, common bounds.
import { FIELD } from './field.js';
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export function movePaddle(p, input, side, dt, speed = FIELD.paddleSpeed) {
  if (!(dt > 0)) return;
  p.stamina ??= FIELD.staminaMax;
  p.dashRemaining ??= 0; p.dashCooldown ??= 0; p.regenDelay ??= 0;
  p.dashCooldown = Math.max(0, p.dashCooldown - dt);
  const dash = input?.dash;
  const dashLength = Math.hypot(dash?.dx || 0, dash?.dy || 0);
  if (dashLength > 0 && Number.isFinite(dashLength) && !p.dashRemaining && !p.dashCooldown && p.stamina >= FIELD.dashCost) {
    p.dashX = dash.dx / dashLength; p.dashY = dash.dy / dashLength;
    p.dashRemaining = FIELD.dashDuration; p.dashCooldown = FIELD.dashCooldown;
    p.stamina -= FIELD.dashCost; p.regenDelay = FIELD.staminaRegenDelay;
  }
  const regenTime = Math.max(0, dt - p.regenDelay);
  p.regenDelay = Math.max(0, p.regenDelay - dt);
  p.stamina = Math.min(FIELD.staminaMax, p.stamina + FIELD.staminaRegen * regenTime);
  let dx = clamp(Number(input?.dx) || 0, -1, 1), dy = clamp(Number(input?.dy) || 0, -1, 1);
  const oldX = p.x, oldY = p.y;
  const minX = side ? FIELD.width / 2 + FIELD.centerInset : FIELD.paddleInset;
  const maxX = side ? FIELD.width - FIELD.paddleInset : FIELD.width / 2 - FIELD.centerInset;
  const minY = FIELD.paddleInset, maxY = FIELD.height - FIELD.paddleInset;
  // Human mouse input is direct, without a keyboard-speed chase or easing.
  // The server supplies this flag; CPU targets continue to use their own speed.
  if (input?.direct && Number.isFinite(input.x) && Number.isFinite(input.y)) {
    p.x = clamp(input.x, minX, maxX); p.y = clamp(input.y, minY, maxY);
    p.dashRemaining = 0;
  } else {
    if (Number.isFinite(input?.x) && Number.isFinite(input?.y)) {
      dx = input.x - p.x; dy = input.y - p.y;
      const distance = Math.hypot(dx, dy);
      const scale = distance ? Math.min(1, distance / (speed * dt)) / distance : 0;
      dx *= scale; dy *= scale;
    } else {
      const length = Math.max(1, Math.hypot(dx, dy)); dx /= length; dy /= length;
    }
    const dashTime = Math.min(dt, p.dashRemaining), normalTime = dt - dashTime;
    p.x = clamp(p.x + dx * speed * normalTime + (p.dashX || 0) * FIELD.dashSpeed * dashTime, minX, maxX);
    p.y = clamp(p.y + dy * speed * normalTime + (p.dashY || 0) * FIELD.dashSpeed * dashTime, minY, maxY);
    p.dashRemaining = Math.max(0, p.dashRemaining - dt);
  }
  p.previousX = oldX; p.previousY = oldY;
  p.vx = (p.x - oldX) / dt; p.vy = (p.y - oldY) / dt;
}

