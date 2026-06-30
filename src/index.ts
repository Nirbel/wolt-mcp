import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createWoltServer } from "./server.js";

const server = createWoltServer();
const transport = new StdioServerTransport();

server.connect(transport).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
