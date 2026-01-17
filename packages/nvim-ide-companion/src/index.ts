/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { attach, type NeovimClient } from 'neovim';
import * as fsSync from 'node:fs';
import * as pathModule from 'node:path';
import { tmpdir } from '@google/gemini-cli-core';
import { IDEServer } from './ide-server.js';
import { ContextManager } from './context-manager.js';
import { NvimDiffManager } from './diff-manager.js';
import { createLogger } from './utils/logger.js';

async function main() {
  // Connect to Neovim via socket (passed by Lua plugin)
  const socketPath = process.env.NVIM_SOCKET;
  if (!socketPath) {
    // eslint-disable-next-line no-console
    console.error('Error: NVIM_SOCKET environment variable not set');
    process.exit(1);
  }

  const debug = process.env.GEMINI_DEBUG === 'true';
  const log = createLogger({ debug });

  let nvim: NeovimClient;
  try {
    nvim = attach({ socket: socketPath });
    log('Connected to Neovim');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to connect to Neovim:', err);
    process.exit(1);
  }

  // Initialize managers
  const contextManager = new ContextManager(nvim);
  const diffManager = new NvimDiffManager(nvim);

  // Create simple context object (replaces VS Code ExtensionContext)
  const context = {
    workspacePath: process.env.NVIM_WORKSPACE || process.cwd(),
    processId: parseInt(process.env.NVIM_PID || String(process.ppid), 10),
    ideInfo: { name: 'nvim', displayName: 'Neovim' },
  };

  // Start IDE server
  const server = new IDEServer(log, contextManager, diffManager, context);

  await server.start();
  log('Neovim IDE Companion server started');

  // Keep process alive
  process.on('SIGINT', async () => {
    log('Shutting down...');
    await server.stop();
    // eslint-disable-next-line @typescript-eslint/await-thenable
    await nvim.quit();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    log('Received SIGTERM, shutting down...');
    await server.stop();
    // eslint-disable-next-line @typescript-eslint/await-thenable
    await nvim.quit();
    process.exit(0);
  });

  // Synchronous cleanup on exit as a last resort
  process.on('exit', () => {
    // Sync cleanup - async operations won't complete during exit
    if ((server as unknown as { portFile?: string }).portFile) {
      try {
        fsSync.unlinkSync(
          (server as unknown as { portFile?: string }).portFile!,
        );
      } catch (_) {
        // Ignore errors during emergency cleanup
      }
    }
    if (context.processId) {
      try {
        const envScript = pathModule.join(
          tmpdir(),
          'gemini',
          'ide',
          `nvim-env-${context.processId}.sh`,
        );
        fsSync.unlinkSync(envScript);
      } catch (_) {
        // Ignore errors during emergency cleanup
      }
    }
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error:', err);
  process.exit(1);
});
