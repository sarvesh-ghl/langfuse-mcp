import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, handleApiError, truncateResponse } from "../api-client.js";
import { CHARACTER_LIMIT, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../constants.js";

const ListScoresSchema = z.object({
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
  trace_id: z.string().optional().describe("Filter by trace ID"),
  session_id: z.string().optional().describe("Filter by session ID"),
  observation_id: z
    .string()
    .optional()
    .describe("Comma-separated observation IDs to filter by"),
  name: z.string().optional().describe("Filter by score name"),
  source: z
    .string()
    .optional()
    .describe("Filter by source: API, ANNOTATION, EVAL"),
  data_type: z
    .string()
    .optional()
    .describe("Filter by data type: NUMERIC, BOOLEAN, CATEGORICAL"),
  config_id: z.string().optional().describe("Filter by score config ID"),
  queue_id: z
    .string()
    .optional()
    .describe("Filter by annotation queue ID"),
  user_id: z
    .string()
    .optional()
    .describe("Filter by user ID (associated trace)"),
  trace_tags: z
    .array(z.string())
    .optional()
    .describe("Only scores linked to traces with ALL of these tags"),
  score_ids: z
    .string()
    .optional()
    .describe("Comma-separated score IDs to limit results"),
  dataset_run_id: z
    .string()
    .optional()
    .describe("Filter by dataset run ID"),
  environment: z
    .array(z.string())
    .optional()
    .describe("Filter by environment(s)"),
  from_timestamp: z
    .string()
    .optional()
    .describe("Only scores on or after this ISO 8601 datetime"),
  to_timestamp: z
    .string()
    .optional()
    .describe("Only scores before this ISO 8601 datetime"),
  fields: z
    .string()
    .optional()
    .describe(
      "Field groups: 'score' (core fields), 'trace' (userId, tags, environment, sessionId). Default: both."
    ),
  filter: z
    .string()
    .optional()
    .describe(
      "JSON array of filter objects for metadata filtering. Example: [{\"type\":\"stringObject\",\"column\":\"metadata\",\"key\":\"user_id\",\"operator\":\"=\",\"value\":\"abc123\"}]"
    ),
});

const GetScoreSchema = z.object({
  score_id: z.string().describe("The score ID to retrieve"),
});

export function registerScoreTools(server: McpServer): void {
  server.registerTool(
    "langfuse_list_scores",
    {
      title: "List Langfuse Scores",
      description: `List scores from Langfuse with filtering and pagination. Supports both trace-level and session-level scores.

Filter by trace, session, observation, name, source (API/ANNOTATION/EVAL), data type (NUMERIC/BOOLEAN/CATEGORICAL), config, queue, user, tags, dataset run, environment, and time range.

Use 'fields' to control response: 'score' for core score data, 'trace' for associated trace properties. Default includes both.`,
      inputSchema: ListScoresSchema,
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
        if (params.trace_id) queryParams.traceId = params.trace_id;
        if (params.session_id) queryParams.sessionId = params.session_id;
        if (params.observation_id) queryParams.observationId = params.observation_id;
        if (params.name) queryParams.name = params.name;
        if (params.source) queryParams.source = params.source;
        if (params.data_type) queryParams.dataType = params.data_type;
        if (params.config_id) queryParams.configId = params.config_id;
        if (params.queue_id) queryParams.queueId = params.queue_id;
        if (params.user_id) queryParams.userId = params.user_id;
        if (params.trace_tags) queryParams.traceTags = params.trace_tags;
        if (params.score_ids) queryParams.scoreIds = params.score_ids;
        if (params.dataset_run_id) queryParams.datasetRunId = params.dataset_run_id;
        if (params.environment) queryParams.environment = params.environment;
        if (params.from_timestamp) queryParams.fromTimestamp = params.from_timestamp;
        if (params.to_timestamp) queryParams.toTimestamp = params.to_timestamp;
        if (params.fields) queryParams.fields = params.fields;
        if (params.filter) queryParams.filter = params.filter;

        const data = await apiGet<Record<string, unknown>>(
          "/v2/scores",
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
    "langfuse_get_score",
    {
      title: "Get Langfuse Score",
      description: `Get a single score by ID. Returns the complete score object including value, trace/observation association, and metadata.`,
      inputSchema: GetScoreSchema,
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
          `/v2/scores/${encodeURIComponent(params.score_id)}`
        );
        const text = JSON.stringify(data, null, 2);
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: handleApiError(error) }] };
      }
    }
  );
}
