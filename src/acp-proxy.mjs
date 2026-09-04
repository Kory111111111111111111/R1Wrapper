import { appendFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "./config.mjs";
import {
  buildAuthenticateSuccessResponse,
  buildBackendAuthRequest,
  buildPermissionAllowOnceResponse,
  buildSetModelRequest,
  getMessageId,
  getMessageMethod,
  isBackendAuthResponse,
  isBackendSetModelResponse,
  isInitializeResponse,
  isSessionNewResponse,
  isSetModelIdSupported,
  parseJsonLine,
  resolveAcpModelId,
  rewriteInitializeResult,
  rewriteSessionNewModel,
  rewriteSessionNewParams,
  serializeJsonLine,
  shouldQueueForSessionReady,
  shouldQueueUntilBackendReady,
} from "./acp-messages.mjs";

export const PROXY_VERSION = "0.20.6-r1wrapper";
const DEFAULT_SET_MODEL_TIMEOUT_MS = 10_000;
const DEFAULT_LOGIN_TIMEOUT_MS = 30_000;

function readTimeoutMs(envKey, fallback) {
  const raw = process.env[envKey];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * @param {string} message
 * @param {string} logFile
 */
export function logLine(message, logFile) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    mkdirSync(join(logFile, ".."), { recursive: true });
    appendFileSync(logFile, line, "utf8");
  } catch {
    // Logging must not break the proxy.
  }
  process.stderr.write(line);
}

/**
 * @param {import('./types.mjs').ProxyConfig} config
 */
export function resolveAgentCommand(config) {
  if (process.env.R1WRAPPER_AGENT_CMD) {
    return process.env.R1WRAPPER_AGENT_CMD;
  }

  if (config.backend === "cursor" && config.agentCommand === "agent") {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(localAppData, "cursor-agent", "agent.cmd");
  }

  return config.agentCommand;
}

/**
 * @param {import('./types.mjs').ProxyConfig} config
 */
export function createBackendProcess(config) {
  const command = resolveAgentCommand(config);
  const args = config.agentArgs;

  if (process.platform === "win32") {
    const comspec = process.env.ComSpec ?? "cmd.exe";
    return spawn(comspec, ["/d", "/s", "/c", command, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      env: process.env,
    });
  }

  return spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    env: process.env,
  });
}

/**
 * @param {unknown} message
 * @param {import('./types.mjs').ProxyConfig} config
 * @param {(line: string) => void} log
 */
export function transformClientRequest(message, config, log) {
  const method = getMessageMethod(message);
  const id = getMessageId(message);

  if (method === "authenticate" && id !== undefined) {
    log(`intercept client authenticate id=${id}`);
    return {
      intercept: true,
      clientResponse: buildAuthenticateSuccessResponse(id),
    };
  }

  if (!method) {
    return { intercept: false, forward: message };
  }

  const params =
    message && typeof message === "object" && "params" in message
      ? /** @type {Record<string, unknown>} */ (message).params
      : undefined;

  if (method === "session/new" && params && typeof params === "object") {
    const rewritten = rewriteSessionNewParams(params, config);
    log(`rewrite session/new cwd -> ${rewritten.cwd}`);
    return {
      intercept: false,
      forward: { .../** @type {object} */ (message), params: rewritten },
    };
  }

  return { intercept: false, forward: message };
}

/**
 * @param {unknown} message
 * @param {import('./types.mjs').ProxyConfig} config
 * @param {(line: string) => void} log
 */
export function transformBackendToClient(message, config, log) {
  const method = getMessageMethod(message);
  const id = getMessageId(message);

  if (method === "session/request_permission" && config.autoApprovePermissions && id !== undefined) {
    log(`auto-approve permission id=${id}`);
    return {
      clientMessage: null,
      backendResponse: buildPermissionAllowOnceResponse(id),
    };
  }

  if (isInitializeResponse(message)) {
    const result = /** @type {Record<string, unknown>} */ (message).result;
    const rewritten = rewriteInitializeResult(result, config);
    log("rewrite initialize response for Rabbit");
    return {
      clientMessage: { .../** @type {object} */ (message), result: rewritten },
      backendResponse: null,
      triggerBackendAuth: config.authMethod === "cursor_login",
      triggerBackendReady: config.authMethod === "none",
    };
  }

  if (id !== undefined && message && typeof message === "object" && "error" in message) {
    const error = /** @type {Record<string, unknown>} */ (message).error;
    const text = JSON.stringify(error);
    if (text.includes("Authentication required")) {
      log(`backend auth error forwarded to client id=${id}: ${text}`);
    }
  }

  return {
    clientMessage: message,
    backendResponse: null,
    triggerBackendAuth: false,
    triggerBackendReady: false,
  };
}

/**
 * @param {import('node:stream').Readable} input
 * @param {import('node:stream').Writable} output
 * @param {import('node:child_process').ChildProcess} backend
 * @param {import('./types.mjs').ProxyConfig} config
 * @param {(line: string) => void} log
 */
export function pipeAcpProxy(input, output, backend, config, log) {
  if (!backend.stdin || !backend.stdout) {
    throw new Error("Backend process missing stdio pipes");
  }

  let clientBuffer = "";
  let backendBuffer = "";
  let backendReady = false;
  /** @type {number | string | null} */
  let pendingSessionNewRequestId = null;
  /** @type {unknown[]} */
  const queuedClientMessages = [];
  /** @type {unknown[]} */
  const queuedUntilSessionReady = [];
  /** @type {{ message: unknown, modelId: string } | null} */
  let pendingSessionNewDelivery = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let setModelTimeout = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let loginTimeout = null;

  const setModelTimeoutMs = readTimeoutMs("R1WRAPPER_SET_MODEL_TIMEOUT_MS", DEFAULT_SET_MODEL_TIMEOUT_MS);
  const loginTimeoutMs = readTimeoutMs("R1WRAPPER_LOGIN_TIMEOUT_MS", DEFAULT_LOGIN_TIMEOUT_MS);

  const clearLoginTimeout = () => {
    if (loginTimeout) {
      clearTimeout(loginTimeout);
      loginTimeout = null;
    }
  };

  const rejectQueuedMessages = (queue, reason) => {
    while (queue.length > 0) {
      const queued = queue.shift();
      const id = getMessageId(queued);
      if (id === undefined) {
        continue;
      }
      writeToClient({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: reason },
      });
    }
  };

  const scheduleLoginTimeout = () => {
    clearLoginTimeout();
    loginTimeout = setTimeout(() => {
      if (backendReady) {
        return;
      }
      log(`backend auth timed out after ${loginTimeoutMs}ms`);
      rejectQueuedMessages(queuedClientMessages, "Backend login timed out");
    }, loginTimeoutMs);
  };

  const clearSetModelTimeout = () => {
    if (setModelTimeout) {
      clearTimeout(setModelTimeout);
      setModelTimeout = null;
    }
  };

  const flushQueuedUntilSessionReady = () => {
    while (queuedUntilSessionReady.length > 0) {
      const queued = queuedUntilSessionReady.shift();
      if (!queued) {
        continue;
      }
      handleClientMessage(queued);
    }
  };

  const writeToBackend = (message) => {
    if (!backend.stdin?.writable) {
      log("backend stdin closed; dropped message");
      return;
    }
    try {
      backend.stdin.write(serializeJsonLine(message));
    } catch (error) {
      log(`backend write error: ${/** @type {Error} */ (error).message}`);
    }
  };

  const writeToClient = (message) => {
    if (!output.writable) {
      return;
    }
    try {
      output.write(serializeJsonLine(message));
    } catch (error) {
      log(`client write error: ${/** @type {Error} */ (error).message}`);
    }
  };

  const trackSessionNewRequest = (message) => {
    if (getMessageMethod(message) === "session/new") {
      pendingSessionNewRequestId = getMessageId(message) ?? null;
    }
  };

  const forwardToBackend = (message) => {
    trackSessionNewRequest(message);
    writeToBackend(message);
  };

  const flushQueuedClientMessages = () => {
    while (queuedClientMessages.length > 0) {
      const queued = queuedClientMessages.shift();
      if (!queued) {
        continue;
      }
      const transformed = transformClientRequest(queued, config, log);
      if (transformed.intercept && transformed.clientResponse) {
        writeToClient(transformed.clientResponse);
      } else if (transformed.forward) {
        forwardToBackend(transformed.forward);
      }
    }
  };

  const handleClientMessage = (message) => {
    const method = getMessageMethod(message);
    const transformed = transformClientRequest(message, config, log);
    if (transformed.intercept && transformed.clientResponse) {
      writeToClient(transformed.clientResponse);
      return;
    }

    if (!backendReady && shouldQueueUntilBackendReady(message)) {
      log(`queue client request until backend ready: ${method}`);
      queuedClientMessages.push(message);
      return;
    }

    if (pendingSessionNewDelivery && shouldQueueForSessionReady(message)) {
      log(`queue client request until session/new delivered: ${method}`);
      queuedUntilSessionReady.push(message);
      return;
    }

    if (method) {
      log(`client -> backend: ${method}`);
    }

    if (transformed.forward) {
      forwardToBackend(transformed.forward);
    }
  };

  const deliverPendingSessionNew = (setModelError) => {
    if (!pendingSessionNewDelivery) {
      return;
    }

    clearSetModelTimeout();

    const { message: pendingMessage, modelId } = pendingSessionNewDelivery;
    pendingSessionNewDelivery = null;

    if (setModelError) {
      log(`session/set_model failed: ${JSON.stringify(setModelError)}; forwarding session/new unchanged`);
      writeToClient(pendingMessage);
      flushQueuedUntilSessionReady();
      return;
    }

    const pendingResult =
      pendingMessage && typeof pendingMessage === "object" && "result" in pendingMessage
        ? /** @type {Record<string, unknown>} */ (pendingMessage).result
        : undefined;
    const rewritten = rewriteSessionNewModel(pendingResult, modelId);
    writeToClient({ .../** @type {object} */ (pendingMessage), result: rewritten });
    log(`session model set -> ${modelId}`);
    flushQueuedUntilSessionReady();
  };

  const scheduleSetModelTimeout = () => {
    clearSetModelTimeout();
    setModelTimeout = setTimeout(() => {
      if (!pendingSessionNewDelivery) {
        return;
      }
      log(`session/set_model timed out after ${setModelTimeoutMs}ms; forwarding session/new`);
      deliverPendingSessionNew(null);
    }, setModelTimeoutMs);
  };

  const deliverSessionNewToClient = (message, modelId, skippedSetModel) => {
    const pendingResult =
      message && typeof message === "object" && "result" in message
        ? /** @type {Record<string, unknown>} */ (message).result
        : undefined;
    const rewritten = rewriteSessionNewModel(pendingResult, modelId);
    writeToClient({ .../** @type {object} */ (message), result: rewritten });
    if (skippedSetModel) {
      log(`session already on model ${modelId}; skipped set_model`);
    } else {
      log(`session model set -> ${modelId}`);
    }
    flushQueuedUntilSessionReady();
  };

  const handleBackendMessage = (message) => {
    if (isBackendAuthResponse(message)) {
      clearLoginTimeout();
      if (message && typeof message === "object" && "error" in message) {
        log(`cursor_login failed: ${JSON.stringify(message)}`);
        backendReady = false;
        rejectQueuedMessages(queuedClientMessages, "Cursor login failed");
        return;
      }
      log("cursor_login succeeded");
      backendReady = true;
      flushQueuedClientMessages();
      return;
    }

    if (isBackendSetModelResponse(message)) {
      const setModelError =
        message && typeof message === "object" && "error" in message
          ? /** @type {Record<string, unknown>} */ (message).error
          : null;
      deliverPendingSessionNew(setModelError);
      return;
    }

    if (
      isSessionNewResponse(message, pendingSessionNewRequestId) &&
      config.defaultModel
    ) {
      pendingSessionNewRequestId = null;
      const result = /** @type {Record<string, unknown>} */ (message).result;
      const availableModels =
        result.models &&
        typeof result.models === "object" &&
        "availableModels" in result.models &&
        Array.isArray(result.models.availableModels)
          ? /** @type {Array<{ modelId?: string }>} */ (result.models.availableModels)
          : undefined;
      const currentModelId =
        result.models &&
        typeof result.models === "object" &&
        "currentModelId" in result.models &&
        typeof result.models.currentModelId === "string"
          ? result.models.currentModelId
          : undefined;
      const modelId = resolveAcpModelId(
        config.defaultModel,
        availableModels,
        config.defaultModelParameters,
      );

      if (!isSetModelIdSupported(modelId, availableModels)) {
        log(`resolved model ${modelId} is not supported by backend; forwarding session/new unchanged`);
        writeToClient(message);
        flushQueuedUntilSessionReady();
        return;
      }

      if (currentModelId === modelId) {
        deliverSessionNewToClient(message, modelId, true);
        return;
      }

      pendingSessionNewDelivery = { message, modelId };
      log(`forcing session model -> ${modelId}`);
      writeToBackend(buildSetModelRequest(String(result.sessionId), modelId));
      scheduleSetModelTimeout();
      return;
    }

    const backendMethod = getMessageMethod(message);
    if (backendMethod) {
      log(`backend -> client: ${backendMethod}`);
    }

    const transformed = transformBackendToClient(message, config, log);
    if (transformed.backendResponse) {
      writeToBackend(transformed.backendResponse);
    }
    if (transformed.clientMessage) {
      writeToClient(transformed.clientMessage);
    }
    if (transformed.triggerBackendAuth) {
      log("requesting cursor_login on backend");
      writeToBackend(buildBackendAuthRequest());
      scheduleLoginTimeout();
      return;
    }

    if (transformed.triggerBackendReady) {
      log(`backend ${config.backend} ready (no login required)`);
      backendReady = true;
      flushQueuedClientMessages();
    }
  };

  input.on("data", (chunk) => {
    clientBuffer += chunk.toString();
    let newlineIndex = clientBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = clientBuffer.slice(0, newlineIndex);
      clientBuffer = clientBuffer.slice(newlineIndex + 1);
      try {
        const message = parseJsonLine(line);
        if (!message) {
          newlineIndex = clientBuffer.indexOf("\n");
          continue;
        }
        handleClientMessage(message);
      } catch (error) {
        log(`client parse error: ${/** @type {Error} */ (error).message}`);
      }
      newlineIndex = clientBuffer.indexOf("\n");
    }
  });

  backend.stdout.on("data", (chunk) => {
    backendBuffer += chunk.toString();
    let newlineIndex = backendBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = backendBuffer.slice(0, newlineIndex);
      backendBuffer = backendBuffer.slice(newlineIndex + 1);
      try {
        const message = parseJsonLine(line);
        if (!message) {
          newlineIndex = backendBuffer.indexOf("\n");
          continue;
        }
        handleBackendMessage(message);
      } catch (error) {
        log(`backend parse error: ${/** @type {Error} */ (error).message}`);
      }
      newlineIndex = backendBuffer.indexOf("\n");
    }
  });

  backend.stderr?.on("data", (chunk) => {
    log(`backend stderr: ${chunk.toString().trim()}`);
  });

  backend.on("exit", (code, signal) => {
    clearSetModelTimeout();
    clearLoginTimeout();
    if (queuedClientMessages.length > 0) {
      log(`backend exited with ${queuedClientMessages.length} queued client request(s) before backend ready`);
      rejectQueuedMessages(queuedClientMessages, "Backend exited before ready");
    }
    if (queuedUntilSessionReady.length > 0) {
      log(`backend exited with ${queuedUntilSessionReady.length} queued client request(s) before session/new delivery`);
      rejectQueuedMessages(queuedUntilSessionReady, "Backend exited before session/new delivery");
    }
    if (pendingSessionNewDelivery) {
      log("backend exited before session/set_model completed; forwarding held session/new response");
      deliverPendingSessionNew(null);
    }
    log(`backend exited code=${code} signal=${signal ?? ""}`);
    output.end();
  });

  input.on("end", () => {
    backend.stdin.end();
  });
}

function printCheckResult() {
  process.stdout.write("r1wrapper acp proxy: ok\n");
}

function printVersion() {
  process.stdout.write(`${PROXY_VERSION}\n`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--version")) {
    printVersion();
    return;
  }
  if (args.includes("--check")) {
    printCheckResult();
    return;
  }

  const config = loadConfig();
  const logFile = join(config.logDir, "acp-proxy.log");
  const log = (message) => logLine(message, logFile);

  log(`starting ACP proxy -> ${config.backend} ${resolveAgentCommand(config)} ${config.agentArgs.join(" ")}`);
  if (config.defaultModel) {
    const parameterText = config.defaultModelParameters
      ? ` ${JSON.stringify(config.defaultModelParameters)}`
      : "";
    log(`default model (via session/set_model): ${config.defaultModel}${parameterText}`);
  }
  const backend = createBackendProcess(config);

  backend.on("error", (error) => {
    log(`backend spawn error: ${error.message}`);
    process.exit(1);
  });

  pipeAcpProxy(process.stdin, process.stdout, backend, config, log);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("acp-proxy.mjs")) {
  main();
}
