import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  buildAuthenticateSuccessResponse,
  buildPermissionAllowOnceResponse,
  isSessionNewResponse,
  isSetModelIdSupported,
  normalizeJsonLine,
  parseJsonLine,
  resolveAcpModelId,
  rewriteInitializeResult,
  rewriteSessionNewModel,
  rewriteSessionNewParams,
  serializeJsonLine,
} from "../src/acp-messages.mjs";
import {
  PROXY_VERSION,
  pipeAcpProxy,
  resolveAgentCommand,
  transformBackendToClient,
  transformClientRequest,
} from "../src/acp-proxy.mjs";
import { loadConfig, resolveWorkspaceCwd, isRabbitLeakedCwd } from "../src/config.mjs";
import { HIJACK_MARKER } from "../src/hijack-marker.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const proxyScript = join(repoRoot, "src", "acp-proxy.mjs");

const baseConfig = {
  backend: "cursor",
  authMethod: "cursor_login",
  agentName: "hermes-agent",
  agentVersion: "0.20.6-r1wrapper",
  cwd: "C:\\Users\\koryi\\R1Agent",
  autoApprovePermissions: true,
  agentCommand: "agent",
  agentArgs: ["acp"],
  logDir: "C:\\Users\\koryi\\AppData\\Local\\R1Wrapper\\logs",
};

const geminiConfig = {
  backend: "gemini",
  authMethod: "none",
  agentName: "hermes-agent",
  agentVersion: "0.20.6-r1wrapper",
  cwd: "C:\\Users\\koryi\\R1Agent",
  autoApprovePermissions: true,
  agentCommand: "gemini",
  agentArgs: ["--acp"],
  logDir: "C:\\Users\\koryi\\AppData\\Local\\R1Wrapper\\logs",
};

describe("resolveWorkspaceCwd", () => {
  it("rewrites rabbit leaked /home/yt even when junction exists", () => {
    assert.equal(isRabbitLeakedCwd("/home/yt"), true);
    const resolved = resolveWorkspaceCwd("/home/yt", baseConfig);
    assert.equal(resolved, baseConfig.cwd);
  });

  it("rewrites missing rabbit build cwd to configured workspace", () => {
    const resolved = resolveWorkspaceCwd("/home/nonexistent-rabbit-path", baseConfig);
    assert.equal(resolved, baseConfig.cwd);
  });

  it("keeps an existing cwd", () => {
    const existing = process.env.SystemRoot ?? "C:\\Windows";
    const resolved = resolveWorkspaceCwd(existing, baseConfig);
    assert.equal(resolved, existing);
  });
});

describe("rewriteInitializeResult", () => {
  it("spoofs hermes-agent identity", () => {
    const result = rewriteInitializeResult(
      { agentInfo: { name: "cursor", version: "2026.09.02" }, protocolVersion: 1 },
      baseConfig,
    );
    assert.deepEqual(result.agentInfo, {
      name: "hermes-agent",
      version: "0.20.6-r1wrapper",
    });
    assert.equal(result.protocolVersion, 1);
  });
});

describe("rewriteSessionNewParams", () => {
  it("rewrites /home/yt cwd", () => {
    const params = rewriteSessionNewParams({ cwd: "/home/yt", title: "test" }, baseConfig);
    assert.equal(params.cwd, baseConfig.cwd);
    assert.equal(params.title, "test");
  });
});

describe("session model helpers", () => {
  it("resolves composer-2.5 to a parameterized model id", () => {
    const resolved = resolveAcpModelId("composer-2.5", [
      { modelId: "composer-2.5[fast=true]", name: "composer-2.5" },
      { modelId: "claude-sonnet-4-6[thinking=true]", name: "claude-sonnet-4-6" },
    ]);
    assert.equal(resolved, "composer-2.5[fast=true]");
  });

  it("prefers fast=false when configured", () => {
    const resolved = resolveAcpModelId(
      "composer-2.5",
      [
        { modelId: "composer-2.5[fast=true]", name: "composer-2.5 fast" },
        { modelId: "composer-2.5[fast=false]", name: "composer-2.5" },
      ],
      { fast: "false" },
    );
    assert.equal(resolved, "composer-2.5[fast=false]");
  });

  it("does not force fast=true when fast=false is requested but unavailable", () => {
    const resolved = resolveAcpModelId(
      "composer-2.5",
      [{ modelId: "composer-2.5[fast=true]", name: "composer-2.5" }],
      { fast: "false" },
    );
    assert.equal(resolved, "composer-2.5");
  });

  it("detects session/new responses by request id", () => {
    const response = {
      jsonrpc: "2.0",
      id: 3,
      result: { sessionId: "abc", models: { currentModelId: "composer-2.5[fast=true]" } },
    };
    assert.equal(isSessionNewResponse(response, 3), true);
    assert.equal(isSessionNewResponse(response, 4), false);
    assert.equal(
      isSessionNewResponse(
        { jsonrpc: "2.0", id: 9, result: { sessionId: "abc", models: {} } },
        3,
      ),
      false,
    );
  });

  it("checks whether set_model targets are supported", () => {
    const available = [{ modelId: "composer-2.5[fast=true]" }];
    assert.equal(isSetModelIdSupported("composer-2.5[fast=true]", available), true);
    assert.equal(isSetModelIdSupported("composer-2.5", available), false);
  });

  it("rewrites session/new model fields", () => {
    const rewritten = rewriteSessionNewModel(
      {
        sessionId: "abc",
        models: {
          currentModelId: "claude-sonnet-4-6[thinking=true]",
          availableModels: [{ modelId: "composer-2.5[fast=true]", name: "composer-2.5" }],
        },
        configOptions: [{ id: "model", currentValue: "claude-sonnet-4-6[thinking=true]" }],
      },
      "composer-2.5[fast=true]",
    );
    assert.equal(rewritten.models.currentModelId, "composer-2.5[fast=true]");
    assert.equal(rewritten.configOptions[0].currentValue, "composer-2.5[fast=true]");
  });
});

describe("permission and auth responses", () => {
  it("builds allow-once permission response", () => {
    const response = buildPermissionAllowOnceResponse(42);
    assert.equal(response.id, 42);
    assert.equal(response.result.outcome.optionId, "allow-once");
  });

  it("builds authenticate success response", () => {
    const response = buildAuthenticateSuccessResponse(7);
    assert.equal(response.id, 7);
    assert.deepEqual(response.result, {});
  });
});

describe("transformClientRequest", () => {
  const log = () => {};

  it("intercepts authenticate", () => {
    const result = transformClientRequest(
      { jsonrpc: "2.0", id: 1, method: "authenticate", params: { methodId: "zai" } },
      baseConfig,
      log,
    );
    assert.equal(result.intercept, true);
    assert.equal(result.clientResponse?.id, 1);
  });

  it("rewrites session/new cwd", () => {
    const result = transformClientRequest(
      { jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "/home/yt" } },
      baseConfig,
      log,
    );
    assert.equal(result.intercept, false);
    assert.equal(result.forward?.params.cwd, baseConfig.cwd);
  });
});

describe("transformBackendToClient", () => {
  const log = () => {};

  it("auto-approves session/request_permission", () => {
    const result = transformBackendToClient(
      { jsonrpc: "2.0", id: 9, method: "session/request_permission", params: {} },
      baseConfig,
      log,
    );
    assert.equal(result.clientMessage, null);
    assert.equal(result.backendResponse?.id, 9);
  });

  it("rewrites initialize response without agentInfo for cursor", () => {
    const result = transformBackendToClient(
      {
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: 1, agentCapabilities: { loadSession: true } },
      },
      baseConfig,
      log,
    );
    assert.equal(result.triggerBackendAuth, true);
    assert.equal(result.triggerBackendReady, false);
    assert.equal(result.clientMessage?.result.agentInfo.name, "hermes-agent");
  });

  it("marks gemini initialize ready without backend auth", () => {
    const result = transformBackendToClient(
      {
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: 1, agentCapabilities: {} },
      },
      geminiConfig,
      log,
    );
    assert.equal(result.triggerBackendAuth, false);
    assert.equal(result.triggerBackendReady, true);
  });

  it("passes through session/update notifications", () => {
    const update = {
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionUpdate: "agent_message_chunk", content: { text: "hi" } },
    };
    const result = transformBackendToClient(update, baseConfig, log);
    assert.deepEqual(result.clientMessage, update);
    assert.equal(result.backendResponse, null);
  });
});

describe("ndjson helpers", () => {
  it("round-trips json lines", () => {
    const message = { jsonrpc: "2.0", id: 1, method: "ping" };
    const parsed = parseJsonLine(serializeJsonLine(message).trim());
    assert.deepEqual(parsed, message);
  });

  it("parses CRLF-delimited lines", () => {
    const parsed = parseJsonLine('{"jsonrpc":"2.0","id":1,"result":{}}\r');
    assert.deepEqual(parsed, { jsonrpc: "2.0", id: 1, result: {} });
    assert.equal(normalizeJsonLine("  {}\r\n  "), "{}");
  });
});

describe("pipeAcpProxy edge cases", () => {
  const log = () => {};

  it("rejects queued session/new when cursor_login times out", async () => {
    const previous = process.env.R1WRAPPER_LOGIN_TIMEOUT_MS;
    process.env.R1WRAPPER_LOGIN_TIMEOUT_MS = "50";

    try {
      const input = new PassThrough();
      const output = new PassThrough();
      const { backend, stdout } = createMockBackend();
      const config = {
        ...baseConfig,
        defaultModel: "composer-2.5",
        defaultModelParameters: { fast: "false" },
      };

      pipeAcpProxy(input, output, backend, config, log);

      input.write(
        serializeJsonLine({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: 1, clientInfo: { name: "rabbit-r1", version: "1" } },
        }),
      );

      stdout.write(
        serializeJsonLine({
          jsonrpc: "2.0",
          id: 1,
          result: { protocolVersion: 1, agentCapabilities: {} },
        }),
      );

      input.write(
        serializeJsonLine({
          jsonrpc: "2.0",
          id: 2,
          method: "session/new",
          params: { cwd: "C:\\Users\\koryi\\R1Agent" },
        }),
      );

      await sleep(120);
      const clientOutput = await readAllLines(output, 200);
      const sessionNewError = clientOutput.find((line) => {
        const message = parseJsonLine(line);
        return message?.id === 2 && message.error;
      });
      assert.ok(sessionNewError);
      assert.match(sessionNewError, /Backend login timed out/);
    } finally {
      if (previous === undefined) {
        delete process.env.R1WRAPPER_LOGIN_TIMEOUT_MS;
      } else {
        process.env.R1WRAPPER_LOGIN_TIMEOUT_MS = previous;
      }
    }
  });

  it("forwards session/new unchanged when resolved model is unsupported", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const { backend, stdout } = createMockBackend();
    const config = {
      ...baseConfig,
      authMethod: "cursor_login",
      defaultModel: "composer-2.5",
      defaultModelParameters: { fast: "false" },
    };

    pipeAcpProxy(input, output, backend, config, log);

    input.write(
      serializeJsonLine({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: 1, clientInfo: { name: "rabbit-r1", version: "1" } },
      }),
    );

    stdout.write(
      serializeJsonLine({
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: 1, agentCapabilities: {} },
      }),
    );
    stdout.write(serializeJsonLine({ jsonrpc: "2.0", id: "__r1wrapper_backend_auth__", result: {} }));

    input.write(
      serializeJsonLine({
        jsonrpc: "2.0",
        id: 3,
        method: "session/new",
        params: { cwd: "C:\\Users\\koryi\\R1Agent" },
      }),
    );

    stdout.write(
      serializeJsonLine({
        jsonrpc: "2.0",
        id: 3,
        result: {
          sessionId: "sess-1",
          models: {
            currentModelId: "composer-2.5[fast=true]",
            availableModels: [{ modelId: "composer-2.5[fast=true]" }],
          },
        },
      }),
    );

    await sleep(50);
    const clientOutput = await readAllLines(output, 200);
    const sessionNew = clientOutput
      .map((line) => parseJsonLine(line))
      .find((message) => message?.id === 3 && message.result);
    assert.equal(sessionNew.result.models.currentModelId, "composer-2.5[fast=true]");
  });

  it("does not queue session/new behind cursor_login for gemini", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const { backend, stdout, stdin } = createMockBackend();
    const backendWrites = [];
    stdin.on("data", (chunk) => {
      backendWrites.push(chunk.toString());
    });

    pipeAcpProxy(input, output, backend, geminiConfig, log);

    input.write(
      serializeJsonLine({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: 1, clientInfo: { name: "rabbit-r1", version: "1" } },
      }),
    );

    stdout.write(
      serializeJsonLine({
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: 1, agentCapabilities: {} },
      }),
    );

    input.write(
      serializeJsonLine({
        jsonrpc: "2.0",
        id: 2,
        method: "session/new",
        params: { cwd: "C:\\Users\\koryi\\R1Agent" },
      }),
    );

    stdout.write(
      serializeJsonLine({
        jsonrpc: "2.0",
        id: 2,
        result: { sessionId: "sess-gemini", models: { currentModelId: "auto" } },
      }),
    );

    await sleep(50);
    const clientOutput = await readAllLines(output, 200);
    const sessionNew = clientOutput
      .map((line) => parseJsonLine(line))
      .find((message) => message?.id === 2 && message.result);
    assert.ok(sessionNew);
    assert.equal(sessionNew.result.sessionId, "sess-gemini");
    assert.equal(
      backendWrites.some((line) => line.includes("cursor_login")),
      false,
    );
  });
});

describe("proxy cli flags", () => {
  it("prints --version", async () => {
    const output = await runNode([proxyScript, "--version"]);
    assert.equal(output.stdout.trim(), PROXY_VERSION);
  });

  it("prints --check", async () => {
    const output = await runNode([proxyScript, "--check"]);
    assert.match(output.stdout, /r1wrapper acp proxy: ok/);
  });
});

describe("loadConfig", () => {
  it("loads cursor repo config", () => {
    const config = loadConfig(join(repoRoot, "src", "config.json"));
    assert.equal(config.backend, "cursor");
    assert.equal(config.authMethod, "cursor_login");
    assert.ok(config.cwd.includes("R1Agent"));
    assert.equal(config.defaultModel, "composer-2.5");
    assert.deepEqual(config.defaultModelParameters, { fast: "false" });
    assert.deepEqual(config.agentArgs, ["--model", "composer-2.5", "acp"]);
    assert.equal(config.agentCommand, "agent");
  });

  it("loads gemini backend without default model", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "r1wrapper-config-"));
    const configPath = join(tmpDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        backend: "gemini",
        cwd: "C:\\Users\\koryi\\R1Agent",
        gemini: { command: "gemini", args: ["--acp"] },
      }),
      "utf8",
    );
    const config = loadConfig(configPath);
    assert.equal(config.backend, "gemini");
    assert.equal(config.authMethod, "none");
    assert.equal(config.defaultModel, undefined);
    assert.deepEqual(config.agentArgs, ["--acp"]);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws for unknown backend", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "r1wrapper-config-"));
    const configPath = join(tmpDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ backend: "openclaw" }), "utf8");
    assert.throws(() => loadConfig(configPath), /Unknown backend/);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("resolveAgentCommand", () => {
  it("overrides command via R1WRAPPER_AGENT_CMD without changing authMethod", () => {
    const previous = process.env.R1WRAPPER_AGENT_CMD;
    process.env.R1WRAPPER_AGENT_CMD = "C:\\custom\\agent.cmd";
    try {
      const command = resolveAgentCommand(geminiConfig);
      assert.equal(command, "C:\\custom\\agent.cmd");
      assert.equal(geminiConfig.authMethod, "none");
    } finally {
      if (previous === undefined) {
        delete process.env.R1WRAPPER_AGENT_CMD;
      } else {
        process.env.R1WRAPPER_AGENT_CMD = previous;
      }
    }
  });
});

describe("hijack marker", () => {
  it("uses the expected marker string", () => {
    assert.equal(HIJACK_MARKER, "r1wrapper-hijack");
  });
});

describe("acp smoke (optional)", () => {
  it("proxy starts and accepts initialize when agent acp is available", { timeout: 60000 }, async () => {
    if (process.env.R1WRAPPER_SKIP_SMOKE === "1") {
      return;
    }

    const hasAgent = await commandExists("agent");
    if (!hasAgent) {
      return;
    }

    const tmpLog = mkdtempSync(join(tmpdir(), "r1wrapper-smoke-"));
    const configPath = join(tmpLog, "config.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      configPath,
      JSON.stringify({
        backend: "cursor",
        cwd: baseConfig.cwd,
        cursor: {
          command: "agent",
          args: ["acp"],
        },
        logDir: join(tmpLog, "logs"),
      }),
      "utf8",
    );

    const child = spawn(process.execPath, [proxyScript], {
      env: { ...process.env, R1WRAPPER_CONFIG: configPath },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    const init = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: 1,
        clientInfo: { name: "rabbit-r1", version: "test" },
      },
    };

    child.stdin.write(serializeJsonLine(init));
    const responseLine = await readLine(child.stdout, 30000);
    const response = parseJsonLine(responseLine);
    assert.equal(response.id, 1);
    assert.ok(response.result);
    assert.equal(response.result.agentInfo.name, "hermes-agent");

    child.kill();
    rmSync(tmpLog, { recursive: true, force: true });
  });

  it("gemini --acp accepts initialize without cursor_login", { timeout: 60000 }, async () => {
    if (process.env.R1WRAPPER_SKIP_SMOKE === "1") {
      return;
    }

    const hasGemini = await commandExists("gemini");
    if (!hasGemini) {
      return;
    }

    const tmpLog = mkdtempSync(join(tmpdir(), "r1wrapper-gemini-smoke-"));
    const configPath = join(tmpLog, "config.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      configPath,
      JSON.stringify({
        backend: "gemini",
        cwd: baseConfig.cwd,
        gemini: { command: "gemini", args: ["--acp"] },
        logDir: join(tmpLog, "logs"),
      }),
      "utf8",
    );

    const child = spawn(process.execPath, [proxyScript], {
      env: { ...process.env, R1WRAPPER_CONFIG: configPath },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    let backendInput = "";
    child.stdin.write(
      serializeJsonLine({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientInfo: { name: "rabbit-r1", version: "test" },
        },
      }),
    );

    const responseLine = await readLine(child.stdout, 30000);
    const response = parseJsonLine(responseLine);
    assert.equal(response.id, 1);
    assert.ok(response.result);
    assert.equal(response.result.agentInfo.name, "hermes-agent");

    child.kill();
    rmSync(tmpLog, { recursive: true, force: true });
  });
});

/**
 * @param {string[]} args
 */
function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    child.on("error", reject);
  });
}

/**
 * @param {string} command
 */
function commandExists(command) {
  return new Promise((resolve) => {
    const checker = spawn("where", [command], { shell: true, stdio: "ignore" });
    checker.on("close", (code) => resolve(code === 0));
    checker.on("error", () => resolve(false));
  });
}

function createMockBackend() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const backend = new EventEmitter();
  backend.stdin = stdin;
  backend.stdout = stdout;
  backend.stderr = null;
  return { backend, stdin, stdout };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {import('node:stream').Readable} stream
 * @param {number} timeoutMs
 */
function readAllLines(stream, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      resolve(buffer.split("\n").filter(Boolean));
    }, timeoutMs);

    const onData = (chunk) => {
      buffer += chunk.toString();
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      clearTimeout(timer);
      stream.off("data", onData);
      stream.off("error", onError);
    };

    stream.on("data", onData);
    stream.on("error", onError);
  });
}

/**
 * @param {import('node:stream').Readable} stream
 * @param {number} timeoutMs
 */
function readLine(stream, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout waiting for proxy response"));
    }, timeoutMs);

    const onData = (chunk) => {
      buffer += chunk.toString();
      const index = buffer.indexOf("\n");
      if (index !== -1) {
        cleanup();
        resolve(buffer.slice(0, index));
      }
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      clearTimeout(timer);
      stream.off("data", onData);
      stream.off("error", onError);
    };

    stream.on("data", onData);
    stream.on("error", onError);
  });
}
