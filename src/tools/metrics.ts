import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, handleApiError, truncateResponse } from "../api-client.js";
import { CHARACTER_LIMIT } from "../constants.js";

const QueryMetricsSchema = z.object({
  view: z
    .enum(["observations", "scores-numeric", "scores-categorical"])
    .describe("Data view to query"),
  from_timestamp: z
    .string()
    .describe("Start of time range (ISO 8601, required)"),
  to_timestamp: z
    .string()
    .describe("End of time range (ISO 8601, required)"),
  metrics: z
    .array(
      z.object({
        measure: z.string().describe(
          "What to measure. Observations: count, latency, streamingLatency, inputTokens, outputTokens, totalTokens, outputTokensPerSecond, tokensPerSecond, inputCost, outputCost, totalCost, timeToFirstToken, countScores. Scores-numeric: count, value. Scores-categorical: count."
        ),
        aggregation: z
          .enum([
            "sum",
            "avg",
            "count",
            "max",
            "min",
            "p50",
            "p75",
            "p90",
            "p95",
            "p99",
            "histogram",
          ])
          .describe("Aggregation function"),
      })
    )
    .min(1)
    .describe("At least one metric must be provided"),
  dimensions: z
    .array(
      z.object({
        field: z.string().describe(
          "Field to group by. Observations: environment, type, name, level, version, tags, release, traceName, providedModelName, promptName, promptVersion, startTimeMonth. Scores: environment, name, source, dataType, configId, timestampMonth, timestampDay, value/stringValue, traceName, tags, observationName, observationModelName."
        ),
      })
    )
    .optional()
    .describe("Dimensions to group by (avoid high-cardinality fields like id, traceId, userId, sessionId)"),
  filters: z
    .array(
      z.object({
        column: z.string().describe("Column to filter on"),
        operator: z.string().describe("Filter operator"),
        value: z.unknown().describe("Value to compare against"),
        type: z
          .string()
          .describe(
            "Filter type: datetime, string, number, stringOptions, arrayOptions, stringObject, numberObject, boolean, null"
          ),
        key: z
          .string()
          .optional()
          .describe("Required for stringObject/numberObject types"),
      })
    )
    .optional()
    .describe("Filter conditions"),
  time_dimension: z
    .object({
      granularity: z
        .enum(["auto", "minute", "hour", "day", "week", "month"])
        .describe("Time bucket granularity"),
    })
    .optional()
    .describe("If provided, results are grouped by time buckets"),
  order_by: z
    .array(
      z.object({
        field: z.string().describe("Field to order by"),
        direction: z.enum(["asc", "desc"]).describe("Sort direction"),
      })
    )
    .optional()
    .describe("Ordering"),
  row_limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("Maximum rows to return (1-1000, default 100)"),
  bins: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Number of histogram bins (1-100, default 10)"),
});

export function registerMetricsTools(server: McpServer): void {
  server.registerTool(
    "langfuse_query_metrics",
    {
      title: "Query Langfuse Metrics",
      description: `Query aggregated metrics from Langfuse (v2 endpoint). Supports observations view and scores views with flexible dimensions, filters, time bucketing, and aggregations.

Views:
- observations: query span/generation/event metrics (latency, cost, tokens, count)
- scores-numeric: query numeric/boolean score aggregations
- scores-categorical: query categorical score counts

Aggregations: sum, avg, count, max, min, p50, p75, p90, p95, p99, histogram.
Time granularity: auto, minute, hour, day, week, month.

Important: Do NOT use high-cardinality fields (id, traceId, userId, sessionId, observationId) as dimensions—use them as filters instead.

Example: Total cost by model over last 7 days:
{ view: "observations", from_timestamp: "2024-01-01T00:00:00Z", to_timestamp: "2024-01-08T00:00:00Z", metrics: [{ measure: "totalCost", aggregation: "sum" }], dimensions: [{ field: "providedModelName" }] }`,
      inputSchema: QueryMetricsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const query: Record<string, unknown> = {
          view: params.view,
          fromTimestamp: params.from_timestamp,
          toTimestamp: params.to_timestamp,
          metrics: params.metrics,
          dimensions: params.dimensions ?? [],
          filters: params.filters ?? [],
        };
        if (params.time_dimension) query.timeDimension = params.time_dimension;
        if (params.order_by) query.orderBy = params.order_by;

        const config: Record<string, unknown> = {};
        if (params.row_limit) config.row_limit = params.row_limit;
        if (params.bins) config.bins = params.bins;
        if (Object.keys(config).length > 0) query.config = config;

        const data = await apiGet<Record<string, unknown>>("/v2/metrics", {
          query: JSON.stringify(query),
        });

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
