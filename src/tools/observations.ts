import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, handleApiError, truncateResponse } from "../api-client.js";
import { CHARACTER_LIMIT } from "../constants.js";

const ObservationFilterSchema = z
  .string()
  .optional()
  .describe(
    `JSON array of filter objects. Each: { type, column, operator, value, key? }.
Columns: id, type, name, traceId, startTime, endTime, environment, level, statusMessage, version, userId, sessionId, traceName, traceTags, latency, timeToFirstToken, tokensPerSecond, inputTokens, outputTokens, totalTokens, inputCost, outputCost, totalCost, model/providedModelName, promptName, promptVersion, metadata.
Example: [{"type":"string","column":"type","operator":"=","value":"GENERATION"},{"type":"number","column":"latency","operator":">=","value":2.5}]`
  );

const ListObservationsSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(50)
    .describe("Items per page (1-1000, default 50)"),
  cursor: z
    .string()
    .optional()
    .describe("Base64-encoded cursor from previous response for pagination"),
  trace_id: z.string().optional().describe("Filter by trace ID"),
  name: z.string().optional().describe("Filter by observation name"),
  type: z
    .string()
    .optional()
    .describe(
      "Filter by type: GENERATION, SPAN, EVENT, AGENT, TOOL, CHAIN, RETRIEVER, EVALUATOR, EMBEDDING, GUARDRAIL"
    ),
  level: z
    .string()
    .optional()
    .describe("Filter by level: DEBUG, DEFAULT, WARNING, ERROR"),
  version: z.string().optional().describe("Filter by version"),
  user_id: z.string().optional().describe("Filter by user ID"),
  parent_observation_id: z
    .string()
    .optional()
    .describe("Filter by parent observation ID"),
  environment: z
    .array(z.string())
    .optional()
    .describe("Filter by environment(s)"),
  from_start_time: z
    .string()
    .optional()
    .describe("Only observations on or after this ISO 8601 datetime"),
  to_start_time: z
    .string()
    .optional()
    .describe("Only observations before this ISO 8601 datetime"),
  fields: z
    .string()
    .optional()
    .describe(
      "Comma-separated field groups: core (always), basic, time, io, metadata, model, usage, prompt, metrics. Default: core,basic. Example: 'core,basic,usage,model,metrics'"
    ),
  expand_metadata: z
    .string()
    .optional()
    .describe(
      "Comma-separated metadata keys to return non-truncated (by default values > 200 chars are truncated)"
    ),
  filter: ObservationFilterSchema,
});

export function registerObservationTools(server: McpServer): void {
  server.registerTool(
    "langfuse_list_observations",
    {
      title: "List Langfuse Observations",
      description: `List observations (spans, generations, events) from Langfuse with cursor-based pagination, filtering, and field selection.

Use 'fields' to control which data is returned:
- core: id, traceId, startTime, endTime, projectId, parentObservationId, type (always included)
- basic: name, level, statusMessage, version, environment
- time: completionStartTime, createdAt, updatedAt
- io: input, output
- metadata: metadata (truncated to 200 chars unless expand_metadata is set)
- model: providedModelName, internalModelId, modelParameters
- usage: usageDetails, costDetails, totalCost
- prompt: promptId, promptName, promptVersion
- metrics: latency, timeToFirstToken

Supports advanced filtering via 'filter' parameter for type, name, latency, cost, tokens, model, level, metadata, and more.

Pagination is cursor-based: pass the cursor from the response to get the next page.`,
      inputSchema: ListObservationsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const queryParams: Record<string, unknown> = {
          limit: params.limit,
        };
        if (params.cursor) queryParams.cursor = params.cursor;
        if (params.trace_id) queryParams.traceId = params.trace_id;
        if (params.name) queryParams.name = params.name;
        if (params.type) queryParams.type = params.type;
        if (params.level) queryParams.level = params.level;
        if (params.version) queryParams.version = params.version;
        if (params.user_id) queryParams.userId = params.user_id;
        if (params.parent_observation_id)
          queryParams.parentObservationId = params.parent_observation_id;
        if (params.environment) queryParams.environment = params.environment;
        if (params.from_start_time)
          queryParams.fromStartTime = params.from_start_time;
        if (params.to_start_time) queryParams.toStartTime = params.to_start_time;
        if (params.fields) queryParams.fields = params.fields;
        if (params.expand_metadata)
          queryParams.expandMetadata = params.expand_metadata;
        if (params.filter) queryParams.filter = params.filter;

        const data = await apiGet<Record<string, unknown>>(
          "/v2/observations",
          queryParams
        );
        const text = truncateResponse(
          JSON.stringify(data, null, 2),
          CHARACTER_LIMIT
        );

        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );
}
