import { resolveWorkspaceCwd } from "./config.mjs";

/**
 * @param {unknown} result
 * @param {{ agentName: string, agentVersion: string }} config
 */
export function rewriteInitializeResult(result, config) {
  if (!result || typeof result !== "object") {
    return result;
  }

  const copy = structuredClone(result);
  copy.agentInfo = {
    name: config.agentName,
    version: config.agentVersion,
  };
  if (!copy.authMethods) {
    copy.authMethods = [
      {
        id: "zai",
        name: "zai runtime credentials",
        description: "Authenticate Hermes using the currently configured zai runtime credentials.",
      },
    ];
  }
  return copy;
}

export const BACKEND_AUTH_ID = "__r1wrapper_backend_auth__";
export const BACKEND_SET_MODEL_ID = "__r1wrapper_set_model__";

/**
 * @param {string} line
 */
export function normalizeJsonLine(line) {
  return line.replace(/\r$/, "").trim();
}

/**
 * @param {unknown} message
 */
export function isSessionNewResponse(message, expectedRequestId) {
  if (!message || typeof message !== "object" || !("result" in message)) {
    return false;
  }
  const id = getMessageId(message);
  if (id === undefined) {
    return false;
  }
  if (expectedRequestId !== undefined && expectedRequestId !== null && id !== expectedRequestId) {
    return false;
  }
  const result = /** @type {Record<string, unknown>} */ (message).result;
  return !!result && typeof result === "object" && "sessionId" in result && "models" in result;
}

/**
 * @param {unknown} message
 */
export function isBackendSetModelResponse(message) {
  return getMessageId(message) === BACKEND_SET_MODEL_ID;
}

/**
 * @param {string} modelId
 */
function getModelBaseId(modelId) {
  return modelId.split("[")[0];
}

/**
 * @param {string} modelId
 * @param {string} key
 */
function getModelParameter(modelId, key) {
  const match = modelId.match(new RegExp(`${key}=([^,\\]]+)`));
  return match?.[1];
}

/**
 * @param {string} requestedModel
 * @param {Array<{ modelId?: string }> | undefined} availableModels
 * @param {Record<string, string> | undefined} parameters
 */
export function resolveAcpModelId(requestedModel, availableModels, parameters) {
  const requestedBase = getModelBaseId(requestedModel);
  const candidates = (availableModels ?? []).filter((model) => {
    const modelId = model.modelId;
    return modelId === requestedModel || getModelBaseId(modelId ?? "") === requestedBase;
  });

  if (parameters && Object.keys(parameters).length > 0) {
    const parameterizedMatches = candidates.filter((model) =>
      Object.entries(parameters).every(([key, value]) => getModelParameter(model.modelId ?? "", key) === value),
    );
    if (parameterizedMatches[0]?.modelId) {
      return parameterizedMatches[0].modelId;
    }

    if (parameters.fast === "false") {
      const nonFast = candidates.find((model) => getModelParameter(model.modelId ?? "", "fast") === "false");
      if (nonFast?.modelId) {
        return nonFast.modelId;
      }
    }
  }

  if (!availableModels?.length) {
    if (!parameters || Object.keys(parameters).length === 0) {
      return requestedModel;
    }
    const suffix = Object.entries(parameters)
      .map(([key, value]) => `${key}=${value}`)
      .join(",");
    return `${requestedBase}[${suffix}]`;
  }

  const exact = availableModels.find((model) => model.modelId === requestedModel);
  if (exact?.modelId) {
    return exact.modelId;
  }

  if (parameters?.fast === "false") {
    const withoutFastTrue = candidates.find((model) => getModelParameter(model.modelId ?? "", "fast") !== "true");
    if (withoutFastTrue?.modelId) {
      return withoutFastTrue.modelId;
    }
    // Cursor ACP may only expose composer-2.5[fast=true]; avoid forcing that variant.
    return requestedModel;
  }

  if (candidates[0]?.modelId) {
    return candidates[0].modelId;
  }

  const prefixed = availableModels.find((model) => model.modelId?.startsWith(`${requestedBase}[`));
  if (prefixed?.modelId) {
    return prefixed.modelId;
  }

  return requestedModel;
}

/**
 * @param {unknown} result
 * @param {string} modelId
 */
export function rewriteSessionNewModel(result, modelId) {
  if (!result || typeof result !== "object") {
    return result;
  }

  const copy = structuredClone(result);
  if (copy.models && typeof copy.models === "object") {
    copy.models.currentModelId = modelId;
  }

  if (Array.isArray(copy.configOptions)) {
    copy.configOptions = copy.configOptions.map((option) => {
      if (!option || typeof option !== "object" || option.id !== "model") {
        return option;
      }
      return { ...option, currentValue: modelId };
    });
  }

  return copy;
}

/**
 * @param {string} sessionId
 * @param {string} modelId
 */
export function buildSetModelRequest(sessionId, modelId) {
  return {
    jsonrpc: "2.0",
    id: BACKEND_SET_MODEL_ID,
    method: "session/set_model",
    params: { sessionId, modelId },
  };
}

export function buildBackendAuthRequest() {
  return {
    jsonrpc: "2.0",
    id: BACKEND_AUTH_ID,
    method: "authenticate",
    params: { methodId: "cursor_login" },
  };
}

/**
 * @param {unknown} message
 */
export function isInitializeResponse(message) {
  if (!message || typeof message !== "object" || !("result" in message)) {
    return false;
  }
  const result = /** @type {Record<string, unknown>} */ (message).result;
  return (
    !!result &&
    typeof result === "object" &&
    ("protocolVersion" in result || "agentCapabilities" in result || "agentInfo" in result)
  );
}

/**
 * @param {unknown} message
 */
export function isBackendAuthResponse(message) {
  return getMessageId(message) === BACKEND_AUTH_ID;
}

/**
 * @param {Record<string, unknown>} params
 * @param {import('./types.mjs').ProxyConfig} config
 */
export function rewriteSessionNewParams(params, config) {
  const copy = structuredClone(params);
  if ("cwd" in copy) {
    copy.cwd = resolveWorkspaceCwd(String(copy.cwd ?? ""), config);
  }
  return copy;
}

/**
 * @param {number | string} id
 */
export function buildPermissionAllowOnceResponse(id) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      outcome: {
        outcome: "selected",
        optionId: "allow-once",
      },
    },
  };
}

/**
 * @param {number | string} id
 */
export function buildAuthenticateSuccessResponse(id) {
  return {
    jsonrpc: "2.0",
    id,
    result: {},
  };
}

/**
 * @param {string} modelId
 * @param {Array<{ modelId?: string }> | undefined} availableModels
 */
export function isSetModelIdSupported(modelId, availableModels) {
  if (!availableModels?.length) {
    return true;
  }
  return availableModels.some((model) => model.modelId === modelId);
}

/**
 * @param {string} line
 */
export function parseJsonLine(line) {
  const trimmed = normalizeJsonLine(line);
  if (!trimmed) {
    return null;
  }
  return JSON.parse(trimmed);
}

/**
 * @param {unknown} message
 */
export function serializeJsonLine(message) {
  return `${JSON.stringify(message)}\n`;
}

/**
 * @param {unknown} message
 */
export function getMessageMethod(message) {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  return /** @type {Record<string, unknown>} */ (message).method;
}

/**
 * @param {unknown} message
 */
export function getMessageId(message) {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  return /** @type {Record<string, unknown>} */ (message).id;
}

/**
 * @param {unknown} message
 */
export function isClientRequest(message) {
  return getMessageMethod(message) !== undefined && getMessageId(message) !== undefined;
}

/**
 * @param {unknown} message
 */
export function shouldQueueForSessionReady(message) {
  const method = getMessageMethod(message);
  if (!method) {
    return false;
  }
  return method !== "initialize";
}

/**
 * @param {unknown} message
 */
export function shouldQueueUntilBackendReady(message) {
  const method = getMessageMethod(message);
  if (!method) {
    return false;
  }
  return method !== "initialize";
}
