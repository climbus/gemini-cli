/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NvimDiffManager } from './diff-manager.js';
import type { NeovimClient } from 'neovim';

describe('NvimDiffManager', () => {
  let diffManager: NvimDiffManager;
  let mockNvim: NeovimClient;
  let notificationHandler: (method: string, args: unknown[]) => void;

  beforeEach(() => {
    mockNvim = {
      subscribe: vi.fn(),
      on: vi.fn((event, handler) => {
        if (event === 'notification') {
          notificationHandler = handler;
        }
      }),
      lua: vi.fn(),
    } as unknown as NeovimClient;

    diffManager = new NvimDiffManager(mockNvim);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should subscribe to neovim events on initialization', () => {
    expect(mockNvim.subscribe).toHaveBeenCalledWith('gemini:diff_accepted');
    expect(mockNvim.subscribe).toHaveBeenCalledWith('gemini:diff_rejected');
  });

  it('should call lua function when showDiff is called', async () => {
    await diffManager.showDiff('/test/file.ts', 'new content');
    expect(mockNvim.lua).toHaveBeenCalledWith('GeminiShowDiff(...)', [
      '/test/file.ts',
      'new content',
    ]);
  });

  it('should call lua function when closeDiff is called', async () => {
    vi.mocked(mockNvim.lua).mockResolvedValue('final content');
    const result = await diffManager.closeDiff('/test/file.ts');

    expect(mockNvim.lua).toHaveBeenCalledWith('return GeminiCloseDiff(...)', [
      '/test/file.ts',
    ]);
    expect(result).toBe('final content');
  });

  it('should emit diffAccepted notification', () => {
    const listener = vi.fn();
    diffManager.onDidChange(listener);

    notificationHandler('gemini:diff_accepted', [
      {
        filePath: '/test/file.ts',
        content: 'accepted content',
      },
    ]);

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'ide/diffAccepted',
        params: {
          filePath: '/test/file.ts',
          content: 'accepted content',
        },
      }),
    );
  });

  it('should emit diffRejected notification', () => {
    const listener = vi.fn();
    diffManager.onDidChange(listener);

    notificationHandler('gemini:diff_rejected', [
      {
        filePath: '/test/file.ts',
      },
    ]);

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'ide/diffRejected',
        params: {
          filePath: '/test/file.ts',
        },
      }),
    );
  });
});
