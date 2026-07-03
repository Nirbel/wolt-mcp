import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createWoltServer } from "../src/server.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path: string): Promise<Record<string, any>> =>
  JSON.parse(await readFile(resolve(root, path), "utf8")) as Record<string, any>;

describe("version consistency", () => {
  it("keeps every manifest and the running server at the package.json version", async () => {
    const { version } = await readJson("package.json");
    expect(version).toMatch(/^\d+\.\d+\.\d+/);

    const claudeMarketplace = await readJson(".claude-plugin/marketplace.json");
    expect(claudeMarketplace.version).toBe(version);
    expect(claudeMarketplace.plugins[0].version).toBe(version);
    expect((await readJson(".codex-plugin/plugin.json")).version).toBe(version);
    expect((await readJson("plugins/wolt/.codex-plugin/plugin.json")).version).toBe(version);
    expect((await readJson("plugins/wolt/.claude-plugin/plugin.json")).version).toBe(version);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createWoltServer();
    const client = new Client({ name: "version-test", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    expect(client.getServerVersion()?.version).toBe(version);
    await client.close();
    await server.close();
  });
});
