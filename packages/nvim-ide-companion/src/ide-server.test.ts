/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IDEServer } from './ide-server';
import { ContextManager } from './context-manager';
import { NvimDiffManager } from './diff-manager';
import type { NeovimClient } from 'neovim';

// Mock dependencies
vi.mock('./context-manager');
vi.mock('./diff-manager');
vi.mock('express', () => {
  const mockServer = {
    address: () => ({ port: 12345 }),
    on: vi.fn(),
    close: vi.fn((cb) => cb && cb()),
  };

  const mockApp = {
    use: vi.fn(),
    post: vi.fn(),
    get: vi.fn(),
    listen: vi.fn((port, host, cb) => {
      if (cb) {
        setTimeout(cb, 0);
      }
      return mockServer;
    }),
  };
  const express = () => mockApp;
  express.json = () => 'json-middleware';
  return { default: express };
});

describe('IDEServer', () => {
  let server: IDEServer;
  let mockContextManager: ContextManager;
  let mockDiffManager: NvimDiffManager;
  let log: (message: string) => void;
  let mockNvim: NeovimClient;

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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should instantiate correctly', () => {
    expect(server).toBeDefined();
  });

  it('should start the server', async () => {
    await server.start();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('IDE server listening'),
    );
  });

  it('should stop the server', async () => {
    await server.start();
    await server.stop();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('IDE server shut down'),
    );
  });
});
