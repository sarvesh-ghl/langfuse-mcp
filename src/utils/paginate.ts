import { apiGet } from "../api-client.js";
import {
  ANALYTICS_API_TIMEOUT_MS,
  ANALYTICS_PAGE_SIZE,
  MAX_ANALYTICS_TRACES,
} from "../constants.js";

export interface PaginateOptions {
  name?: string;
  fromTimestamp: string;
  toTimestamp: string;
  fields?: string;
  environment?: string[];
  tags?: string[];
  filter?: string;
}

export interface TraceSlim {
  id: string;
  timestamp: string;
  metadata: Record<string, unknown>;
  errorCount: number;
  latency: number;
  totalCost: number;
}

interface TracesApiResponse {
  data: Array<{
    id: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
    errorCount?: number;
    latency?: number;
    totalCost?: number;
  }>;
  meta: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
  };
}

/**
 * Paginate through all traces matching the given filters, extracting only
 * the slim fields needed for analytics (id, timestamp, metadata, errorCount,
 * latency, totalCost). Stops at MAX_ANALYTICS_TRACES to bound memory.
 */
export async function paginateAllTraces(
  options: PaginateOptions
): Promise<{ traces: TraceSlim[]; totalItems: number; truncated: boolean }> {
  const allTraces: TraceSlim[] = [];
  let page = 1;
  let totalPages = 1;
  let totalItems = 0;
  let truncated = false;

  while (page <= totalPages) {
    const queryParams: Record<string, unknown> = {
      limit: ANALYTICS_PAGE_SIZE,
      page,
      fields: options.fields ?? "core,io",
    };
    if (options.name) queryParams.name = options.name;
    if (options.fromTimestamp) queryParams.fromTimestamp = options.fromTimestamp;
    if (options.toTimestamp) queryParams.toTimestamp = options.toTimestamp;
    if (options.environment) queryParams.environment = options.environment;
    if (options.tags) queryParams.tags = options.tags;
    if (options.filter) queryParams.filter = options.filter;

    const data = await apiGet<TracesApiResponse>("/traces", queryParams, {
      timeout: ANALYTICS_API_TIMEOUT_MS,
    });

    totalPages = data.meta.totalPages;
    totalItems = data.meta.totalItems;

    for (const trace of data.data) {
      allTraces.push({
        id: trace.id,
        timestamp: trace.timestamp,
        metadata: trace.metadata ?? {},
        errorCount: trace.errorCount ?? 0,
        latency: trace.latency ?? -1,
        totalCost: trace.totalCost ?? -1,
      });
    }

    if (allTraces.length >= MAX_ANALYTICS_TRACES) {
      truncated = true;
      break;
    }

    page++;
  }

  return { traces: allTraces, totalItems, truncated };
}

/** Generate day boundaries between two YYYY-MM-DD dates (inclusive start, exclusive end). */
export function generateTimeBuckets(
  fromDate: string,
  toDate: string,
  granularity: "day" | "week"
): Array<{ label: string; from: string; to: string }> {
  const buckets: Array<{ label: string; from: string; to: string }> = [];
  const start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  const stepDays = granularity === "week" ? 7 : 1;

  let cursor = new Date(start);
  while (cursor < end) {
    const bucketEnd = new Date(cursor);
    bucketEnd.setUTCDate(bucketEnd.getUTCDate() + stepDays);
    const effectiveEnd = bucketEnd > end ? end : bucketEnd;

    buckets.push({
      label: cursor.toISOString().slice(0, 10),
      from: cursor.toISOString(),
      to: effectiveEnd.toISOString(),
    });

    cursor = new Date(bucketEnd);
  }

  return buckets;
}
