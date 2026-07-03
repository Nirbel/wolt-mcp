import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "plugins/wolt");

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function packagePlugins() {
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const codexManifest = JSON.parse(await readFile(resolve(root, ".codex-plugin/plugin.json"), "utf8"));
  codexManifest.mcpServers = "./.mcp.json";
  codexManifest.version = pkg.version;

  const claudeManifest = {
    name: "wolt",
    displayName: "Wolt MCP",
    version: pkg.version,
    description: "Unofficial MCP integration for Wolt Menu, Venue, Order, Timeslot, Drive, and Order Submitter APIs.",
    author: {
      name: "Nirbel",
      url: "https://github.com/Nirbel"
    },
    homepage: "https://github.com/Nirbel/wolt-mcp#readme",
    repository: "https://github.com/Nirbel/wolt-mcp",
    keywords: ["wolt", "mcp", "menu", "orders", "delivery"]
  };

  const launcher = [
    'import { existsSync } from "node:fs";',
    'import { resolve } from "node:path";',
    'import { pathToFileURL } from "node:url";',
    'const root = process.env.CLAUDE_PLUGIN_ROOT || process.env.PLUGIN_ROOT || process.cwd();',
    'const entry = resolve(root, "dist/server.js");',
    'if (!existsSync(entry)) throw new Error("Wolt MCP cannot find " + entry + " - plugin root resolved from CLAUDE_PLUGIN_ROOT/PLUGIN_ROOT/cwd=" + root + "; launch from the plugin directory or set CLAUDE_PLUGIN_ROOT.");',
    'await import(pathToFileURL(entry).href);'
  ].join(" ");

  const sharedMcp = {
    mcpServers: {
      wolt: {
        command: "node",
        args: ["--input-type=module", "--eval", launcher],
        cwd: ".",
        tool_timeout_sec: 150
      }
    }
  };

  await rm(output, { recursive: true, force: true });
  await mkdir(resolve(output, "dist"), { recursive: true });
  await cp(resolve(root, "dist/server.js"), resolve(output, "dist/server.js"));
  await chmod(resolve(output, "dist/server.js"), 0o755);
  await cp(resolve(root, "skills"), resolve(output, "skills"), { recursive: true });
  await cp(resolve(root, "examples"), resolve(output, "examples"), { recursive: true });
  await cp(resolve(root, "README.md"), resolve(output, "README.md"));
  await writeJson(resolve(output, ".codex-plugin/plugin.json"), codexManifest);
  await writeJson(resolve(output, ".claude-plugin/plugin.json"), claudeManifest);
  await writeJson(resolve(output, ".mcp.json"), sharedMcp);
}

await packagePlugins();
