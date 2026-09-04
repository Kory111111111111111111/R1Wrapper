import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

const agentCmd = join(process.env.LOCALAPPDATA ?? "", "cursor-agent", "agent.cmd");
const child = spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", agentCmd, "acp"], {
  stdio: ["pipe", "pipe", "inherit"],
});

child.stdout.on("data", (d) => process.stdout.write(d));

const lines = [
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: 1, clientInfo: { name: "test", version: "1" } },
  }),
  JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "authenticate",
    params: { methodId: "cursor_login" },
  }),
  JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "session/new",
    params: { cwd: "C:\\Users\\koryi\\R1Agent" },
  }),
];

let i = 0;
const send = () => {
  if (i >= lines.length) return;
  child.stdin.write(`${lines[i++]}\n`);
  setTimeout(send, 1500);
};
send();
setTimeout(() => child.stdin.end(), 8000);
setTimeout(() => process.exit(0), 15000);
