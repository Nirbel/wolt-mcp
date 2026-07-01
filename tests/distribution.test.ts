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

  it("labels every public distribution description as unofficial", async () => {
    const packageJson = await json("package.json");
    const claudeMarketplace = await json(".claude-plugin/marketplace.json");
    const codexManifest = await json("plugins/wolt/.codex-plugin/plugin.json");
    const claudeManifest = await json("plugins/wolt/.claude-plugin/plugin.json");
    const readme = await readFile(resolve(root, "README.md"), "utf8");
    const skill = await readFile(resolve(root, "skills/wolt/SKILL.md"), "utf8");
    const skillUi = await readFile(resolve(root, "skills/wolt/agents/openai.yaml"), "utf8");

    const descriptions = [
      packageJson.description,
      claudeMarketplace.description,
      claudeMarketplace.plugins[0].description,
      codexManifest.description,
      claudeManifest.description
    ];
    expect(descriptions).toEqual(descriptions.map(() => expect.stringMatching(/unofficial/i)));
    expect(readme).toMatch(/unofficial integration/i);
    expect(skill).toMatch(/^description: .*unofficial/im);
    expect(skillUi).toMatch(/short_description: .*unofficial/i);
  });

  it("documents Wolt OAuth token exchange and automatic refresh rotation", async () => {
    const readme = await readFile(resolve(root, "README.md"), "utf8");

    expect(readme).toContain("https://developer.wolt.com/docs/authentication20");
    expect(readme).toContain("https://integrations-authentication-service.development.dev.woltapi.com/oauth2/token");
    expect(readme).toContain("https://integrations-authentication-service.wolt.com/oauth2/token");
    expect(readme).toContain("grant_type=authorization_code");
    expect(readme).toContain("grant_type=refresh_token");
    expect(readme).toMatch(/refresh token is single-use/i);
    expect(readme).toMatch(/automatic refresh mode is recommended for autonomous agents/i);
    expect(readme).toMatch(/bootstrap refresh token becomes stale/i);
    expect(readme).toMatch(/do not share.*refresh token.*multiple machines/is);
    expect(readme).toMatch(/external credential broker|transactional shared secret store/i);
    expect(readme).toContain("WOLT_MARKETPLACE_TOKEN_STORE");
    for (const environment of ["TEST", "PRODUCTION"]) {
      expect(readme).toContain(`WOLT_MARKETPLACE_CLIENT_ID_${environment}`);
      expect(readme).toContain(`WOLT_MARKETPLACE_CLIENT_SECRET_${environment}`);
      expect(readme).toContain(`WOLT_MARKETPLACE_REFRESH_TOKEN_${environment}`);
    }
  });

  it("ships static and automatic-refresh MCP configuration examples", async () => {
    const packageJson = await json("package.json");
    const staticExample = await json("examples/static-token.mcp.json");
    const oauthExample = await json("examples/oauth-refresh.mcp.json");

    expect(packageJson.files).toContain("examples");
    expect(staticExample.mcpServers.wolt.env).toHaveProperty("WOLT_MARKETPLACE_TOKEN_TEST");
    expect(oauthExample.mcpServers.wolt.env).toMatchObject({
      WOLT_MARKETPLACE_CLIENT_ID_TEST: "replace-with-client-id",
      WOLT_MARKETPLACE_CLIENT_SECRET_TEST: "replace-with-client-secret",
      WOLT_MARKETPLACE_REFRESH_TOKEN_TEST: "replace-with-current-refresh-token"
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
    expect(await digest(resolve(pluginRoot, "examples/static-token.mcp.json"))).toBe(
      await digest(resolve(root, "examples/static-token.mcp.json"))
    );
    expect(await digest(resolve(pluginRoot, "examples/oauth-refresh.mcp.json"))).toBe(
      await digest(resolve(root, "examples/oauth-refresh.mcp.json"))
    );
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
