function convertToTimestamp(dateString) {
  const milliseconds = new Date(dateString).getTime();
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : null;
}

function normalizeId(id) {
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  const normalized = String(id).trim();
  return /^\d+$/.test(normalized) ? normalized : null;
}

function normalizeRound(round) {
  const normalized = Number(round);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : null;
}

function isValidTimestamp(timestamp) {
  return (
    Number.isSafeInteger(timestamp) &&
    timestamp > 0 &&
    timestamp <= Math.floor(Date.now() / 1000) + 5 * 60
  );
}

module.exports = {
  convertToTimestamp,
  normalizeId,
  normalizeRound,
  isValidTimestamp,
};
