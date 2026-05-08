/**
 * Entry point for the Koii task node.
 *
 * Two responsibilities:
 *
 *   1. IPC handler — listens on `process.message` for round-lifecycle events
 *      dispatched by the Koii task runner and forwards each one to the
 *      matching method on `coreLogic`:
 *
 *        executeTask                       -> coreLogic.task
 *        submitPayload                     -> coreLogic.submitTask
 *        auditPayload                      -> coreLogic.auditTask
 *        generateAndSubmitDistributionList -> coreLogic.selectAndGenerateDistributionList
 *        distributionListAudit             -> coreLogic.auditDistribution
 *
 *   2. HTTP probe — exposes `GET /taskState` on the Express app provided by
 *      the namespace wrapper, returning the current task state as JSON.
 *      Useful for live debugging and dashboards.
 */
const { coreLogic } = require('./coreLogic');
const {
  namespaceWrapper,
  taskNodeAdministered,
  app,
} = require('@_koii/namespace-wrapper');
const logger = require('./lib/logger');

async function setup() {
  logger.info('Setup function called');
  await namespaceWrapper.defaultTaskSetup();

  process.on('message', m => {
    logger.info({ functionCall: m.functionCall, round: m.roundNumber }, 'IPC message received');

    switch (m.functionCall) {
      case 'executeTask':
        coreLogic.task(m.roundNumber);
        break;
      case 'submitPayload':
        coreLogic.submitTask(m.roundNumber);
        break;
      case 'auditPayload':
        coreLogic.auditTask(m.roundNumber);
        break;
      case 'generateAndSubmitDistributionList':
        coreLogic.selectAndGenerateDistributionList(
          m.roundNumber,
          m.isPreviousRoundFailed,
        );
        break;
      case 'distributionListAudit':
        coreLogic.auditDistribution(m.roundNumber, m.isPreviousRoundFailed);
        break;
      default:
        logger.warn({ functionCall: m.functionCall }, 'Unknown IPC message');
    }
  });
}

if (taskNodeAdministered) {
  setup();
}

if (app) {
  app.get('/taskState', async (req, res) => {
    const state = await namespaceWrapper.getTaskState();
    logger.info('Task state requested');
    res.status(200).json({ taskState: state });
  });
}
