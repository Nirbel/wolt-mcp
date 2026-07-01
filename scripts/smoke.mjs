import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

const [configArgument, hostArgument] = process.argv.slice(2);
let command = process.execPath;
let args = ["dist/server.js"];
let cwd = process.cwd();
const env = { ...process.env };

if (configArgument) {
  const configPath = resolve(configArgument);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const server = config.mcpServers?.wolt;
  if (!server || typeof server.command !== "string") throw new Error("Wolt MCP config is missing mcpServers.wolt.command");
  command = server.command;
  args = Array.isArray(server.args) ? server.args : [];
  cwd = server.cwd === "." || server.cwd === undefined ? dirname(configPath) : server.cwd;
  Object.assign(env, server.env ?? {});
  if (hostArgument === "--claude-plugin") env.CLAUDE_PLUGIN_ROOT = dirname(configPath);
}

const child = spawn(command, args, {
  cwd,
  env,
  stdio: ["pipe", "pipe", "pipe"]
});
const lines = createInterface({ input: child.stdout });
const pending = new Map();
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk; });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  }
});

let nextId = 1;
function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}
function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}. ${stderr}`));
    }, 5000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); }
    });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

try {
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "wolt-standalone-smoke", version: "1.0.0" }
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  const listed = await request("tools/list");
  if (listed.tools.length !== 41) throw new Error(`Expected 41 tools, received ${listed.tools.length}`);
  const resource = await request("resources/read", { uri: "wolt://schemas/order-submitter" });
  if (resource.contents.length !== 1) throw new Error("Order Submitter schema resource is missing");
  process.stdout.write("Standalone bundle smoke passed: 41 tools and 1 schema resource.\n");
} finally {
  lines.close();
  child.stdin.end();
  child.kill();
}
