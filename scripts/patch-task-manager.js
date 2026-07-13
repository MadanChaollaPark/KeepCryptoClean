'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dependencyRoot = path.join(
  root,
  'node_modules',
  '@_koii',
  'task-manager',
);
const namespaceWrapperRoot = path.join(
  root,
  'node_modules',
  '@_koii',
  'namespace-wrapper',
);
const storageSdkRoot = path.join(
  root,
  'node_modules',
  '@_koii',
  'storage-task-sdk',
);
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
                if ((namespace_wrapper_1.taskNodeAdministered && (typeof response !== "string" || !response.trim())) ||
                    (!namespace_wrapper_1.taskNodeAdministered && response !== undefined)) {
                    throw new Error("DISTRIBUTION LIST ON-CHAIN SUBMISSION FAILED");
                }
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
    forbiddenAfter: 'app.get("/taskState"',
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
    before: `        if (!namespace_wrapper_1.taskNodeAdministered) {
            namespace_wrapper_1.app.use((req, _res, next) => {
                const directories = req.url.split("/");
                req.url = \`/${'${directories.slice(3).join("/")}'}\`;
                next();
            });
        }
`,
    after: '',
    forbiddenAfter: 'directories.slice(3)',
  },
  {
    file: 'dist/main/index.js',
    before: 'startTask();',
    after: `startTask().catch((error) => {
    console.error("TASK STARTUP FAILED:", error);
    process.exitCode = 1;
    const forceExit = setTimeout(() => process.exit(1), 1000);
    forceExit.unref();
    if (namespace_wrapper_1._server && typeof namespace_wrapper_1._server.close === "function") {
        namespace_wrapper_1._server.close(() => process.exit(1));
    }
    else {
        process.exit(1);
    }
});`,
  },
];

const namespaceWrapperPatches = [
  {
    file: 'dist/index.js',
    before: `app.use(body_parser_1.default.urlencoded({ limit: '50mb', extended: false }));
app.use(body_parser_1.default.json({ limit: '50mb' }));`,
    after: `app.use(body_parser_1.default.urlencoded({ limit: '16kb', extended: false }));
app.use(body_parser_1.default.json({ limit: '16kb' }));`,
  },
  {
    file: 'dist/index.js',
    before: `const _server = app.listen(EXPRESS_PORT, () => {
    console.log(\`${'${TASK_NAME}'} listening on port ${'${EXPRESS_PORT}'}\`);
});`,
    after: `const EXPRESS_HOST = process.env.KCC_STATUS_HOST || "127.0.0.1";
const _server = app.listen(EXPRESS_PORT, EXPRESS_HOST, () => {
    console.log(\`${'${TASK_NAME}'} listening on ${'${EXPRESS_HOST}'}:${'${EXPRESS_PORT}'}\`);
});`,
  },
  {
    file: 'dist/index.js',
    before: `            const response = yield axios_1.default.post(BASE_ROOT_URL, {
                args,
                taskId: TASK_ID,
                secret: SECRET_KEY,
            });
            if (response.status === 200) {
                return response.data.response;
            }
            else {
                console.error(response.status, response.data);
                return { error: response.data };
            }
        }
        catch (err) {
            console.error(\`Error in genericHandler: "${'${args[0]}'}"\`, err.message);
            console.error((_a = err === null || err === void 0 ? void 0 : err.response) === null || _a === void 0 ? void 0 : _a.data);
            return { error: err };
        }`,
    after: `            const response = yield axios_1.default.post(BASE_ROOT_URL, {
                args,
                taskId: TASK_ID,
                secret: SECRET_KEY,
            }, {
                timeout: 30000,
                maxContentLength: 1048576,
                maxBodyLength: 1048576,
            });
            if (response.status !== 200) {
                throw new Error("TASK NODE RPC RETURNED A NON-200 STATUS");
            }
            const result = response.data === null || response.data === void 0 ? void 0 : response.data.response;
            if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "error")) {
                throw new Error("TASK NODE RPC RETURNED AN ERROR");
            }
            return result;
        }
        catch (err) {
            console.error(\`Task-node RPC failed: "${'${args[0]}'}"\`);
            const failure = new Error(\`Task-node RPC failed: ${'${args[0]}'}\`);
            failure.code = err === null || err === void 0 ? void 0 : err.code;
            throw failure;
        }`,
  },
  {
    file: 'dist/index.js',
    before: `                    const bincode_js = yield Promise.resolve().then(() => __importStar(require(
                    /* webpackIgnore: true */
                    '../webasm_bincode_deserializer/bincode_js')));
                    const borsh_bpf_js_deserialize = bincode_js.borsh_bpf_js_deserialize;
                    try {
                        const accountInfo = yield connection.getAccountInfo(new web3_js_1.PublicKey(taskId));
                        if (!accountInfo) {
                            console.error('Error in getting task account info');
                            return null;
                        }
                        const buffer = accountInfo.data;
                        const taskState = borsh_bpf_js_deserialize(buffer);
                        return parseTaskState(taskState, is_submission_required, is_distribution_required, is_available_balances_required, is_stake_list_required);
                    }
                    catch (error) {
                        console.error('Error in fetching task state', error);
                        return null;
                    }`,
    after: `                    throw new Error("KPL TASK-STATE DECODING IS NOT SUPPORTED BY THIS KOII-ONLY TASK");`,
    forbiddenAfter: 'webasm_bincode_deserializer',
  },
];

const storageSdkPatches = [
  {
    file: 'build/index.js',
    before: `        this.debug = debug;
        this.watchTaskState();`,
    after: `        this.debug = debug;
        // KeepCryptoClean uses only this exact pinned storage-node trust set.
        // Do not start the SDK's permanent task-state polling interval.
        this.taskState = {};`,
  },
  {
    file: 'build/index.js',
    before: `    uploadFile(file, stakingWallet) {`,
    after: `    uploadFile(file, stakingWallet, options) {`,
  },
  {
    file: 'build/index.js',
    before: `                        method: 'POST',
                        body: formData,`,
    after: `                        method: 'POST',
                        body: formData,
                        signal: options && options.signal,`,
  },
  {
    file: 'build/index.js',
    before: `    getFile(cid, filename) {`,
    after: `    getFile(cid, filename, options) {`,
  },
  {
    file: 'build/index.js',
    before: `                    response = yield this.fetchWithTimeout(\`${'${nodeUrl}'}/task/${'${this.storageTaskId}'}/ipfs/${'${cid}'}/${'${filename}'}\`);`,
    after: `                    response = yield this.fetchWithTimeout(\`${'${nodeUrl}'}/task/${'${this.storageTaskId}'}/ipfs/${'${cid}'}/${'${filename}'}\`, {
                        signal: options && options.signal,
                    });`,
  },
  {
    file: 'build/index.js',
    before: `        const signal = controller.signal;`,
    after: `        const externalSignal = options && options.signal;
        const signal = externalSignal
            ? AbortSignal.any([controller.signal, externalSignal])
            : controller.signal;`,
  },
  {
    file: 'build/index.js',
    before: `                    if (!response.ok) {
                        if (this.debug)
                            console.error(response.status, response.statusText);
                        let responseText = yield response.text();
                        throw new Error(\`Failed to upload file ${'${response.status}'} - ${'${response.statusText}'} - ${'${responseText}'}\`);
                    }
                    return yield response.json();`,
    after: `                    if (!response.ok) {
                        yield this.readLimitedResponse(response, 65536).catch(() => Buffer.alloc(0));
                        throw new Error(\`Failed to upload file ${'${response.status}'}\`);
                    }
                    const responseBytes = yield this.readLimitedResponse(response, 65536);
                    return JSON.parse(responseBytes.toString("utf8"));`,
  },
  {
    file: 'build/index.js',
    before: `                    if (!response.ok) {
                        if (this.debug)
                            console.error(response.status, response.statusText);
                        throw new Error('Failed to fetch file from node');
                    }
                    const data = yield response.blob();
                    return data;`,
    after: `                    if (!response.ok) {
                        yield this.readLimitedResponse(response, 65536).catch(() => Buffer.alloc(0));
                        throw new Error('Failed to fetch file from node');
                    }
                    const data = yield this.readLimitedResponse(response, 1048576);
                    return new Blob([data]);`,
  },
  {
    file: 'build/index.js',
    before: `    signingFileHash(fileHash, stakingWallet) {`,
    after: `    async readLimitedResponse(response, maxBytes) {
        const declaredLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
            if (response.body && typeof response.body.cancel === "function") await response.body.cancel();
            clearTimeout(response.__koiiTimeoutId);
            throw new Error("Storage response exceeded the byte limit");
        }
        const reader = response.body && typeof response.body.getReader === "function"
            ? response.body.getReader()
            : null;
        if (!reader) {
            clearTimeout(response.__koiiTimeoutId);
            throw new Error("Storage response did not expose a bounded stream");
        }
        const chunks = [];
        let total = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value.byteLength;
                if (total > maxBytes) {
                    await reader.cancel();
                    throw new Error("Storage response exceeded the byte limit");
                }
                chunks.push(Buffer.from(value));
            }
            return Buffer.concat(chunks, total);
        }
        finally {
            clearTimeout(response.__koiiTimeoutId);
        }
    }
    signingFileHash(fileHash, stakingWallet) {`,
  },
  {
    file: 'build/index.js',
    before: `    getNodesRunningTask(count) {
        return __awaiter(this, void 0, void 0, function* () {`,
    after: `    getNodesRunningTask(count) {
        return __awaiter(this, void 0, void 0, function* () {
            // On-chain node URLs are untrusted network input. Restrict this
            // task to the exact pinned HTTPS trust set to prevent SSRF.
            return this.trustedNodes.slice(0, Math.max(1, Math.min(count, this.trustedNodes.length)));`,
  },
  {
    file: 'build/index.js',
    before: `        return fetch(url, Object.assign(Object.assign({}, options), { signal })).finally(() => clearTimeout(id));`,
    after: `        return fetch(url, Object.assign(Object.assign({}, options), { signal, redirect: "error" })).then((response) => {
            Object.defineProperty(response, "__koiiTimeoutId", {
                value: id,
                configurable: true,
            });
            return response;
        }, (error) => {
            clearTimeout(id);
            throw error;
        });`,
  },
];

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
}

function patchFile(baseRoot, relativePath, replacements) {
  const absolutePath = path.join(baseRoot, relativePath);
  let contents = fs.readFileSync(absolutePath, 'utf8');
  let changed = false;

  for (const { before, after } of replacements) {
    const alreadyPatched =
      after === '' ? !contents.includes(before) : contents.includes(after);
    if (alreadyPatched) continue;
    if (checkOnly) {
      throw new Error(`${relativePath} is not patched`);
    }
    if (countOccurrences(contents, before) !== 1) {
      throw new Error(
        `Pinned task-manager patch no longer matches ${relativePath}`,
      );
    }
    contents = contents.replace(before, after);
    changed = true;
  }

  for (const { forbiddenAfter } of replacements) {
    if (forbiddenAfter && contents.includes(forbiddenAfter)) {
      throw new Error(
        `${relativePath} still contains forbidden code: ${forbiddenAfter}`,
      );
    }
  }

  if (changed) fs.writeFileSync(absolutePath, contents, 'utf8');
}

function patchTaskManager() {
  const manifestPath = path.join(dependencyRoot, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== '1.0.14') {
    throw new Error(
      `Unsupported @_koii/task-manager version: ${manifest.version}`,
    );
  }
  const namespaceManifest = JSON.parse(
    fs.readFileSync(path.join(namespaceWrapperRoot, 'package.json'), 'utf8'),
  );
  if (namespaceManifest.version !== '1.0.23') {
    throw new Error(
      `Unsupported @_koii/namespace-wrapper version: ${namespaceManifest.version}`,
    );
  }
  const storageManifest = JSON.parse(
    fs.readFileSync(path.join(storageSdkRoot, 'package.json'), 'utf8'),
  );
  if (storageManifest.version !== '1.2.8') {
    throw new Error(
      `Unsupported @_koii/storage-task-sdk version: ${storageManifest.version}`,
    );
  }

  const byFile = new Map();
  for (const patch of patches) {
    const replacements = byFile.get(patch.file) || [];
    replacements.push(patch);
    byFile.set(patch.file, replacements);
  }
  for (const [file, replacements] of byFile) {
    patchFile(dependencyRoot, file, replacements);
  }

  const namespaceByFile = new Map();
  for (const patch of namespaceWrapperPatches) {
    const replacements = namespaceByFile.get(patch.file) || [];
    replacements.push(patch);
    namespaceByFile.set(patch.file, replacements);
  }
  for (const [file, replacements] of namespaceByFile) {
    patchFile(namespaceWrapperRoot, file, replacements);
  }

  const storageByFile = new Map();
  for (const patch of storageSdkPatches) {
    const replacements = storageByFile.get(patch.file) || [];
    replacements.push(patch);
    storageByFile.set(patch.file, replacements);
  }
  for (const [file, replacements] of storageByFile) {
    patchFile(storageSdkRoot, file, replacements);
  }

  console.log(
    checkOnly
      ? 'Verified fail-closed Koii dependency patches.'
      : 'Applied fail-closed Koii dependency patches.',
  );
}

if (require.main === module) patchTaskManager();

module.exports = {
  namespaceWrapperPatches,
  patchTaskManager,
  patches,
  storageSdkPatches,
};
