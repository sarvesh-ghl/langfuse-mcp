import axios, { AxiosError, AxiosInstance } from "axios";
import { API_TIMEOUT_MS } from "./constants.js";

let client: AxiosInstance | null = null;

function getConfig(): { host: string; publicKey: string; secretKey: string } {
  const host = process.env.LANGFUSE_HOST;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!host || !publicKey || !secretKey) {
    throw new Error(
      "Missing required environment variables: LANGFUSE_HOST, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY"
    );
  }

  return { host: host.replace(/\/+$/, ""), publicKey, secretKey };
}

function getClient(): AxiosInstance {
  if (client) return client;

  const { host, publicKey, secretKey } = getConfig();
  const basicAuth = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");

  client = axios.create({
    baseURL: `${host}/api/public`,
    timeout: API_TIMEOUT_MS,
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  return client;
}

export async function apiGet<T>(
  path: string,
  params?: Record<string, unknown>
): Promise<T> {
  const http = getClient();
  const response = await http.get<T>(path, { params });
  return response.data;
}

export function handleApiError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response) {
      const status = error.response.status;
      const body =
        typeof error.response.data === "string"
          ? error.response.data
          : JSON.stringify(error.response.data, null, 2);

      switch (status) {
        case 400:
          return `Error: Bad request. ${body}`;
        case 401:
          return "Error: Unauthorized. Check your LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY.";
        case 403:
          return "Error: Forbidden. Your API key does not have access to this resource.";
        case 404:
          return "Error: Resource not found. Verify the ID is correct.";
        case 429:
          return "Error: Rate limit exceeded. Wait before making more requests.";
        default:
          return `Error: API returned status ${status}. ${body}`;
      }
    } else if (error.code === "ECONNABORTED") {
      return "Error: Request timed out. The query may be too broad—try adding filters or reducing the limit.";
    } else if (error.code === "ECONNREFUSED") {
      return `Error: Connection refused. Check that LANGFUSE_HOST is correct.`;
    }
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

export function truncateResponse(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return (
    text.slice(0, limit) +
    "\n\n--- RESPONSE TRUNCATED ---\nUse pagination (limit/page or cursor) or add filters to reduce the result set."
  );
}
