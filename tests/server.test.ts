import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createWoltServer } from "../src/server.js";

describe("Wolt MCP server", () => {
  it("handshakes, lists 41 tools, and exposes the Order Submitter schema resource", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createWoltServer();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(41);
    const resource = await client.readResource({ uri: "wolt://schemas/order-submitter" });
    expect(resource.contents[0]?.mimeType).toBe("application/schema+json");
    const content = resource.contents[0];
    expect(content && "text" in content ? JSON.parse(content.text) : null).toMatchObject({ $id: "wolt-order-submitter" });

    await client.close();
    await server.close();
  });
});
