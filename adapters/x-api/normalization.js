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

function isValidTimestamp(timestamp, nowSeconds, futureSkewSeconds = 0) {
  return (
    Number.isSafeInteger(timestamp) &&
    timestamp > 0 &&
    Number.isSafeInteger(nowSeconds) &&
    nowSeconds > 0 &&
    Number.isSafeInteger(futureSkewSeconds) &&
    futureSkewSeconds >= 0 &&
    timestamp <= nowSeconds + futureSkewSeconds
  );
}

module.exports = {
  convertToTimestamp,
  normalizeId,
  normalizeRound,
  isValidTimestamp,
};
