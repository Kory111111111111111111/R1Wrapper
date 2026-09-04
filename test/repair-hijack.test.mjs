import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import { HIJACK_MARKER } from "../src/hijack-marker.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const repairScript = join(repoRoot, "scripts", "repair-hijack.ps1");

function runRepair(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", repairScript, ...args],
      { stdio: ["ignore", "pipe", "pipe"], ...options },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", reject);
  });
}

describe("repair-hijack.ps1", () => {
  it("detects and repairs drifted wrappers", { skip: process.platform !== "win32" }, async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "r1wrapper-repair-"));
    const hermesBin = join(tmpRoot, "hermes-bin");
    const repoBin = join(tmpRoot, "bin");
    mkdirSync(hermesBin, { recursive: true });
    mkdirSync(repoBin, { recursive: true });
    writeFileSync(join(repoBin, "hermes.cmd"), "@echo off\r\necho repo\r\n", "ascii");
    writeFileSync(join(repoBin, "hermes-acp.cmd"), "@echo off\r\necho repo-acp\r\n", "ascii");
    writeFileSync(join(hermesBin, "hermes.cmd"), "@echo off\r\necho stock\r\n", "ascii");
    writeFileSync(join(hermesBin, "hermes-acp.cmd"), "@echo off\r\necho stock\r\n", "ascii");

    const checkDrifted = await runRepair([
      "-Check",
      "-RepoRoot",
      tmpRoot,
      "-HermesBin",
      hermesBin,
    ]);
    assert.equal(checkDrifted.code, 2);

    const repaired = await runRepair(["-RepoRoot", tmpRoot, "-HermesBin", hermesBin]);
    assert.equal(repaired.code, 0);

    const { readFileSync } = await import("node:fs");
    const wrapper = readFileSync(join(hermesBin, "hermes.cmd"), "utf8");
    assert.match(wrapper, new RegExp(`rem ${HIJACK_MARKER}`));
    assert.match(wrapper, /call ".*\\bin\\hermes.cmd"/);

    const checkOk = await runRepair(["-Check", "-RepoRoot", tmpRoot, "-HermesBin", hermesBin]);
    assert.equal(checkOk.code, 0);

    rmSync(tmpRoot, { recursive: true, force: true });
  });
});
