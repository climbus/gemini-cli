/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IDEServer } from './ide-server.js';
import { ContextManager } from './context-manager.js';
import { NvimDiffManager } from './diff-manager.js';
import type { NeovimClient } from 'neovim';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as http from 'node:http';

vi.mock('./context-manager.js');
vi.mock('./diff-manager.js');
vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'test-auth-token'),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(() => Promise.resolve(undefined)),
  unlink: vi.fn(() => Promise.resolve(undefined)),
  chmod: vi.fn(() => Promise.resolve(undefined)),
  mkdir: vi.fn(() => Promise.resolve(undefined)),
  readdir: vi.fn(() => Promise.resolve([])),
  stat: vi.fn(() => Promise.resolve({ mtimeMs: Date.now() })),
}));

vi.mock('@google/gemini-cli-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@google/gemini-cli-core')>();
  return {
    ...actual,
    tmpdir: vi.fn(() => '/tmp'),
  };
});

const request = (
  port: number,
  options: http.RequestOptions,
  body?: string,
): Promise<{ statusCode?: number; body: string }> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        ...options,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () =>
          resolve({ statusCode: res.statusCode, body: data }),
        );
      },
    );
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });

describe('IDEServer', () => {
  let server: IDEServer;
  let mockContextManager: ContextManager;
  let mockDiffManager: NvimDiffManager;
  let log: (message: string) => void;
  let mockNvim: NeovimClient;
  let port: number;

  beforeEach(() => {
    mockNvim = {} as unknown as NeovimClient;
    mockContextManager = new ContextManager(mockNvim);
    mockDiffManager = new NvimDiffManager(mockNvim);
    log = vi.fn();

    server = new IDEServer(log, mockContextManager, mockDiffManager, {
      workspacePath: '/tmp/workspace',
      processId: 1234,
      ideInfo: { name: 'nvim', displayName: 'Neovim' },
    });
  });

  afterEach(async () => {
    await server.stop();
    vi.restoreAllMocks();
  });

  describe('Lifecycle & File System', () => {
    it('should write port file and shell script on start', async () => {
      await server.start();

      const portDir = path.join('/tmp', 'gemini', 'ide');
      expect(fs.mkdir).toHaveBeenCalledWith(portDir, { recursive: true });

      // Check port file
      const expectedPortFile = expect.stringMatching(
        /gemini-ide-server-1234-\d+\.json/,
      );
      const expectedContent = expect.stringContaining(
        '"authToken":"test-auth-token"',
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expectedPortFile,
        expectedContent,
      );

      // Check shell script
      const expectedScript = path.join(portDir, 'nvim-env-1234.sh');
      const expectedScriptContent = expect.stringContaining(
        'export GEMINI_CLI_IDE_AUTH_TOKEN=test-auth-token',
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expectedScript,
        expectedScriptContent,
        { mode: 0o600 },
      );
    });

    it('should cleanup files on stop', async () => {
      await server.start();
      await server.stop();

      const portDir = path.join('/tmp', 'gemini', 'ide');
      const expectedScript = path.join(portDir, 'nvim-env-1234.sh');
      expect(fs.unlink).toHaveBeenCalledWith(expectedScript);
    });

    it('should sync env vars', async () => {
      await server.start();
      vi.clearAllMocks();

      await server.syncEnvVars();

      const portDir = path.join('/tmp', 'gemini', 'ide');
      const expectedScript = path.join(portDir, 'nvim-env-1234.sh');
      expect(fs.writeFile).toHaveBeenCalledWith(
        expectedScript,
        expect.any(String),
        { mode: 0o600 },
      );
    });
  });

  describe('HTTP Endpoints & Security', () => {
    beforeEach(async () => {
      await server.start();
      port = (server as unknown as { port: number }).port;
    });

    it('should reject requests without auth token', async () => {
      const { statusCode } = await request(
        port,
        {
          method: 'POST',
          path: '/mcp',
          headers: { 'Content-Type': 'application/json' },
        },
        JSON.stringify({ jsonrpc: '2.0', method: 'initialize' }),
      );

      expect(statusCode).toBe(401);
    });

    it('should reject requests with invalid auth token', async () => {
      const { statusCode } = await request(
        port,
        {
          method: 'POST',
          path: '/mcp',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer invalid-token',
          },
        },
        JSON.stringify({ jsonrpc: '2.0', method: 'initialize' }),
      );

      expect(statusCode).toBe(401);
    });

    it('should allow requests with valid auth token', async () => {
      const { statusCode } = await request(
        port,
        {
          method: 'POST',
          path: '/mcp',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-auth-token',
            Host: `localhost:${port}`,
          },
        },
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {},
          id: 1,
        }),
      );

      // We are testing that the Auth middleware allows the request.
      // 400 is acceptable if the MCP payload is invalid (which is likely with empty params),
      // but 401 or 403 would mean Auth/Security failed.
      expect(statusCode).not.toBe(401);
      expect(statusCode).not.toBe(403);
    });

    it('should enforce Host header', async () => {
      const { statusCode } = await request(port, {
        method: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-auth-token',
          Host: 'evil.com',
        },
      });

      expect(statusCode).toBe(403);
    });

    it('should enforce Origin header (CORS)', async () => {
      const { statusCode } = await request(port, {
        method: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-auth-token',
          Host: `localhost:${port}`,
          Origin: 'https://malicious-site.com',
        },
      });

      expect(statusCode).toBe(403);
    });
  });
});
