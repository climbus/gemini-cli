/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { CloseDiffRequestSchema, OpenDiffRequestSchema } from './types.js';

export interface IdeDiffProvider {
  showDiff(filePath: string, newContent: string): Promise<void>;
  closeDiff(filePath: string): Promise<string | undefined>;
  onDidChange(
    callback: (notification: { jsonrpc: '2.0'; method: string }) => void,
  ): { dispose: () => void };
}

/**
 * Creates an MCP server configured for IDE integration with openDiff and closeDiff tools.
 */
export function createMcpServerForIde(
  diffProvider: IdeDiffProvider,
  log: (message: string) => void,
): McpServer {
  const server = new McpServer(
    {
      name: 'gemini-cli-companion-mcp-server',
      version: '1.0.0',
    },
    { capabilities: { logging: {} } },
  );

  server.registerTool(
    'openDiff',
    {
      description:
        '(IDE Tool) Open a diff view to create or modify a file. Returns a notification once the diff has been accepted or rejected.',
      inputSchema: OpenDiffRequestSchema.shape,
    },
    async ({ filePath, newContent }: z.infer<typeof OpenDiffRequestSchema>) => {
      log(`Received openDiff request for filePath: ${filePath}`);
      await diffProvider.showDiff(filePath, newContent);
      return { content: [] };
    },
  );

  server.registerTool(
    'closeDiff',
    {
      description: '(IDE Tool) Close an open diff view for a specific file.',
      inputSchema: CloseDiffRequestSchema.shape,
    },
    async ({ filePath }: z.infer<typeof CloseDiffRequestSchema>) => {
      log(`Received closeDiff request for filePath: ${filePath}`);
      const content = await diffProvider.closeDiff(filePath);
      const response = { content: content ?? undefined };
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response),
          },
        ],
      };
    },
  );

  return server;
}
