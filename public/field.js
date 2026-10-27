// Shared by the server physics and the canvas so goal markings match collisions.
export const FIELD = Object.freeze({
  width: 1200, height: 640,
  goalTop: 232, goalBottom: 408,
  paddleWidth: 18, paddleHeight: 108, radius: 12,
  speed: 560, paddleSpeed: 520, target: 5,
});
