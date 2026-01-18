/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { attach } from 'neovim';
import { IDEServer } from './ide-server.js';
import { ContextManager } from './context-manager.js';
import { NvimDiffManager } from './diff-manager.js';
import { main } from './index.js';

// Mock dependencies
vi.mock('neovim', () => ({
  attach: vi.fn(),
}));

vi.mock('./ide-server.js', () => ({
  IDEServer: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}));

vi.mock('./context-manager.js', () => ({
  ContextManager: vi.fn(),
}));

vi.mock('./diff-manager.js', () => ({
  NvimDiffManager: vi.fn(),
}));

vi.mock('./utils/logger.js', () => ({
  createLogger: vi.fn(() => vi.fn()),
}));

// Mock console to suppress errors during tests
const mockConsoleError = vi
  .spyOn(console, 'error')
  .mockImplementation(() => {});
const _mockProcessExit = vi
  .spyOn(process, 'exit')
  .mockImplementation((code?: number | string | null) => {
    throw new Error(`Process exited with code ${code}`);
  });

describe('Entry Point (Lua Integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should exit if NVIM_SOCKET is not set', async () => {
    vi.stubEnv('NVIM_SOCKET', ''); // Effectively unset or empty
    // OR
    delete process.env.NVIM_SOCKET; // Manual delete to be sure if stubEnv doesn't support 'unset'

    await expect(main()).rejects.toThrow('Process exited with code 1');
    expect(mockConsoleError).toHaveBeenCalledWith(
      'Error: NVIM_SOCKET environment variable not set',
    );
  });

  it('should attach to neovim and start server', async () => {
    vi.stubEnv('NVIM_SOCKET', '/tmp/nvim.sock');
    vi.stubEnv('NVIM_PID', '1234');
    vi.stubEnv('NVIM_WORKSPACE', '/test/workspace');
    vi.stubEnv('GEMINI_DEBUG', 'true');

    const mockNvim = { quit: vi.fn() };
    vi.mocked(attach).mockReturnValue(mockNvim as unknown);

    await main();

    // Verify Neovim attachment
    expect(attach).toHaveBeenCalledWith({ socket: '/tmp/nvim.sock' });

    // Verify Managers initialization
    expect(ContextManager).toHaveBeenCalledWith(mockNvim);
    expect(NvimDiffManager).toHaveBeenCalledWith(mockNvim);

    // Verify Server initialization
    expect(IDEServer).toHaveBeenCalledWith(
      expect.any(Function), // logger
      expect.any(ContextManager),
      expect.any(NvimDiffManager),
      expect.objectContaining({
        workspacePath: '/test/workspace',
        processId: 1234,
        ideInfo: { name: 'nvim', displayName: 'Neovim' },
      }),
    );

    const MockServerClass = vi.mocked(IDEServer);
    const serverInstance = MockServerClass.mock.results[0].value;
    expect(serverInstance.start).toHaveBeenCalled();
  });
});
