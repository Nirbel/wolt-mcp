import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(root, "plugins/wolt");
const execute = promisify(execFile);

async function json(path: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(resolve(root, path), "utf8")) as Record<string, any>;
}

async function digest(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

describe("cross-client distribution", () => {
  it("publishes a Codex marketplace entry for the packaged Wolt plugin", async () => {
    const marketplace = await json(".agents/plugins/marketplace.json");
    expect(marketplace).toMatchObject({
      name: "wolt-mcp",
      plugins: [{
        name: "wolt",
        source: { source: "local", path: "./plugins/wolt" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity"
      }]
    });
  });

  it("publishes a Claude Code marketplace entry for the same plugin", async () => {
    const marketplace = await json(".claude-plugin/marketplace.json");
    expect(marketplace).toMatchObject({
      name: "wolt-mcp",
      owner: { name: "Nirbel" },
      plugins: [{ name: "wolt", source: "./plugins/wolt", version: "0.1.0" }]
    });
  });

  it("packages one adaptive MCP launch configuration for both hosts", async () => {
    const codexManifest = await json("plugins/wolt/.codex-plugin/plugin.json");
    const claudeManifest = await json("plugins/wolt/.claude-plugin/plugin.json");
    const sharedMcp = await json("plugins/wolt/.mcp.json");

    expect(codexManifest).toMatchObject({ name: "wolt", mcpServers: "./.mcp.json" });
    expect(claudeManifest).toMatchObject({ name: "wolt", version: "0.1.0" });
    expect(sharedMcp.mcpServers.wolt).toMatchObject({ command: "node", cwd: "." });
    expect(sharedMcp.mcpServers.wolt.args).toEqual(expect.arrayContaining(["--input-type=module", "--eval"]));
    expect(sharedMcp.mcpServers.wolt.args.join(" ")).toContain("CLAUDE_PLUGIN_ROOT");
    expect(sharedMcp.mcpServers.wolt.args.join(" ")).toContain("dist/server.js");
  });

  it("packages the exact standalone server and skill inside the plugin", async () => {
    expect(await digest(resolve(pluginRoot, "dist/server.js"))).toBe(await digest(resolve(root, "dist/server.js")));
    expect(await digest(resolve(pluginRoot, "skills/wolt/SKILL.md"))).toBe(await digest(resolve(root, "skills/wolt/SKILL.md")));
  });

  it.each(["codex", "claude"])("handshakes through the packaged %s launcher", async (host) => {
    const { stdout } = await execute(process.execPath, [
      resolve(root, "scripts/smoke.mjs"),
      resolve(pluginRoot, ".mcp.json"),
      ...(host === "claude" ? ["--claude-plugin"] : [])
    ], { cwd: resolve(root, "tests"), timeout: 10_000 });
    expect(stdout).toContain("41 tools and 1 schema resource");
  });

  it("exposes the standalone bundle as an npm executable", async () => {
    const packageJson = await json("package.json");
    expect(packageJson.bin).toEqual({ "wolt-mcp": "./dist/server.js" });
    expect(packageJson.files).toEqual(expect.arrayContaining(["dist/server.js", "plugins/wolt", ".agents/plugins", ".claude-plugin"]));
  });
});
