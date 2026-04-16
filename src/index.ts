#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTraceTools } from "./tools/traces.js";
import { registerObservationTools } from "./tools/observations.js";
import { registerScoreTools } from "./tools/scores.js";
import { registerSessionTools } from "./tools/sessions.js";
import { registerMetricsTools } from "./tools/metrics.js";
import { registerAnalyticsTools } from "./tools/analytics.js";

const server = new McpServer({
  name: "langfuse-mcp-server",
  version: "1.0.0",
});

registerTraceTools(server);
registerObservationTools(server);
registerScoreTools(server);
registerSessionTools(server);
registerMetricsTools(server);
registerAnalyticsTools(server);

async function main(): Promise<void> {
  const required = ["LANGFUSE_HOST", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`ERROR: Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Langfuse MCP server running via stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
