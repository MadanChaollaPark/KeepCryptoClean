const { initializeTaskManager } = require('@_koii/task-manager');
const { app, namespaceWrapper } = require('@_koii/task-manager/namespace-wrapper');
const { coreLogic } = require('./coreLogic');
const logger = require('./lib/logger');

let lifecycle = Promise.resolve();

function serialize(name, handler, failValue) {
  return (...args) => {
    const run = lifecycle.then(() => handler(...args));
    lifecycle = run.catch(error => {
      logger.error({ err: error, phase: name }, 'Lifecycle phase failed');
    });
    return run.catch(error => {
      if (failValue !== undefined) return failValue;
      throw error;
    });
  };
}

const callbacks = {
  setup: async () => {
    logger.info('KeepCryptoClean observer initialized');
  },
  task: serialize('task', round => coreLogic.task(round)),
  submission: serialize('submission', round => coreLogic.fetchSubmission(round)),
  audit: serialize('audit', (submission, round) => coreLogic.validateNode(submission, round), false),
  distribution: serialize(
    'distribution',
    (submitters, bounty, round) =>
      coreLogic.generateDistributionForSubmitters(submitters, bounty, round),
    {},
  ),
  routes: async () => {
    if (!app) return;
    app.get('/healthz', (_req, res) => {
      res.status(200).json({ status: 'ok' });
    });
    app.get('/readyz', (_req, res) => {
      const task = coreLogic.twitterTask;
      const ready = Boolean(task && !task.initializationError && !task.runError);
      res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not-ready' });
    });
    app.get('/taskState', async (_req, res) => {
      try {
        const state = await namespaceWrapper.getTaskState({});
        if (!state) return res.status(503).json({ error: 'Task state unavailable' });
        return res.status(200).json({ taskState: state });
      } catch (error) {
        logger.error({ err: error }, 'Task state route failed');
        return res.status(503).json({ error: 'Task state unavailable' });
      }
    });
  },
};

initializeTaskManager(callbacks);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down task');
  try {
    await coreLogic.shutdown();
  } catch (error) {
    logger.error({ err: error }, 'Shutdown cleanup failed');
    process.exitCode = 1;
  }
}

function handleSignal(signal) {
  shutdown(signal).finally(() => process.exit(process.exitCode || 0));
}

process.once('SIGINT', () => handleSignal('SIGINT'));
process.once('SIGTERM', () => handleSignal('SIGTERM'));

module.exports = { callbacks, serialize, shutdown };
