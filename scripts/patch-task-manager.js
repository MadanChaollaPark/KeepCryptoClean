'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dependencyRoot = path.join(root, 'node_modules', '@_koii', 'task-manager');
const checkOnly = process.argv.includes('--check');

const patches = [
  {
    file: 'dist/main/task/audit.js',
    before: `const taskManager = yield (0, taskManager_js_1.getTaskManager)();
            const vote = yield taskManager.auditSubmission(submission_value, round, submitter_pubkey);
            return vote !== null && vote !== void 0 ? vote : true;`,
    after: `try {
                const taskManager = yield (0, taskManager_js_1.getTaskManager)();
                const vote = yield taskManager.auditSubmission(submission_value, round, submitter_pubkey);
                return vote === true;
            }
            catch (error) {
                console.error("ERROR IN VALIDATING NODE", error);
                return false;
            }`,
  },
  {
    file: 'dist/main/task/distribution.js',
    before: `if (!Object.keys(distributionList).length) {
                    return console.log("NO DISTRIBUTION LIST GENERATED");
                }`,
    after: `if (!Object.keys(distributionList).length) {
                    throw new Error("NO DISTRIBUTION LIST GENERATED");
                }`,
  },
  {
    file: 'dist/main/task/distribution.js',
    before: `if (decider) {
                    const response = yield namespace_wrapper_1.namespaceWrapper.distributionListSubmissionOnChain(round);
                    console.log("RESPONSE FROM DISTRIBUTION LIST", response);
                }`,
    after: `if (decider !== true) {
                    throw new Error("DISTRIBUTION LIST UPLOAD WAS NOT ACCEPTED");
                }
                const response = yield namespace_wrapper_1.namespaceWrapper.distributionListSubmissionOnChain(round);
                console.log("RESPONSE FROM DISTRIBUTION LIST", response);`,
  },
  {
    file: 'dist/main/task/distribution.js',
    before: `catch (err) {
                console.log("ERROR IN SUBMIT DISTRIBUTION", err);
            }`,
    after: `catch (err) {
                console.log("ERROR IN SUBMIT DISTRIBUTION", err);
                throw err;
            }`,
  },
  {
    file: 'dist/main/task/distribution.js',
    before: `if (distributionListSubmitter == null) {
                return true;
            }`,
    after: `if (distributionListSubmitter == null) {
                return false;
            }`,
  },
  {
    file: 'dist/main/task/distribution.js',
    before: `const rawDistributionList = yield namespace_wrapper_1.namespaceWrapper.getDistributionList(distributionListSubmitter, round);
                const fetchedDistributionList = JSON.parse(rawDistributionList);`,
    after: `const rawDistributionList = yield namespace_wrapper_1.namespaceWrapper.getDistributionList(distributionListSubmitter, round);
                if (typeof rawDistributionList !== "string" || Buffer.byteLength(rawDistributionList, "utf8") > 1048576) {
                    return false;
                }
                const fetchedDistributionList = JSON.parse(rawDistributionList);
                if (!fetchedDistributionList || typeof fetchedDistributionList !== "object" || Array.isArray(fetchedDistributionList)) {
                    return false;
                }`,
  },
  {
    file: 'dist/main/task/distribution.js',
    before: `if (Object.keys(generateDistributionList).length === 0) {
                    console.log("UNABLE TO GENERATE DISTRIBUTION LIST");
                    return true;
                }`,
    after: `if (Object.keys(generateDistributionList).length === 0) {
                    console.log("UNABLE TO GENERATE DISTRIBUTION LIST");
                    return false;
                }`,
  },
  {
    file: 'dist/main/task/setup.js',
    before: `        if (namespace_wrapper_1.app) {
            namespace_wrapper_1.app.get("/taskState", (_req, res) => __awaiter(this, void 0, void 0, function* () {
                const state = yield namespace_wrapper_1.namespaceWrapper.getTaskState({
                    is_submission_required: true,
                    is_distribution_required: true,
                    is_available_balances_required: true,
                    is_stake_list_required: true,
                });
                console.log("TASK STATE", state);
                res.json({ taskState: state });
            }));
        }
`,
    after: '',
  },
  {
    file: 'dist/main/task/setup.js',
    before: `        catch (error) {
            console.error("SETUP ERROR:", error);
        }`,
    after: `        catch (error) {
            console.error("SETUP ERROR:", error);
            throw error;
        }`,
  },
  {
    file: 'dist/main/task/setup.js',
    before: `        process.on("message", (m) => {
            console.log("CHILD got message:", m);
            if (!(m === null || m === void 0 ? void 0 : m.functionCall)) {
                return;
            }
            console.log(\`${'${m.functionCall}'} called\`);
            switch (m.functionCall) {
                case "submitPayload":
                    coreLogic_js_1.coreLogic.submitTask(m.roundNumber);
                    break;
                case "auditPayload":
                    coreLogic_js_1.coreLogic.auditTask(m.roundNumber);
                    break;
                case "executeTask":
                    coreLogic_js_1.coreLogic.task(m.roundNumber);
                    break;
                case "generateAndSubmitDistributionList":
                    coreLogic_js_1.coreLogic.selectAndGenerateDistributionList(m.roundNumber, m.isPreviousRoundFailed);
                    break;
                case "distributionListAudit":
                    coreLogic_js_1.coreLogic.auditDistribution(m.roundNumber);
                    break;
            }
        });`,
    after: `        let dispatchQueue = Promise.resolve();
        process.on("message", (message) => {
            dispatchQueue = dispatchQueue.then(() => dispatchMessage(message)).catch((error) => {
                console.error("TASK PHASE FAILED:", error);
            });
        });
        function dispatchMessage(message) {
            return __awaiter(this, void 0, void 0, function* () {
                if (!(message === null || message === void 0 ? void 0 : message.functionCall)) {
                    return;
                }
                if (!Number.isSafeInteger(message.roundNumber) || message.roundNumber < 0) {
                    throw new Error("INVALID TASK ROUND");
                }
                if (message.isPreviousRoundFailed !== undefined && typeof message.isPreviousRoundFailed !== "boolean") {
                    throw new Error("INVALID DISTRIBUTION FAILURE FLAG");
                }
                switch (message.functionCall) {
                    case "submitPayload":
                        yield coreLogic_js_1.coreLogic.submitTask(message.roundNumber);
                        return;
                    case "auditPayload":
                        yield coreLogic_js_1.coreLogic.auditTask(message.roundNumber);
                        return;
                    case "executeTask":
                        yield coreLogic_js_1.coreLogic.task(message.roundNumber);
                        return;
                    case "generateAndSubmitDistributionList":
                        yield coreLogic_js_1.coreLogic.selectAndGenerateDistributionList(message.roundNumber, message.isPreviousRoundFailed);
                        return;
                    case "distributionListAudit":
                        yield coreLogic_js_1.coreLogic.auditDistribution(message.roundNumber);
                        return;
                    default:
                        throw new Error("UNKNOWN TASK PHASE");
                }
            });
        }`,
  },
  {
    file: 'dist/main/index.js',
    before: 'startTask();',
    after: `startTask().catch((error) => {
    console.error("TASK STARTUP FAILED:", error);
    process.exitCode = 1;
});`,
  },
];

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
}

function patchFile(relativePath, replacements) {
  const absolutePath = path.join(dependencyRoot, relativePath);
  let contents = fs.readFileSync(absolutePath, 'utf8');
  let changed = false;

  for (const { before, after } of replacements) {
    if (contents.includes(after)) continue;
    if (checkOnly) {
      throw new Error(`${relativePath} is not patched`);
    }
    if (countOccurrences(contents, before) !== 1) {
      throw new Error(`Pinned task-manager patch no longer matches ${relativePath}`);
    }
    contents = contents.replace(before, after);
    changed = true;
  }

  if (changed) fs.writeFileSync(absolutePath, contents, 'utf8');
}

function patchTaskManager() {
  const manifestPath = path.join(dependencyRoot, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== '1.0.14') {
    throw new Error(`Unsupported @_koii/task-manager version: ${manifest.version}`);
  }

  const byFile = new Map();
  for (const patch of patches) {
    const replacements = byFile.get(patch.file) || [];
    replacements.push(patch);
    byFile.set(patch.file, replacements);
  }
  for (const [file, replacements] of byFile) patchFile(file, replacements);

  console.log(
    checkOnly
      ? 'Verified fail-closed @_koii/task-manager patch.'
      : 'Applied fail-closed @_koii/task-manager patch.',
  );
}

if (require.main === module) patchTaskManager();

module.exports = { patchTaskManager, patches };
