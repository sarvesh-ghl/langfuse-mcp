---
name: langfuse-mcp
description: Query Langfuse observability data (traces, observations, costs, latencies, errors, metrics) via the langfuse MCP server. Use when the user asks about LLM costs, trace debugging, observation analysis, model performance, latency issues, error investigation, or any Langfuse data query. Triggers on mentions of "langfuse", "traces", "LLM costs", "token usage", "observation latency", "model metrics", "trace errors", or requests to analyze AI/LLM production data.
---

# Langfuse MCP Skill

Query production LLM observability data from Langfuse via the `user-langfuse` MCP server. This MCP is **read-only** — it cannot create, update, or delete any data.

## Available Tools

| Tool | Purpose | Pagination |
|------|---------|-----------|
| `langfuse_list_traces` | List/search traces with advanced filters | Page-based (page + limit) |
| `langfuse_get_trace` | Get a single trace with full observation tree | N/A |
| `langfuse_list_observations` | List observations (spans, generations, events) | Cursor-based (cursor + limit) |
| `langfuse_list_scores` | List scores (numeric, boolean, categorical) | Page-based (page + limit) |
| `langfuse_get_score` | Get a single score | N/A |
| `langfuse_list_sessions` | List sessions | Page-based (page + limit) |
| `langfuse_get_session` | Get a session with its traces | N/A |
| `langfuse_query_metrics` | Aggregated metrics with dimensions and time buckets | Row-limited |

## Common Workflows

### 1. Investigate a Specific Trace
```
langfuse_get_trace(trace_id: "abc123")
```
Returns the full trace with all nested observations, input/output, scores, latency, cost.

### 2. Find Expensive Traces
```
langfuse_list_traces(
  limit: 10,
  order_by: "timestamp.desc",
  filter: '[{"type":"number","column":"totalCost","operator":">=","value":0.05}]'
)
```

### 3. Find Traces with Errors
```
langfuse_list_traces(
  limit: 10,
  filter: '[{"type":"number","column":"errorCount","operator":">=","value":1}]'
)
```

### 4. List Observations for a Trace
```
langfuse_list_observations(
  trace_id: "abc123",
  fields: "core,basic,usage,metrics,model"
)
```

### 5. Find Slow Generations
```
langfuse_list_observations(
  type: "GENERATION",
  fields: "core,basic,usage,metrics,model",
  filter: '[{"type":"number","column":"latency","operator":">=","value":5}]'
)
```

### 6. Cost by Model (Last 7 Days)
```
langfuse_query_metrics(
  view: "observations",
  from_timestamp: "2026-04-03T00:00:00Z",
  to_timestamp: "2026-04-10T00:00:00Z",
  metrics: [{"measure":"totalCost","aggregation":"sum"}, {"measure":"count","aggregation":"count"}],
  dimensions: [{"field":"providedModelName"}]
)
```

### 7. Daily Cost Trend
```
langfuse_query_metrics(
  view: "observations",
  from_timestamp: "2026-03-10T00:00:00Z",
  to_timestamp: "2026-04-10T00:00:00Z",
  metrics: [{"measure":"totalCost","aggregation":"sum"}],
  time_dimension: {"granularity":"day"}
)
```

### 8. P95 Latency by Trace Name
```
langfuse_query_metrics(
  view: "observations",
  from_timestamp: "2026-04-01T00:00:00Z",
  to_timestamp: "2026-04-10T00:00:00Z",
  metrics: [{"measure":"latency","aggregation":"p95"}],
  dimensions: [{"field":"traceName"}]
)
```

### 9. Filter by Environment
```
langfuse_list_traces(
  limit: 20,
  environment: ["production"]
)
```

### 10. Search by User ID
```
langfuse_list_traces(
  user_id: "user_123",
  limit: 20,
  order_by: "timestamp.desc"
)
```

## Advanced Filter Syntax

The `filter` parameter accepts a JSON array of filter objects:

```json
[
  {
    "type": "datetime|string|number|stringOptions|arrayOptions|stringObject|numberObject|boolean|null",
    "column": "column_name",
    "operator": "depends on type",
    "value": "depends on type",
    "key": "required for stringObject/numberObject (metadata filtering)"
  }
]
```

### Trace Filter Columns
- **Core**: id, name, timestamp, userId, sessionId, environment, version, release, tags, bookmarked
- **Metrics**: latency, inputTokens, outputTokens, totalTokens, inputCost, outputCost, totalCost
- **Levels**: level, errorCount, warningCount, defaultCount, debugCount
- **Scores**: scores_avg, score_categories
- **Metadata**: metadata (use stringObject/numberObject type with key)

### Observation Filter Columns
- **Core**: id, type, name, traceId, startTime, endTime, environment, level, statusMessage, version, userId, sessionId
- **Trace**: traceName, traceTags/tags
- **Performance**: latency, timeToFirstToken, tokensPerSecond
- **Tokens**: inputTokens, outputTokens, totalTokens
- **Cost**: inputCost, outputCost, totalCost
- **Model**: model/providedModelName, promptName, promptVersion
- **Metadata**: metadata (with key)

### Operators by Type
- **datetime**: `>`, `<`, `>=`, `<=`
- **string**: `=`, `contains`, `does not contain`, `starts with`, `ends with`
- **number**: `=`, `>`, `<`, `>=`, `<=`
- **stringOptions/categoryOptions**: `any of`, `none of`
- **arrayOptions**: `any of`, `none of`, `all of`
- **boolean**: `=`, `<>`
- **null**: `is null`, `is not null`

## Field Selection

### Trace Fields
`core` (always), `io` (input/output/metadata), `scores`, `observations`, `metrics`

Excluding `observations` or `scores` returns empty arrays. Excluding `metrics` returns -1 for totalCost and latency.

### Observation Fields
`core` (always: id, traceId, startTime, endTime, type), `basic` (name, level, version), `time` (completionStartTime, createdAt), `io` (input, output), `metadata`, `model` (providedModelName, modelParameters), `usage` (usageDetails, costDetails, totalCost), `prompt` (promptId, promptName, promptVersion), `metrics` (latency, timeToFirstToken)

Default: `core,basic`. Recommended for analysis: `core,basic,usage,metrics,model`.

## Metrics API

### Views
- **observations**: spans, generations, events — latency, cost, tokens, count
- **scores-numeric**: numeric/boolean scores — count, value aggregations
- **scores-categorical**: categorical scores — count only

### Aggregations
`sum`, `avg`, `count`, `max`, `min`, `p50`, `p75`, `p90`, `p95`, `p99`, `histogram`

### Dimensions (for groupby)
**Observations**: environment, type, name, level, version, tags, release, traceName, providedModelName, promptName, promptVersion, startTimeMonth

**Do NOT use as dimensions** (high cardinality — use as filters instead): id, traceId, userId, sessionId, parentObservationId

### Time Bucketing
Set `time_dimension.granularity` to: `auto`, `minute`, `hour`, `day`, `week`, `month`

## Tips

1. **Start broad, then narrow**: List recent traces first, then drill into specific ones with get_trace
2. **Use field selection**: Only request the fields you need to keep responses manageable
3. **Observations use cursor pagination**: Save the cursor from the response and pass it to get the next page
4. **Traces use page pagination**: Use page + limit
5. **For large sessions**: Use `langfuse_list_traces(session_id: "...")` instead of `langfuse_get_session` for paginated access
6. **Metrics for aggregates**: Use `langfuse_query_metrics` for cost/latency summaries instead of listing individual items
7. **Metadata filtering**: Use stringObject type with a key parameter to filter on custom metadata fields
