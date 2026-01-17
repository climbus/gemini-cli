/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { NeovimClient } from 'neovim';
import type { JSONRPCNotification } from '@modelcontextprotocol/sdk/types.js';
import {
  IdeDiffAcceptedNotificationSchema,
  IdeDiffRejectedNotificationSchema,
} from '@google/gemini-cli-core/src/ide/types.js';

export class NvimDiffManager {
  private listeners: Array<(notification: JSONRPCNotification) => void> = [];

  constructor(private nvim: NeovimClient) {
    this.setupSubscriptions();
  }

  private setupSubscriptions() {
    // Listen for diff accept/reject from Lua plugin
    void this.nvim.subscribe('gemini:diff_accepted');
    void this.nvim.subscribe('gemini:diff_rejected');

    this.nvim.on('notification', (method: string, args: unknown[]) => {
      if (method === 'gemini:diff_accepted') {
        this.handleDiffAccepted(
          args[0] as { filePath: string; content: string },
        );
      } else if (method === 'gemini:diff_rejected') {
        this.handleDiffRejected(args[0] as { filePath: string });
      }
    });
  }

  async showDiff(filePath: string, newContent: string) {
    // Call Lua function to show diff
    await this.nvim.lua('GeminiShowDiff(...)', [filePath, newContent]);
  }

  async closeDiff(filePath: string): Promise<string | undefined> {
    // Call Lua function to close diff and get content
    const content = await this.nvim.lua('return GeminiCloseDiff(...)', [
      filePath,
    ]);
    return content as string | undefined;
  }

  private handleDiffAccepted(data: { filePath: string; content: string }) {
    const { filePath, content } = data;

    const notification = IdeDiffAcceptedNotificationSchema.parse({
      jsonrpc: '2.0',
      method: 'ide/diffAccepted',
      params: { filePath, content },
    });

    this.listeners.forEach((cb) => cb(notification));
  }

  private handleDiffRejected(data: { filePath: string }) {
    const { filePath } = data;

    const notification = IdeDiffRejectedNotificationSchema.parse({
      jsonrpc: '2.0',
      method: 'ide/diffRejected',
      params: { filePath },
    });

    this.listeners.forEach((cb) => cb(notification));
  }

  onDidChange(callback: (notification: JSONRPCNotification) => void) {
    this.listeners.push(callback);
    return {
      dispose: () => {
        const index = this.listeners.indexOf(callback);
        if (index >= 0) this.listeners.splice(index, 1);
      },
    };
  }
}
