/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextManager } from './context-manager.js';
import type { NeovimClient } from 'neovim';

describe('ContextManager', () => {
  let contextManager: ContextManager;
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
    } as unknown as NeovimClient;

    vi.useFakeTimers();
    contextManager = new ContextManager(mockNvim);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should subscribe to neovim events on initialization', () => {
    expect(mockNvim.subscribe).toHaveBeenCalledWith('gemini:buffer_enter');
    expect(mockNvim.subscribe).toHaveBeenCalledWith('gemini:cursor_moved');
    expect(mockNvim.subscribe).toHaveBeenCalledWith('gemini:visual_changed');
    expect(mockNvim.subscribe).toHaveBeenCalledWith('gemini:buffer_closed');
  });

  it('should handle buffer_enter event', () => {
    const listener = vi.fn();
    contextManager.onDidChange(listener);

    notificationHandler('gemini:buffer_enter', [
      { path: '/test/file.ts', bufnr: 1 },
    ]);

    // Fast-forward debounce timer
    vi.advanceTimersByTime(250);

    expect(contextManager.state.workspaceState!.openFiles).toHaveLength(1);
    expect(contextManager.state.workspaceState!.openFiles![0]).toEqual(
      expect.objectContaining({
        path: '/test/file.ts',
        isActive: true,
      }),
    );
    expect(listener).toHaveBeenCalled();
  });

  it('should handle cursor_moved event', () => {
    notificationHandler('gemini:buffer_enter', [
      { path: '/test/file.ts', bufnr: 1 },
    ]);
    vi.advanceTimersByTime(250);

    notificationHandler('gemini:cursor_moved', [{ line: 10, col: 5 }]);
    vi.advanceTimersByTime(250);

    const activeFile = contextManager.state.workspaceState!.openFiles![0];
    expect(activeFile.cursor).toEqual({ line: 10, character: 5 });
  });

  it('should handle visual_changed event', () => {
    notificationHandler('gemini:buffer_enter', [
      { path: '/test/file.ts', bufnr: 1 },
    ]);
    vi.advanceTimersByTime(250);

    notificationHandler('gemini:visual_changed', [
      { selectedText: 'selected code' },
    ]);
    vi.advanceTimersByTime(250);

    const activeFile = contextManager.state.workspaceState!.openFiles![0];
    expect(activeFile.selectedText).toBe('selected code');
  });

  it('should handle buffer_closed event', () => {
    notificationHandler('gemini:buffer_enter', [
      { path: '/test/file.ts', bufnr: 1 },
    ]);
    vi.advanceTimersByTime(250);
    expect(contextManager.state.workspaceState!.openFiles).toHaveLength(1);

    notificationHandler('gemini:buffer_closed', [{ path: '/test/file.ts' }]);
    vi.advanceTimersByTime(250);

    expect(contextManager.state.workspaceState!.openFiles).toHaveLength(0);
  });

  it('should manage multiple files and active state', () => {
    notificationHandler('gemini:buffer_enter', [
      { path: '/test/file1.ts', bufnr: 1 },
    ]);
    vi.advanceTimersByTime(250);

    notificationHandler('gemini:buffer_enter', [
      { path: '/test/file2.ts', bufnr: 2 },
    ]);
    vi.advanceTimersByTime(250);

    const files = contextManager.state.workspaceState!.openFiles!;
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe('/test/file2.ts');
    expect(files[0].isActive).toBe(true);
    expect(files[1].path).toBe('/test/file1.ts');
    expect(files[1].isActive).toBe(false);
  });

  it('should throttle updates', () => {
    const listener = vi.fn();
    contextManager.onDidChange(listener);

    // First event fires immediately (lastFireTime is 0)
    notificationHandler('gemini:buffer_enter', [
      { path: '/test/file1.ts', bufnr: 1 },
    ]);
    expect(listener).toHaveBeenCalledTimes(1);

    // Reset spy
    listener.mockClear();

    // Fire second event immediately after - should be throttled
    notificationHandler('gemini:cursor_moved', [{ line: 5, col: 1 }]);
    expect(listener).not.toHaveBeenCalled();

    // Advance time partly
    vi.advanceTimersByTime(100);
    // Fire another event - still throttled, but should just update state and wait for original timer
    notificationHandler('gemini:cursor_moved', [{ line: 6, col: 1 }]);
    expect(listener).not.toHaveBeenCalled();

    // Advance past throttle time
    vi.advanceTimersByTime(151); // Total > 250ms
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
