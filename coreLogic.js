const { namespaceWrapper } = require('@_koii/namespace-wrapper');
const TwitterTask = require('./twitter-task');
const logger = require('./lib/logger');

class CoreLogic {
  constructor() {
    this.twitterTask = null;
  }

  async task(roundNumber) {
    logger.info({ round: roundNumber }, 'Main task called');
    try {
      this.twitterTask = await new TwitterTask(roundNumber);
      logger.info({ round: roundNumber }, 'Crawler started');
    } catch (e) {
      logger.error({ err: e, round: roundNumber }, 'Error starting crawler');
    }
  }

  async fetchSubmission(roundNumber) {
    logger.info({ round: roundNumber }, 'Fetching submission');
    try {
      const cid = await this.twitterTask.getRoundCID(roundNumber);
      if (cid) {
        logger.info({ cid, round: roundNumber }, 'Submission CID ready');
        return cid;
      } else {
        logger.warn({ round: roundNumber }, 'No submission: CID is null');
      }
    } catch (error) {
      logger.error({ err: error, round: roundNumber }, 'Error fetching submission');
      throw error;
    }
  }

  async generateDistributionList(round, _dummyTaskState) {
    try {
      logger.info({ round }, 'Generating distribution list');

      let distributionList = {};
      let distributionCandidates = [];
      let taskAccountDataJSON = null;
      let taskStakeListJSON = null;

      try {
        taskAccountDataJSON = await namespaceWrapper.getTaskSubmissionInfo(round);
      } catch (error) {
        logger.error({ err: error }, 'Error fetching task submission data');
        return distributionList;
      }

      if (taskAccountDataJSON == null) {
        logger.error('Task submission data is null');
        return distributionList;
      }

      const submissions = taskAccountDataJSON.submissions[round];
      const submissions_audit_trigger =
        taskAccountDataJSON.submissions_audit_trigger[round];

      if (submissions == null) {
        logger.warn({ round }, 'No submissions found');
        return distributionList;
      }

      const keys = Object.keys(submissions);
      const values = Object.values(submissions);
      const size = values.length;

      taskStakeListJSON = await namespaceWrapper.getTaskState({
        is_stake_list_required: true,
      });

      if (taskStakeListJSON == null) {
        logger.error('Error fetching task staking list');
        return distributionList;
      }

      // Process audit results and build candidate list
      for (let i = 0; i < size; i++) {
        const candidatePublicKey = keys[i];

        if (
          submissions_audit_trigger &&
          submissions_audit_trigger[candidatePublicKey]
        ) {
          const votes = submissions_audit_trigger[candidatePublicKey].votes;

          if (votes.length === 0) {
            // Audit triggered but no votes cast - slash
            distributionList[candidatePublicKey] = 0;
          } else {
            let numOfVotes = 0;
            for (const vote of votes) {
              numOfVotes += vote.is_valid ? 1 : -1;
            }

            if (numOfVotes < 0 && taskStakeListJSON) {
              // More false votes than true - slash
              distributionList[candidatePublicKey] = 0;
            }

            if (numOfVotes > 0) {
              distributionCandidates.push(candidatePublicKey);
            }
          }
        } else {
          distributionCandidates.push(candidatePublicKey);
        }
      }

      // Distribute rewards equally among valid candidates
      const reward =
        distributionCandidates.length > 0
          ? Math.floor(
              taskStakeListJSON.bounty_amount_per_round /
                distributionCandidates.length,
            )
          : 0;

      logger.info({
        round,
        candidates: distributionCandidates.length,
        rewardPerNode: reward,
      }, 'Distribution calculated');

      for (const candidate of distributionCandidates) {
        distributionList[candidate] = reward;
      }

      return distributionList;
    } catch (err) {
      logger.error({ err }, 'Error generating distribution list');
    }
  }

  submitDistributionList = async round => {
    logger.info({ round }, 'Submitting distribution list');

    try {
      const distributionList = await this.generateDistributionList(round);
      if (Object.keys(distributionList).length === 0) {
        logger.warn('Empty distribution list; skipping submission');
        return;
      }
      const decider = await namespaceWrapper.uploadDistributionList(
        distributionList,
        round,
      );
      logger.info({ decider }, 'Distribution list uploaded');

      if (decider) {
        const response =
          await namespaceWrapper.distributionListSubmissionOnChain(round);
        logger.info({ response }, 'Distribution list submitted on chain');
      }
    } catch (err) {
      logger.error({ err }, 'Error submitting distribution');
    }
  };

  async selectAndGenerateDistributionList(
    round,
    isPreviousRoundFailed = false,
  ) {
    await namespaceWrapper.selectAndGenerateDistributionList(
      this.submitDistributionList,
      round,
      isPreviousRoundFailed,
    );
  }

  validateNode = async (submission_value, round) => {
    if (!this.twitterTask) {
      return true;
    }
    return await this.twitterTask.validate(submission_value, round);
  };

  async shallowEqual(object1, object2) {
    const keys1 = Object.keys(object1);
    const keys2 = Object.keys(object2);
    if (keys1.length !== keys2.length) return false;
    for (let key of keys1) {
      if (object1[key] !== object2[key]) return false;
    }
    return true;
  }

  validateDistribution = async (
    distributionListSubmitter,
    round,
    _dummyDistributionList,
    _dummyTaskState,
  ) => {
    try {
      logger.info({ distributionListSubmitter, round }, 'Validating distribution list');

      const rawDistributionList = await namespaceWrapper.getDistributionList(
        distributionListSubmitter,
        round,
      );

      let fetchedDistributionList;
      if (rawDistributionList == null) return true;
      fetchedDistributionList = JSON.parse(rawDistributionList);

      const generateDistributionList = await this.generateDistributionList(
        round,
        _dummyTaskState,
      );

      if (Object.keys(generateDistributionList).length === 0) {
        logger.warn('Unable to generate distribution list for comparison');
        return true;
      }

      return await this.shallowEqual(fetchedDistributionList, generateDistributionList);
    } catch (err) {
      logger.error({ err }, 'Error validating distribution');
      return true;
    }
  };

  async submitTask(roundNumber) {
    logger.info({ round: roundNumber }, 'Submitting task');
    try {
      const taskState = await namespaceWrapper.getTaskState({});
      const roundBeginSlot =
        taskState.starting_slot + roundNumber * taskState.round_time;
      const submission = await this.fetchSubmission(roundNumber);

      const currentSlot = await namespaceWrapper.getSlot();
      logger.info({ currentSlot, round: roundNumber }, 'Current slot at submission');

      // Wait for end of submission window
      const waitTime = (roundBeginSlot + taskState.submission_window - currentSlot) * 408;
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      if (submission) {
        await namespaceWrapper.checkSubmissionAndUpdateRound(
          submission,
          roundNumber,
        );
        logger.info({ round: roundNumber }, 'Task submitted');
      } else {
        logger.warn({ round: roundNumber }, 'No submission: value is null');
      }
    } catch (error) {
      logger.error({ err: error, round: roundNumber }, 'Error in submission');
    }
  }

  async auditTask(roundNumber) {
    logger.info({ round: roundNumber }, 'Auditing task');
    const slot = await namespaceWrapper.getSlot();
    logger.info({ currentSlot: slot }, 'Current slot at audit');

    await namespaceWrapper.validateAndVoteOnNodes(
      this.validateNode,
      roundNumber,
    );
  }

  async auditDistribution(roundNumber) {
    logger.info({ round: roundNumber }, 'Auditing distribution');
    await namespaceWrapper.validateAndVoteOnDistributionList(
      this.validateDistribution,
      roundNumber,
    );
  }
}

const coreLogic = new CoreLogic();
module.exports = { coreLogic };
