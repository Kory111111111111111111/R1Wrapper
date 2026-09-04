import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @param {string} value */
function expandEnv(value) {
  return value.replace(/%([^%]+)%/g, (_, key) => process.env[key] ?? "");
}

function resolveDefaultConfigPath() {
  const localPath = join(__dirname, "config.json");
  if (existsSync(localPath)) {
    return localPath;
  }
  return join(__dirname, "config.example.json");
}

/**
 * @param {string} backendId
 * @param {{ args?: string[], defaultModel?: string }} backendBlock
 */
function buildAgentArgs(backendId, backendBlock) {
  const args = [...(backendBlock.args ?? ["acp"])];
  if (backendId !== "cursor" || !backendBlock.defaultModel || args.includes("--model")) {
    return args;
  }

  const acpIndex = args.indexOf("acp");
  if (acpIndex === -1) {
    return ["--model", backendBlock.defaultModel, ...args, "acp"];
  }
  return [...args.slice(0, acpIndex), "--model", backendBlock.defaultModel, ...args.slice(acpIndex)];
}

/**
 * @param {BackendId} backendId
 * @param {{ command?: string }} backendBlock
 */
function resolveDefaultAgentCommand(backendId, backendBlock) {
  if (backendBlock.command) {
    return backendBlock.command;
  }

  switch (backendId) {
    case "cursor":
      return "agent";
    case "gemini":
      return "gemini";
    default: {
      const _exhaustive = backendId;
      throw new Error(`Unknown backend: ${String(_exhaustive)}`);
    }
  }
}

/**
 * @param {BackendId} backendId
 */
function resolveAuthMethod(backendId) {
  switch (backendId) {
    case "cursor":
      return "cursor_login";
    case "gemini":
      return "none";
    default: {
      const _exhaustive = backendId;
      throw new Error(`Unknown backend: ${String(_exhaustive)}`);
    }
  }
}

/**
 * @param {string} backendId
 * @param {Record<string, unknown>} raw
 */
function resolveBackendBlock(backendId, raw) {
  const nested = raw[backendId];
  if (nested && typeof nested === "object") {
    return /** @type {Record<string, unknown>} */ (nested);
  }

  if (backendId === "cursor" && (raw.cursorAgentCommand || raw.cursorAgentArgs || raw.defaultModel)) {
    return {
      command: raw.cursorAgentCommand ?? "agent",
      args: raw.cursorAgentArgs ?? ["acp"],
      defaultModel: raw.defaultModel,
      defaultModelParameters: raw.defaultModelParameters,
    };
  }

  throw new Error(`Missing backend config block for "${backendId}"`);
}

/**
 * @param {string} [configPath]
 * @returns {import('./types.mjs').ProxyConfig}
 */
export function loadConfig(configPath) {
  const path = configPath ?? process.env.R1WRAPPER_CONFIG ?? resolveDefaultConfigPath();
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const rawCwd = typeof raw.cwd === "string" ? raw.cwd.trim() : raw.cwd;
  const cwd = expandEnv(String(rawCwd || join(homedir(), "R1Agent"))).replace(/^~(?=$|[\\/])/, homedir());

  const backendId = raw.backend ?? "cursor";
  if (backendId !== "cursor" && backendId !== "gemini") {
    throw new Error(`Unknown backend: ${backendId}`);
  }

  const backendBlock = resolveBackendBlock(backendId, raw);
  const authMethod = resolveAuthMethod(backendId);
  const agentCommand = resolveDefaultAgentCommand(backendId, backendBlock);
  const agentArgs = buildAgentArgs(backendId, backendBlock);

  const defaultModel =
    backendId === "cursor" && typeof backendBlock.defaultModel === "string"
      ? backendBlock.defaultModel
      : undefined;
  const defaultModelParameters =
    backendId === "cursor" &&
    backendBlock.defaultModelParameters &&
    typeof backendBlock.defaultModelParameters === "object"
      ? /** @type {Record<string, string>} */ (backendBlock.defaultModelParameters)
      : undefined;

  return {
    backend: backendId,
    authMethod,
    agentName: raw.agentName ?? "hermes-agent",
    agentVersion: raw.agentVersion ?? "0.20.6-r1wrapper",
    cwd,
    defaultModel,
    defaultModelParameters,
    autoApprovePermissions: raw.autoApprovePermissions !== false,
    agentCommand,
    agentArgs,
    logDir: expandEnv(raw.logDir ?? join(homedir(), "AppData", "Local", "R1Wrapper", "logs")),
  };
}

/** Rabbit agent leaks its Linux build cwd; always rewrite even if a junction exists on Windows. */
const RABBIT_LEAKED_CWDS = new Set([
  "/home/yt",
  "\\home\\yt",
  "C:\\home\\yt",
  "c:\\home\\yt",
]);

/**
 * @param {string} cwd
 */
export function isRabbitLeakedCwd(cwd) {
  const normalized = cwd.replace(/\\/g, "/").toLowerCase();
  return (
    RABBIT_LEAKED_CWDS.has(cwd) ||
    RABBIT_LEAKED_CWDS.has(cwd.replace(/\\/g, "/")) ||
    normalized === "/home/yt" ||
    normalized === "c:/home/yt"
  );
}

/**
 * @param {string | undefined} cwd
 * @param {import('./types.mjs').ProxyConfig} config
 */
export function resolveWorkspaceCwd(cwd, config) {
  if (!cwd || isRabbitLeakedCwd(cwd)) {
    return config.cwd;
  }

  if (existsSync(cwd)) {
    return cwd;
  }

  return config.cwd;
}
