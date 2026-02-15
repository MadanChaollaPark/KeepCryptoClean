// IPFS submission logic
// Extracted from twitter.js

const fs = require('fs');
const { KoiiStorageClient } = require('@_koii/storage-task-sdk');
const { namespaceWrapper } = require('@_koii/namespace-wrapper');

/**
 * Get or create a submission CID for the given round
 * @param {object} ctx - the Twitter instance (needs ctx.proofs, ctx.cids)
 * @param {number} round - the round number
 * @returns {Promise<string|null>}
 */
async function getSubmissionCID(ctx, round) {
  if (!ctx.proofs) {
    throw new Error('No proofs database provided');
  }

  const data = await ctx.cids.getList({ round: round });
  console.log(`got cids list for round ${round}`);

  if (!data || data.length === 0) {
    console.log('No cids found for round ' + round);
    return null;
  }

  let proof_cid;
  const filePath = 'dataList.json';
  let basePath = '';

  try {
    basePath = await namespaceWrapper.getBasePath();
    fs.writeFileSync(`${basePath}/${filePath}`, JSON.stringify(data));
  } catch (err) {
    console.log(err);
  }

  try {
    const client = new KoiiStorageClient(undefined, undefined, false);
    const userStaking = await namespaceWrapper.getSubmitterAccount();
    console.log(`Uploading ${basePath}/${filePath}`);
    const fileUploadResponse = await client.uploadFile(
      `${basePath}/${filePath}`,
      userStaking,
    );
    console.log(`Uploaded ${basePath}/${filePath}`);
    const cid = fileUploadResponse.cid;
    proof_cid = cid;

    await ctx.proofs.create({
      id: 'proof:' + round,
      proof_round: round,
      proof_cid: proof_cid,
    });

    console.log('returning proof cid for submission', proof_cid);
    return proof_cid;
  } catch (error) {
    if (error.message === 'Invalid Task ID') {
      console.error('Error: Invalid Task ID');
    } else {
      console.error('An unexpected error occurred:', error);
    }
    return null;
  }
}

module.exports = { getSubmissionCID };
