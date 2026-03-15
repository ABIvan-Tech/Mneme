import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { SelfMemoryError } from "./errors.js";

function formatError(error: unknown): { code?: string; message: string; details?: Record<string, unknown> } {
  if (error instanceof SelfMemoryError) {
    return error.toJSON();
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: String(error) };
}

export function okResult(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function errorResult(error: unknown): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: formatError(error) }, null, 2),
      },
    ],
  };
}

export function jsonResource(uri: string, value: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}
