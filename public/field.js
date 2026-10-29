// Shared by the server physics and the canvas so markings match collisions.
const paddleRadius = 40;
export const FIELD = Object.freeze({
  width: 1200, height: 640,
  goalTop: 196, goalBottom: 444,
  paddleRadius, radius: 12,
  paddleInset: paddleRadius + 4, centerInset: paddleRadius + 4,
  speed: 560, paddleSpeed: 520, target: 5,
  staminaMax: 100, dashCost: 35, dashSpeed: 1550, dashDuration: 0.13,
  dashCooldown: 0.23, staminaRegen: 22, staminaRegenDelay: 0.65, doubleTapMs: 250,
});
