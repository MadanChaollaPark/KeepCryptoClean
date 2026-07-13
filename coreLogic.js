const TwitterTask = require('./twitter-task');
const logger = require('./lib/logger');
const {
  buildDistributionFromSubmitters,
  equalDistributionLists,
  isDistributionList,
  submittersFromTaskState,
} = require('./lib/distribution');

class CoreLogic {
  constructor(options = {}) {
    this.namespaceWrapper = options.namespaceWrapper || null;
    this.TaskClass = options.TaskClass || TwitterTask;
    this.taskOptions = options.taskOptions || {};
    this.twitterTask = null;
    this._transition = Promise.resolve();
  }

  _namespace() {
    if (!this.namespaceWrapper) {
      this.namespaceWrapper =
        require('@_koii/namespace-wrapper').namespaceWrapper;
    }
    return this.namespaceWrapper;
  }

  /** Serialize round changes so two provider sessions cannot overlap. */
  async task(roundNumber) {
    this._transition = this._transition
      .catch(() => undefined)
      .then(() => this._replaceTask(roundNumber));
    return this._transition;
  }

  async _replaceTask(roundNumber) {
    if (!Number.isSafeInteger(roundNumber) || roundNumber < 0) {
      throw new TypeError('roundNumber must be a non-negative safe integer');
    }
    const previous = this.twitterTask;
    this.twitterTask = null;
    if (previous && typeof previous.stop === 'function') {
      await previous.stop();
    }

    const next = new this.TaskClass(roundNumber, this.taskOptions);
    try {
      if (typeof next.ready === 'function') await next.ready();
      this.twitterTask = next;
      logger.info({ round: roundNumber }, 'Round evidence task ready');
      return true;
    } catch (error) {
      if (typeof next.stop === 'function') {
        try {
          await next.stop();
        } catch (stopError) {
          logger.error({ err: stopError }, 'Failed to clean up unready task');
        }
      }
      logger.error(
        { err: error, round: roundNumber },
        'Round initialization failed',
      );
      throw error;
    }
  }

  async fetchSubmission(roundNumber) {
    const task = this.twitterTask;
    if (!task || task.round !== roundNumber) return undefined;
    try {
      if (typeof task.ready === 'function') await task.ready();
      const cid = await task.getRoundCID(roundNumber);
      return typeof cid === 'string' && cid.length > 0 ? cid : undefined;
    } catch (error) {
      logger.error(
        { err: error, round: roundNumber },
        'Submission generation failed',
      );
      return undefined;
    }
  }

  validateNode = async (submissionValue, round, submitterPublicKey) => {
    const task = this.twitterTask;
    if (!task || task.round !== round) return false;
    try {
      if (typeof task.ready === 'function') await task.ready();
      return (
        (await task.validate(submissionValue, round, submitterPublicKey)) ===
        true
      );
    } catch (error) {
      logger.error({ err: error, round }, 'Node validation failed closed');
      return false;
    }
  };

  /** Current @_koii/task-manager distribution callback. */
  async generateDistributionForSubmitters(submitters, bounty, _round) {
    return buildDistributionFromSubmitters(submitters, bounty);
  }

  /** Legacy namespace-wrapper distribution callback retained for old runners. */
  async generateDistributionList(round, providedTaskState) {
    try {
      const wrapper = this._namespace();
      const submissionInfo = await wrapper.getTaskSubmissionInfo(round);
      const submissions = submissionInfo?.submissions?.[round];
      const auditTriggers = submissionInfo?.submissions_audit_trigger?.[round];
      if (!submissions) return {};
      const submitters = submittersFromTaskState(submissions, auditTriggers);
      if (!submitters) return {};
      const taskState =
        providedTaskState ||
        (await wrapper.getTaskState({ is_stake_list_required: true }));
      return buildDistributionFromSubmitters(
        submitters,
        taskState?.bounty_amount_per_round,
      );
    } catch (error) {
      logger.error(
        { err: error, round },
        'Distribution generation failed closed',
      );
      return {};
    }
  }

  async shallowEqual(left, right) {
    return equalDistributionLists(left, right);
  }

  validateDistribution = async (
    distributionListSubmitter,
    round,
    _list,
    taskState,
  ) => {
    try {
      if (
        typeof distributionListSubmitter !== 'string' ||
        !distributionListSubmitter
      )
        return false;
      const raw = await this._namespace().getDistributionList(
        distributionListSubmitter,
        round,
      );
      if (
        typeof raw !== 'string' ||
        Buffer.byteLength(raw, 'utf8') > 1024 * 1024
      )
        return false;
      const fetched = JSON.parse(raw);
      if (!isDistributionList(fetched)) return false;
      const expected = await this.generateDistributionList(round, taskState);
      return equalDistributionLists(fetched, expected);
    } catch (error) {
      logger.error(
        { err: error, round },
        'Distribution validation failed closed',
      );
      return false;
    }
  };

  submitDistributionList = async round => {
    const distributionList = await this.generateDistributionList(round);
    if (!Object.keys(distributionList).length) {
      throw new Error('NO DISTRIBUTION LIST GENERATED');
    }
    const wrapper = this._namespace();
    const decider = await wrapper.uploadDistributionList(
      distributionList,
      round,
    );
    if (decider !== true) {
      throw new Error('DISTRIBUTION LIST UPLOAD WAS NOT ACCEPTED');
    }
    const response = await wrapper.distributionListSubmissionOnChain(round);
    if (typeof response !== 'string' || !response.trim()) {
      throw new Error('DISTRIBUTION LIST ON-CHAIN SUBMISSION FAILED');
    }
    return true;
  };

  async selectAndGenerateDistributionList(
    round,
    isPreviousRoundFailed = false,
  ) {
    return this._namespace().selectAndGenerateDistributionList(
      this.submitDistributionList,
      round,
      isPreviousRoundFailed,
    );
  }

  async submitTask(roundNumber) {
    const submission = await this.fetchSubmission(roundNumber);
    if (!submission) return false;
    await this._namespace().checkSubmissionAndUpdateRound(
      submission,
      roundNumber,
    );
    return true;
  }

  async auditTask(roundNumber) {
    return this._namespace().validateAndVoteOnNodes(
      this.validateNode,
      roundNumber,
    );
  }

  async auditDistribution(roundNumber) {
    return this._namespace().validateAndVoteOnDistributionList(
      this.validateDistribution,
      roundNumber,
    );
  }

  async shutdown() {
    await this._transition.catch(() => undefined);
    const task = this.twitterTask;
    this.twitterTask = null;
    if (task && typeof task.stop === 'function') await task.stop();
  }
}

const coreLogic = new CoreLogic();
module.exports = { CoreLogic, coreLogic };
