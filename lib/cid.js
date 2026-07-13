const MAX_CID_LENGTH = 256;

let cidModulePromise;

/**
 * multiformats v13 is ESM-only. Loading it lazily keeps this CommonJS task
 * loadable while still using the canonical CID parser at the trust boundary.
 */
async function loadCID() {
  if (!cidModulePromise) {
    cidModulePromise = import('multiformats/cid')
      .then(module => module.CID || module.default?.CID || module.default)
      .then(CID => {
        if (!CID || typeof CID.parse !== 'function') {
          throw new TypeError('multiformats/cid did not export CID.parse');
        }
        return CID;
      })
      .catch(error => {
        cidModulePromise = undefined;
        throw error;
      });
  }
  return cidModulePromise;
}

function createCIDValidator(loader = loadCID) {
  return async value => {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > MAX_CID_LENGTH ||
      value.trim() !== value
    ) {
      return false;
    }

    try {
      const CID = await loader();
      CID.parse(value);
      return true;
    } catch {
      return false;
    }
  };
}

const isValidCID = createCIDValidator();

module.exports = {
  MAX_CID_LENGTH,
  createCIDValidator,
  isValidCID,
  loadCID,
};
