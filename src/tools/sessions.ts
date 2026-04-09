import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, handleApiError, truncateResponse } from "../api-client.js";
import { CHARACTER_LIMIT, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../constants.js";

const ListSessionsSchema = z.object({
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
  environment: z
    .array(z.string())
    .optional()
    .describe("Filter by environment(s)"),
  from_timestamp: z
    .string()
    .optional()
    .describe("Only sessions created on or after this ISO 8601 datetime"),
  to_timestamp: z
    .string()
    .optional()
    .describe("Only sessions created before this ISO 8601 datetime"),
});

const GetSessionSchema = z.object({
  session_id: z.string().describe("The session ID to retrieve"),
});

export function registerSessionTools(server: McpServer): void {
  server.registerTool(
    "langfuse_list_sessions",
    {
      title: "List Langfuse Sessions",
      description: `List sessions from Langfuse with pagination and optional environment/time filters.

Returns session summaries. For large sessions, use langfuse_list_traces with session_id filter instead of get_session to get paginated trace data.`,
      inputSchema: ListSessionsSchema,
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
        if (params.environment) queryParams.environment = params.environment;
        if (params.from_timestamp) queryParams.fromTimestamp = params.from_timestamp;
        if (params.to_timestamp) queryParams.toTimestamp = params.to_timestamp;

        const data = await apiGet<Record<string, unknown>>(
          "/sessions",
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

  server.registerTool(
    "langfuse_get_session",
    {
      title: "Get Langfuse Session",
      description: `Get a single session by ID with its traces. Note: traces are NOT paginated on this endpoint. For large sessions, use langfuse_list_traces with session_id filter instead.`,
      inputSchema: GetSessionSchema,
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
          `/sessions/${encodeURIComponent(params.session_id)}`
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
