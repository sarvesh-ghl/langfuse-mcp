# Langfuse MCP Server

Read-only MCP server for querying [Langfuse](https://langfuse.com) observability data — traces, observations, scores, sessions, and aggregated metrics.

Built for HIPAA-compliant Langfuse cloud instances where the `langfuse-cli` cannot connect.

## Tools

| Tool | Description |
|------|-------------|
| `langfuse_list_traces` | List/search traces with advanced filters, pagination, field selection |
| `langfuse_get_trace` | Get a single trace with full observation tree |
| `langfuse_list_observations` | List observations with cursor-based pagination and field selection |
| `langfuse_list_scores` | List scores with filtering |
| `langfuse_get_score` | Get a single score |
| `langfuse_list_sessions` | List sessions |
| `langfuse_get_session` | Get a session with its traces |
| `langfuse_query_metrics` | Aggregated metrics (cost, latency, tokens) with dimensions and time bucketing |

## Setup

### Build

```bash
npm install
npm run build
```

### Cursor MCP Configuration

Add to `~/.cursor/mcp.json`. Credentials are passed via the `env` block — no need to export them in your shell.

```json
{
  "mcpServers": {
    "langfuse": {
      "command": "node",
      "args": ["/path/to/langfuse-mcp/dist/index.js"],
      "env": {
        "LANGFUSE_HOST": "https://hipaa.cloud.langfuse.com",
        "LANGFUSE_PUBLIC_KEY": "pk-lf-...",
        "LANGFUSE_SECRET_KEY": "sk-lf-..."
      }
    }
  }
}
```

### Standalone Usage (without Cursor)

If running the server directly, set these environment variables first:

```bash
export LANGFUSE_HOST=https://hipaa.cloud.langfuse.com
export LANGFUSE_PUBLIC_KEY=pk-lf-...
export LANGFUSE_SECRET_KEY=sk-lf-...
node dist/index.js
```

## API Endpoints Used

All read-only:
- `GET /api/public/traces` — list traces (page-based)
- `GET /api/public/traces/{id}` — get trace
- `GET /api/public/v2/observations` — list observations (cursor-based)
- `GET /api/public/v2/scores` — list scores (page-based)
- `GET /api/public/v2/scores/{id}` — get score
- `GET /api/public/sessions` — list sessions
- `GET /api/public/sessions/{id}` — get session
- `GET /api/public/v2/metrics` — query metrics
