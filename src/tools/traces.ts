import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, handleApiError, truncateResponse } from "../api-client.js";
import { CHARACTER_LIMIT, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../constants.js";

const FilterSchema = z
  .string()
  .optional()
  .describe(
    `JSON array of filter objects. Each: { type, column, operator, value, key? }.
Types: datetime, string, number, stringOptions, arrayOptions, stringObject, numberObject, boolean, null.
Columns: id, name, timestamp, userId, sessionId, environment, version, release, tags, bookmarked, metadata, latency, inputTokens, outputTokens, totalTokens, inputCost, outputCost, totalCost, level, errorCount, warningCount, scores_avg, score_categories.
Example: [{"type":"datetime","column":"timestamp","operator":">=","value":"2024-01-01T00:00:00Z"},{"type":"number","column":"totalCost","operator":">=","value":0.01}]`
  );

const ListTracesSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_LIMIT)
    .default(DEFAULT_PAGE_LIMIT)
    .describe("Items per page (1-100, default 20)"),
  page: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe("Page number, starts at 1"),
  name: z.string().optional().describe("Filter by trace name"),
  user_id: z.string().optional().describe("Filter by user ID"),
  session_id: z.string().optional().describe("Filter by session ID"),
  tags: z
    .array(z.string())
    .optional()
    .describe("Filter traces that include ALL of these tags"),
  version: z.string().optional().describe("Filter by version"),
  release: z.string().optional().describe("Filter by release"),
  environment: z
    .array(z.string())
    .optional()
    .describe("Filter by environment(s)"),
  from_timestamp: z
    .string()
    .optional()
    .describe("Only traces on or after this ISO 8601 datetime"),
  to_timestamp: z
    .string()
    .optional()
    .describe("Only traces before this ISO 8601 datetime"),
  order_by: z
    .string()
    .optional()
    .describe(
      "Sort: field.asc/desc. Fields: id, timestamp, name, userId, release, version. Example: timestamp.desc"
    ),
  fields: z
    .string()
    .optional()
    .describe(
      "Comma-separated field groups: core (always), io, scores, observations, metrics. Default: all fields."
    ),
  filter: FilterSchema,
});

const GetTraceSchema = z.object({
  trace_id: z.string().describe("The trace ID to retrieve"),
});

export function registerTraceTools(server: McpServer): void {
  server.registerTool(
    "langfuse_list_traces",
    {
      title: "List Langfuse Traces",
      description: `List traces from Langfuse with filtering, pagination, and field selection.

Supports advanced filtering via the 'filter' parameter (JSON array) covering: timestamp, userId, sessionId, name, tags, metadata, latency, cost, token counts, error/warning counts, scores, and more.

Returns trace data including: id, name, timestamp, userId, sessionId, tags, metadata, latency, totalCost, token counts, observation/score summaries (depending on field selection).

Use 'fields' to control response size: 'core' (always included), 'io' (input/output/metadata), 'scores', 'observations', 'metrics'. Omitting 'observations' or 'scores' returns empty arrays for those; omitting 'metrics' returns -1 for totalCost and latency.`,
      inputSchema: ListTracesSchema,
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
          page: params.page,
        };
        if (params.name) queryParams.name = params.name;
        if (params.user_id) queryParams.userId = params.user_id;
        if (params.session_id) queryParams.sessionId = params.session_id;
        if (params.tags) queryParams.tags = params.tags;
        if (params.version) queryParams.version = params.version;
        if (params.release) queryParams.release = params.release;
        if (params.environment) queryParams.environment = params.environment;
        if (params.from_timestamp) queryParams.fromTimestamp = params.from_timestamp;
        if (params.to_timestamp) queryParams.toTimestamp = params.to_timestamp;
        if (params.order_by) queryParams.orderBy = params.order_by;
        if (params.fields) queryParams.fields = params.fields;
        if (params.filter) queryParams.filter = params.filter;

        const data = await apiGet<Record<string, unknown>>("/traces", queryParams);
        const text = truncateResponse(JSON.stringify(data, null, 2), CHARACTER_LIMIT);

        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );

  server.registerTool(
    "langfuse_get_trace",
    {
      title: "Get Langfuse Trace",
      description: `Get a single trace by ID with full details including all observations, scores, input/output, metadata, latency, and cost breakdown.

Returns the complete trace object with nested observations tree.`,
      inputSchema: GetTraceSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const data = await apiGet<Record<string, unknown>>(
          `/traces/${encodeURIComponent(params.trace_id)}`
        );
        const text = truncateResponse(JSON.stringify(data, null, 2), CHARACTER_LIMIT);
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );
}
