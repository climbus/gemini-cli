/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { attach } from 'neovim';
import * as fsSync from 'node:fs';
import { main } from './index.js';
import { IDEServer } from './ide-server.js';

// Mock dependencies
vi.mock('neovim', () => ({
  attach: vi.fn(),
}));

vi.mock('node:fs', () => ({
  unlinkSync: vi.fn(),
}));

// Mock IDEServer
vi.mock('./ide-server.js', () => ({
  IDEServer: vi.fn(),
}));

// Mock console
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('Process Signal Handlers', () => {
  let mockNvim: {
    quit: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };
  let mockServer: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    portFile: string;
  };
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let handlers: Record<string, () => void | Promise<void>> = {};

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();

    // Setup environment
    vi.stubEnv('NVIM_SOCKET', '/tmp/socket');
    vi.stubEnv('NVIM_PID', '12345');

    // Mock Neovim
    mockNvim = {
      quit: vi.fn(),
      subscribe: vi.fn(),
      on: vi.fn(),
    };
    vi.mocked(attach).mockReturnValue(mockNvim);

    // Mock IDEServer
    mockServer = {
      start: vi.fn(),
      stop: vi.fn(),
      portFile: '/tmp/port-file',
    };
    vi.mocked(IDEServer).mockImplementation(() => mockServer);

    // Spy on process.on to capture handlers
    handlers = {};
    vi.spyOn(process, 'on')
      // @ts-expect-error - Mocking process.on
      .mockImplementation((event, handler) => {
        handlers[event as string] = handler as () => void | Promise<void>;
        return process;
      });

    // Mock process.exit
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`Process exited with code ${code}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle SIGINT gracefully', async () => {
    await main();

    expect(handlers['SIGINT']).toBeDefined();

    // Simulate SIGINT
    await expect(handlers['SIGINT']()).rejects.toThrow(
      'Process exited with code 0',
    );

    expect(mockServer.stop).toHaveBeenCalled();
    expect(mockNvim.quit).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('should handle SIGTERM gracefully', async () => {
    await main();

    expect(handlers['SIGTERM']).toBeDefined();

    // Simulate SIGTERM
    await expect(handlers['SIGTERM']()).rejects.toThrow(
      'Process exited with code 0',
    );

    expect(mockServer.stop).toHaveBeenCalled();
    expect(mockNvim.quit).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('should perform synchronous cleanup on exit', async () => {
    await main();

    expect(handlers['exit']).toBeDefined();

    // Simulate exit
    void handlers['exit']();

    // Check if port file cleanup was attempted
    expect(fsSync.unlinkSync).toHaveBeenCalledWith('/tmp/port-file');

    // Check if env script cleanup was attempted
    expect(fsSync.unlinkSync).toHaveBeenCalledWith(
      expect.stringContaining('nvim-env-12345.sh'),
    );
  });

  it('should handle errors during exit cleanup gracefully', async () => {
    vi.mocked(fsSync.unlinkSync).mockImplementation(() => {
      throw new Error('Cleanup failed');
    });

    await main();

    // Should not throw
    expect(() => handlers['exit']()).not.toThrow();
  });
});
