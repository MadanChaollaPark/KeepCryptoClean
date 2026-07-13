const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Data = require('../../model/data');

function memoryDb() {
  const docs = [];
  const matches = (doc, query) =>
    Object.entries(query).every(([key, value]) => {
      if (value && typeof value === 'object' && '$lt' in value) {
        return doc[key] < value.$lt;
      }
      return doc[key] === value;
    });
  return {
    docs,
    ensureIndex(_options, callback) {
      callback(null);
    },
    find(query) {
      return docs.filter(doc => matches(doc, query)).map(doc => ({ ...doc }));
    },
    update(query, update, options = {}) {
      const index = docs.findIndex(doc => matches(doc, query));
      const replacement = update.$set
        ? { ...(index >= 0 ? docs[index] : query), ...update.$set }
        : { ...update };
      if (index >= 0) docs[index] = replacement;
      else if (options.upsert) docs.push(replacement);
      return 1;
    },
    remove(query) {
      let removed = 0;
      for (let index = docs.length - 1; index >= 0; index--) {
        if (matches(docs[index], query)) {
          docs.splice(index, 1);
          removed += 1;
        }
      }
      return removed;
    },
  };
}

describe('Data namespace isolation', () => {
  it('isolates identical IDs and rounds in one shared Koii database', async () => {
    const db = memoryDb();
    const proofs = new Data('proofs', [], { db });
    const cookies = new Data('cookies', [], { db });

    await Promise.all([
      proofs.create({ id: 'same', round: 3, value: 'proof' }),
      cookies.create({ id: 'same', round: 3, value: 'cookie' }),
    ]);
    assert.equal((await proofs.getItem({ id: 'same' }))[0].value, 'proof');
    assert.equal((await cookies.getItem({ id: 'same' }))[0].value, 'cookie');
    assert.equal((await proofs.getList({ round: 3 })).length, 1);
    assert.equal((await cookies.getList({ round: 3 })).length, 1);
    await proofs.deleteList({ round: 3 });
    assert.equal((await proofs.getList({ round: 3 })).length, 0);
    assert.equal((await cookies.getList({ round: 3 })).length, 1);
  });

  it('makes initialization awaitable/idempotent and prunes only old rounds', async () => {
    const db = memoryDb();
    const data = new Data('cooldowns', [], { db });
    assert.equal(await data.initializeData(), db);
    assert.equal(await data.initializeData(), db);
    await data.create({ id: 'old', round: 1 });
    await data.create({ id: 'new', round: 5 });
    assert.equal(await data.deleteBeforeRound(5), 1);
    assert.equal(await data.getItem({ id: 'old' }), null);
    assert.equal((await data.getItem({ id: 'new' }))[0].round, 5);
    await assert.rejects(() => data.deleteBeforeRound(-1), TypeError);
  });

  it('does not begin a database write after cancellation', async () => {
    const db = memoryDb();
    const data = new Data('cancelled', [], { db });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => data.create({ id: 'never-written' }, { signal: controller.signal }),
      error => error.name === 'AbortError',
    );
    assert.equal(db.docs.length, 0);
  });
});
