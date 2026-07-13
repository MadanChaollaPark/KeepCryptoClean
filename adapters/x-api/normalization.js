const { normalizeXId } = require('../../lib/identifiers');

function normalizeId(id) {
  return normalizeXId(id);
}

function normalizeRound(round) {
  const normalized = Number(round);
  return Number.isSafeInteger(normalized) && normalized >= 0
    ? normalized
    : null;
}

module.exports = {
  normalizeId,
  normalizeRound,
};
