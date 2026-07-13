/**
 * A piece of submitted/audited data did not match expectations.
 * `field` and `value` describe which field failed and the offending value.
 */
class ValidationError extends Error {
  constructor(message, { field, value } = {}) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
  }
}

module.exports = {
  ValidationError,
};
