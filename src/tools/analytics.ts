import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleApiError, truncateResponse } from "../api-client.js";
import { CHARACTER_LIMIT } from "../constants.js";
import { apiGet } from "../api-client.js";
import {
  paginateAllTraces,
  generateTimeBuckets,
  type TraceSlim,
} from "../utils/paginate.js";
import { ANALYTICS_API_TIMEOUT_MS } from "../constants.js";

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const DateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD");

const GranularityEnum = z.enum(["day", "week"]).default("day");

const EnvironmentFilter = z
  .array(z.string())
  .optional()
  .describe("Filter by environment(s)");

const TagsFilter = z
  .array(z.string())
  .optional()
  .describe("Filter traces with ALL of these tags");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countUnique(
  traces: TraceSlim[],
  metadataField: string
): { uniqueCount: number; values: Set<string> } {
  const values = new Set<string>();
  for (const t of traces) {
    const val = t.metadata[metadataField];
    if (val != null) values.add(String(val));
  }
  return { uniqueCount: values.size, values };
}

function buildFrequencyMap(
  traces: TraceSlim[],
  metadataField: string
): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of traces) {
    const val = t.metadata[metadataField];
    if (val == null) continue;
    const key = String(val);
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  return freq;
}

function distributionBuckets(
  freq: Map<string, number>
): Record<string, number> {
  const buckets: Record<string, number> = {
    "1": 0,
    "2-5": 0,
    "6-20": 0,
    "21-50": 0,
    "51-100": 0,
    "100+": 0,
  };
  for (const count of freq.values()) {
    if (count === 1) buckets["1"]++;
    else if (count <= 5) buckets["2-5"]++;
    else if (count <= 20) buckets["6-20"]++;
    else if (count <= 50) buckets["21-50"]++;
    else if (count <= 100) buckets["51-100"]++;
    else buckets["100+"]++;
  }
  return buckets;
}

function topN(
  freq: Map<string, number>,
  n: number,
  totalExecs: number
): Array<{ entity_id: string; executions: number; percentage: string }> {
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id, count]) => ({
      entity_id: id,
      executions: count,
      percentage: ((count / totalExecs) * 100).toFixed(1),
    }));
}

function cumulativePct(
  sorted: Array<[string, number]>,
  n: number,
  total: number
): string {
  const sum = sorted.slice(0, n).reduce((s, [, c]) => s + c, 0);
  return ((sum / total) * 100).toFixed(1);
}

// ---------------------------------------------------------------------------
// Tool 1: langfuse_trace_analytics
// ---------------------------------------------------------------------------

const TraceAnalyticsSchema = z.object({
  trace_name: z.string().describe('Trace name to analyze (e.g. "ai_agent")'),
  from_date: DateString.describe("Start date inclusive (YYYY-MM-DD)"),
  to_date: DateString.describe("End date exclusive (YYYY-MM-DD)"),
  metadata_fields: z
    .array(z.string())
    .default(["locationId"])
    .describe(
      'Metadata keys to count unique values for (default: ["locationId"])'
    ),
  granularity: GranularityEnum.describe(
    'Time bucket granularity: "day" or "week" (default: "day")'
  ),
  environment: EnvironmentFilter,
  tags: TagsFilter,
});

async function handleTraceAnalytics(
  params: z.infer<typeof TraceAnalyticsSchema>
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    const buckets = generateTimeBuckets(
      params.from_date,
      params.to_date,
      params.granularity
    );

    const globalUniques: Record<string, Set<string>> = {};
    for (const field of params.metadata_fields) {
      globalUniques[field] = new Set();
    }
    let globalExecs = 0;
    let anyTruncated = false;

    const dailyResults: Array<Record<string, unknown>> = [];

    // Fetch each bucket in sequence (Langfuse is rate-limited)
    for (const bucket of buckets) {
      const { traces, truncated } = await paginateAllTraces({
        name: params.trace_name,
        fromTimestamp: bucket.from,
        toTimestamp: bucket.to,
        environment: params.environment,
        tags: params.tags,
      });

      if (truncated) anyTruncated = true;
      globalExecs += traces.length;

      const row: Record<string, unknown> = {
        date: bucket.label,
        executions: traces.length,
      };

      for (const field of params.metadata_fields) {
        const { uniqueCount, values } = countUnique(traces, field);
        row[`unique_${field}`] = uniqueCount;
        row[`avg_exec_per_${field}`] =
          uniqueCount > 0
            ? Number((traces.length / uniqueCount).toFixed(2))
            : 0;
        for (const v of values) globalUniques[field].add(v);
      }

      dailyResults.push(row);
    }

    const totals: Record<string, unknown> = {
      total_executions: globalExecs,
    };
    for (const field of params.metadata_fields) {
      totals[`total_unique_${field}`] = globalUniques[field].size;
      totals[`avg_exec_per_${field}`] =
        globalUniques[field].size > 0
          ? Number((globalExecs / globalUniques[field].size).toFixed(2))
          : 0;
    }

    const result: Record<string, unknown> = {
      trace_name: params.trace_name,
      period: `${params.from_date} to ${params.to_date}`,
      granularity: params.granularity,
      daily: dailyResults,
      totals,
    };

    if (anyTruncated) {
      result.warning =
        "Some time buckets exceeded the trace limit — results may be partial.";
    }

    const text = truncateResponse(
      JSON.stringify(result, null, 2),
      CHARACTER_LIMIT
    );
    return { content: [{ type: "text", text }] };
  } catch (error) {
    return { content: [{ type: "text", text: handleApiError(error) }] };
  }
}

// ---------------------------------------------------------------------------
// Tool 2: langfuse_entity_distribution
// ---------------------------------------------------------------------------

const EntityDistributionSchema = z.object({
  trace_name: z.string().describe('Trace name to analyze (e.g. "ai_agent")'),
  from_date: DateString.describe("Start date inclusive (YYYY-MM-DD)"),
  to_date: DateString.describe("End date exclusive (YYYY-MM-DD)"),
  metadata_field: z
    .string()
    .describe(
      'Metadata key to analyze distribution for (e.g. "locationId", "workflowId")'
    ),
  top_n: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Number of top entities to return (default: 20)"),
  environment: EnvironmentFilter,
  tags: TagsFilter,
});

async function handleEntityDistribution(
  params: z.infer<typeof EntityDistributionSchema>
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    const { traces, truncated } = await paginateAllTraces({
      name: params.trace_name,
      fromTimestamp: `${params.from_date}T00:00:00Z`,
      toTimestamp: `${params.to_date}T00:00:00Z`,
      environment: params.environment,
      tags: params.tags,
    });

    const freq = buildFrequencyMap(traces, params.metadata_field);
    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    const totalExecs = traces.length;

    const result: Record<string, unknown> = {
      trace_name: params.trace_name,
      period: `${params.from_date} to ${params.to_date}`,
      metadata_field: params.metadata_field,
      total_entities: freq.size,
      total_executions: totalExecs,
      avg_executions_per_entity:
        freq.size > 0 ? Number((totalExecs / freq.size).toFixed(2)) : 0,
      top_n: topN(freq, params.top_n, totalExecs),
      skewness: {
        top_10_cumulative_pct: cumulativePct(sorted, 10, totalExecs),
        top_20_cumulative_pct: cumulativePct(sorted, 20, totalExecs),
      },
      distribution: distributionBuckets(freq),
    };

    if (truncated) {
      result.warning =
        "Trace limit reached — results are based on a partial dataset.";
    }

    const text = truncateResponse(
      JSON.stringify(result, null, 2),
      CHARACTER_LIMIT
    );
    return { content: [{ type: "text", text }] };
  } catch (error) {
    return { content: [{ type: "text", text: handleApiError(error) }] };
  }
}

// ---------------------------------------------------------------------------
// Tool 3: langfuse_error_analytics
// ---------------------------------------------------------------------------

const ErrorAnalyticsSchema = z.object({
  trace_name: z.string().describe('Trace name to analyze (e.g. "ai_agent")'),
  from_date: DateString.describe("Start date inclusive (YYYY-MM-DD)"),
  to_date: DateString.describe("End date exclusive (YYYY-MM-DD)"),
  group_by_metadata: z
    .string()
    .optional()
    .describe(
      'Optional metadata field to group errors by (e.g. "locationId")'
    ),
  granularity: GranularityEnum.describe(
    'Time bucket granularity: "day" or "week" (default: "day")'
  ),
  environment: EnvironmentFilter,
  tags: TagsFilter,
});

interface TracesListMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

/**
 * Get totalItems count for a trace query without fetching all pages.
 * Uses limit=1 to minimise payload.
 */
async function countTraces(queryParams: Record<string, unknown>): Promise<number> {
  const data = await apiGet<{ meta: TracesListMeta }>(
    "/traces",
    { ...queryParams, limit: 1, page: 1, fields: "core" },
    { timeout: ANALYTICS_API_TIMEOUT_MS }
  );
  return data.meta.totalItems;
}

async function handleErrorAnalytics(
  params: z.infer<typeof ErrorAnalyticsSchema>
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    const buckets = generateTimeBuckets(
      params.from_date,
      params.to_date,
      params.granularity
    );

    let globalTotal = 0;
    let globalErrors = 0;
    let anyTruncated = false;
    const errorEntityFreq = new Map<string, number>();

    const dailyResults: Array<Record<string, unknown>> = [];

    const errorFilter = JSON.stringify([
      { type: "number", column: "errorCount", operator: ">=", value: 1 },
    ]);

    for (const bucket of buckets) {
      const baseQuery: Record<string, unknown> = {
        name: params.trace_name,
        fromTimestamp: bucket.from,
        toTimestamp: bucket.to,
      };
      if (params.environment) baseQuery.environment = params.environment;
      if (params.tags) baseQuery.tags = params.tags;

      // Two lightweight count calls instead of full pagination
      const total = await countTraces(baseQuery);
      const errorCount = await countTraces({ ...baseQuery, filter: errorFilter });

      globalTotal += total;
      globalErrors += errorCount;

      // If grouping by metadata, paginate error traces to extract the field
      if (params.group_by_metadata && errorCount > 0) {
        const { traces, truncated } = await paginateAllTraces({
          ...baseQuery,
          fromTimestamp: bucket.from,
          toTimestamp: bucket.to,
          name: params.trace_name,
          filter: errorFilter,
          environment: params.environment,
          tags: params.tags,
        });
        if (truncated) anyTruncated = true;

        for (const t of traces) {
          const val = t.metadata[params.group_by_metadata];
          if (val == null) continue;
          const key = String(val);
          errorEntityFreq.set(key, (errorEntityFreq.get(key) ?? 0) + 1);
        }
      }

      dailyResults.push({
        date: bucket.label,
        total_executions: total,
        error_count: errorCount,
        error_rate:
          total > 0 ? `${((errorCount / total) * 100).toFixed(1)}%` : "0%",
      });
    }

    const result: Record<string, unknown> = {
      trace_name: params.trace_name,
      period: `${params.from_date} to ${params.to_date}`,
      granularity: params.granularity,
      daily: dailyResults,
      totals: {
        total_executions: globalTotal,
        total_errors: globalErrors,
        overall_error_rate:
          globalTotal > 0
            ? `${((globalErrors / globalTotal) * 100).toFixed(1)}%`
            : "0%",
      },
    };

    if (params.group_by_metadata && errorEntityFreq.size > 0) {
      const sorted = [...errorEntityFreq.entries()].sort(
        (a, b) => b[1] - a[1]
      );
      result[`errors_by_${params.group_by_metadata}`] = sorted
        .slice(0, 20)
        .map(([id, count]) => ({
          entity_id: id,
          error_count: count,
          pct_of_errors:
            globalErrors > 0
              ? `${((count / globalErrors) * 100).toFixed(1)}%`
              : "0%",
        }));
    }

    if (anyTruncated) {
      result.warning =
        "Some time buckets exceeded the trace limit — results may be partial.";
    }

    const text = truncateResponse(
      JSON.stringify(result, null, 2),
      CHARACTER_LIMIT
    );
    return { content: [{ type: "text", text }] };
  } catch (error) {
    return { content: [{ type: "text", text: handleApiError(error) }] };
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerAnalyticsTools(server: McpServer): void {
  server.registerTool(
    "langfuse_trace_analytics",
    {
      title: "Trace Analytics",
      description: `Daily/weekly execution breakdown with unique entity counts from trace metadata.

Use this for product & adoption analytics: daily active locations, unique workflows, execution trends over time.

Returns per time bucket: execution count, unique count for each requested metadata field, and average executions per unique entity. Also returns cumulative totals across the full period.

Example: Daily ai_agent executions with unique locations and workflows:
{ trace_name: "ai_agent", from_date: "2026-04-08", to_date: "2026-04-16", metadata_fields: ["locationId", "workflowId"] }`,
      inputSchema: TraceAnalyticsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    handleTraceAnalytics
  );

  server.registerTool(
    "langfuse_entity_distribution",
    {
      title: "Entity Distribution & Skewness",
      description: `Distribution and skewness analysis for any trace metadata field.

Answers: "Are executions concentrated in a few locations or spread broadly?" Returns top-N entities by execution count, cumulative percentages (top 10 / top 20), and frequency distribution buckets.

Example: Location skewness for ai_agent:
{ trace_name: "ai_agent", from_date: "2026-04-08", to_date: "2026-04-16", metadata_field: "locationId", top_n: 20 }`,
      inputSchema: EntityDistributionSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    handleEntityDistribution
  );

  server.registerTool(
    "langfuse_error_analytics",
    {
      title: "Error Analytics",
      description: `Error rate analysis over time with optional grouping by metadata field.

Returns daily error counts and rates. Optionally groups errors by a metadata field (e.g. locationId) to identify which entities have the most failures.

Example: Daily error rates for ai_agent grouped by location:
{ trace_name: "ai_agent", from_date: "2026-04-08", to_date: "2026-04-16", group_by_metadata: "locationId" }`,
      inputSchema: ErrorAnalyticsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    handleErrorAnalytics
  );
}
