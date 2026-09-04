import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const proxy = join(__dirname, "..", "src", "acp-proxy.mjs");

const child = spawn(process.execPath, [proxy], { stdio: ["pipe", "pipe", "inherit"] });

child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
});

const messages = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: 1, clientInfo: { name: "rabbit-r1", version: "test" } },
  },
  {
    jsonrpc: "2.0",
    id: 2,
    method: "session/new",
    params: { cwd: "/home/yt" },
  },
];

let index = 0;
const sendNext = () => {
  if (index >= messages.length) {
    return;
  }
  child.stdin.write(`${JSON.stringify(messages[index])}\n`);
  index += 1;
  setTimeout(sendNext, 1000);
};

sendNext();
setTimeout(() => child.stdin.end(), 12000);
setTimeout(() => process.exit(0), 20000);
