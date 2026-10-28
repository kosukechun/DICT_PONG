// Shared by the server physics and the canvas so goal markings match collisions.
export const FIELD = Object.freeze({
  width: 1200, height: 640,
  goalTop: 196, goalBottom: 444,
  paddleWidth: 18, paddleHeight: 108, radius: 12,
  speed: 560, paddleSpeed: 520, target: 5,
  staminaMax: 100, dashCost: 35, dashSpeed: 1550, dashDuration: 0.13,
  dashCooldown: 0.23, staminaRegen: 22, staminaRegenDelay: 0.65, doubleTapMs: 250,
});
