/**
 * @fileoverview Base Adapter class
 * @description
 * The Adapter class is the base class for API adapters (e.g. Twitter).
 * Subclasses override methods like negotiateSession, search, verify, etc.
 * Inheritance is preserved so that `instanceof Adapter` checks continue to work.
 */

class Adapter {
  constructor(credentials, maxRetry) {
    this.credentials = credentials;
    this.maxRetry = maxRetry || 3;
  }
}

module.exports = Adapter;
