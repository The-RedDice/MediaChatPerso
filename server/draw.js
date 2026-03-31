const { getClientList, io } = require('./server');

// Stores active drawing sessions
// targetPseudo -> { active: boolean, endTime: number, cooldownEndTime: number }
const sessions = new Map();

const SESSION_DURATION = 90 * 1000; // 1m30s
const COOLDOWN_DURATION = 5 * 60 * 1000; // 5m

function getSessionState(target) {
  if (!sessions.has(target)) {
    sessions.set(target, { active: false, endTime: 0, cooldownEndTime: 0 });
  }
  return sessions.get(target);
}

function canStartSession(target) {
  const state = getSessionState(target);
  const now = Date.now();
  return !state.active && now >= state.cooldownEndTime;
}

function startSession(io, target) {
  if (!canStartSession(target)) return false;

  const state = getSessionState(target);
  const now = Date.now();

  state.active = true;
  state.endTime = now + SESSION_DURATION;

  // Tell target to start drawing mode
  io.emit('start_draw_session', { target, endTime: state.endTime });

  // Notify dashboard clients that a session started
  io.emit('draw_session_state', { target, active: true, endTime: state.endTime });

  // Set a timeout to end the session
  setTimeout(() => {
    endSession(io, target);
  }, SESSION_DURATION);

  return true;
}

function endSession(io, target) {
  const state = getSessionState(target);
  if (!state.active) return;

  const now = Date.now();
  state.active = false;
  state.cooldownEndTime = now + COOLDOWN_DURATION;

  // Tell target to capture screenshot and end session
  io.emit('end_draw_session', { target });

  // Notify dashboard clients that the session ended
  io.emit('draw_session_state', { target, active: false, cooldownEndTime: state.cooldownEndTime });
}

module.exports = {
  getSessionState,
  canStartSession,
  startSession,
  endSession
};
