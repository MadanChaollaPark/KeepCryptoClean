const { isPlainObject } = require('./proof-validation');

function isCandidate(candidate) {
  return (
    candidate &&
    typeof candidate.publicKey === 'string' &&
    candidate.publicKey.length > 0 &&
    candidate.publicKey.length <= 256 &&
    Number.isSafeInteger(candidate.votes)
  );
}

/** Build a deterministic list that spends the complete integer bounty. */
function buildDistributionFromSubmitters(submitters, bounty) {
  if (!Array.isArray(submitters) || !Number.isSafeInteger(bounty) || bounty < 0)
    return {};
  if (!submitters.every(isCandidate)) return {};

  const byKey = new Map();
  for (const submitter of submitters) {
    if (byKey.has(submitter.publicKey)) return {};
    byKey.set(submitter.publicKey, submitter);
  }

  const allKeys = [...byKey.keys()].sort();
  const validKeys = allKeys.filter(key => byKey.get(key).votes > 0);
  const validKeySet = new Set(validKeys);
  const baseReward = validKeys.length
    ? Math.floor(bounty / validKeys.length)
    : 0;
  let remainder = validKeys.length ? bounty % validKeys.length : 0;

  const entries = allKeys.map(key => {
    if (!validKeySet.has(key)) return [key, 0];
    const reward = baseReward + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    return [key, reward];
  });
  return Object.fromEntries(entries);
}

function submittersFromTaskState(submissions, auditTriggers) {
  if (!isPlainObject(submissions)) return null;
  if (auditTriggers != null && !isPlainObject(auditTriggers)) return null;

  return Object.keys(submissions)
    .sort()
    .map(publicKey => {
      const trigger = auditTriggers?.[publicKey];
      if (trigger == null) return { publicKey, votes: 1, stake: 0 };
      if (!isPlainObject(trigger) || !Array.isArray(trigger.votes)) {
        return { publicKey, votes: -1, stake: 0 };
      }
      if (trigger.votes.length === 0) return { publicKey, votes: 0, stake: 0 };
      if (
        !trigger.votes.every(
          vote => isPlainObject(vote) && typeof vote.is_valid === 'boolean',
        )
      ) {
        return { publicKey, votes: -1, stake: 0 };
      }
      const votes = trigger.votes.reduce(
        (score, vote) => score + (vote.is_valid ? 1 : -1),
        0,
      );
      return { publicKey, votes, stake: 0 };
    });
}

function isDistributionList(value, maxEntries = 10000) {
  if (!isPlainObject(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= maxEntries &&
    entries.every(
      ([key, reward]) =>
        key.length > 0 &&
        key.length <= 256 &&
        Number.isSafeInteger(reward) &&
        reward >= 0,
    )
  );
}

function equalDistributionLists(left, right) {
  if (!isDistributionList(left) || !isDistributionList(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key, index) => key === rightKeys[index] && left[key] === right[key],
  );
}

module.exports = {
  buildDistributionFromSubmitters,
  equalDistributionLists,
  isDistributionList,
  submittersFromTaskState,
};
