/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { NeovimClient } from 'neovim';
import type {
  IdeContext,
  File,
} from '@google/gemini-cli-core/src/ide/types.js';

const MAX_FILES = 10;
const MAX_SELECTED_TEXT_LENGTH = 16384; // 16 KiB

export class ContextManager {
  private openFiles: File[] = [];
  private listeners: Array<() => void> = [];
  private debounceTimer: NodeJS.Timeout | undefined;

  constructor(private nvim: NeovimClient) {
    this.setupSubscriptions();
  }

  private setupSubscriptions() {
    // Subscribe to Neovim RPC notifications sent by Lua plugin
    void this.nvim.subscribe('gemini:buffer_enter');
    void this.nvim.subscribe('gemini:cursor_moved');
    void this.nvim.subscribe('gemini:visual_changed');
    void this.nvim.subscribe('gemini:buffer_closed');

    this.nvim.on('notification', (method: string, args: unknown[]) => {
      switch (method) {
        case 'gemini:buffer_enter':
          this.handleBufferEnter(args[0]);
          break;
        case 'gemini:cursor_moved':
          this.handleCursorMoved(args[0]);
          break;
        case 'gemini:visual_changed':
          this.handleVisualChanged(args[0]);
          break;
        case 'gemini:buffer_closed':
          this.handleBufferClosed(args[0]);
          break;
        default:
          break;
      }
    });
  }

  private handleBufferEnter(data: { path: string; bufnr: number }) {
    const { path } = data;

    // Deactivate previous active file
    const currentActive = this.openFiles.find((f) => f.isActive);
    if (currentActive) {
      currentActive.isActive = false;
      currentActive.cursor = undefined;
      currentActive.selectedText = undefined;
    }

    // Remove if exists
    const index = this.openFiles.findIndex((f) => f.path === path);
    if (index !== -1) {
      this.openFiles.splice(index, 1);
    }

    // Add to front as active
    this.openFiles.unshift({
      path,
      timestamp: Date.now(),
      isActive: true,
    });

    // Enforce max length
    if (this.openFiles.length > MAX_FILES) {
      this.openFiles.pop();
    }

    this.fireWithDebounce();
  }

  private handleCursorMoved(data: { line: number; col: number }) {
    const { line, col } = data;
    const activeFile = this.openFiles.find((f) => f.isActive);

    if (activeFile) {
      activeFile.cursor = {
        line, // Already 1-based from Neovim
        character: col, // Already 1-based from Lua
      };
      this.fireWithDebounce();
    }
  }

  private handleVisualChanged(data: { selectedText: string }) {
    const { selectedText } = data;
    const activeFile = this.openFiles.find((f) => f.isActive);

    if (activeFile) {
      if (selectedText && selectedText.length > MAX_SELECTED_TEXT_LENGTH) {
        activeFile.selectedText = selectedText.substring(
          0,
          MAX_SELECTED_TEXT_LENGTH,
        );
      } else {
        activeFile.selectedText = selectedText || undefined;
      }
      this.fireWithDebounce();
    }
  }

  private handleBufferClosed(data: { path: string }) {
    const { path } = data;
    const index = this.openFiles.findIndex((f) => f.path === path);
    if (index !== -1) {
      this.openFiles.splice(index, 1);
      this.fireWithDebounce();
    }
  }

  private fireWithDebounce() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.listeners.forEach((cb) => cb());
    }, 150); // 150ms - longer than VS Code to handle events spread over time (e.g. closing diffs)
  }

  get state(): IdeContext {
    return {
      workspaceState: {
        openFiles: [...this.openFiles],
        isTrusted: true, // Neovim doesn't have workspace trust concept
      },
    };
  }

  onDidChange(callback: () => void) {
    this.listeners.push(callback);
    return {
      dispose: () => {
        const index = this.listeners.indexOf(callback);
        if (index >= 0) this.listeners.splice(index, 1);
      },
    };
  }
}
