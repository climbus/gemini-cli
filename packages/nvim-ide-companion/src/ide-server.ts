/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createIdeServer,
  type IdeServerBase,
} from '@google/gemini-cli-core/src/ide/ide-server-base.js';
import type { NvimDiffManager } from './diff-manager.js';
import type { ContextManager } from './context-manager.js';
import { NvimEnvironmentWriter } from './nvim-env-writer.js';

interface NvimContext {
  workspacePath: string;
  processId: number;
  ideInfo: { name: string; displayName: string };
}

/**
 * IDE server for Neovim integration.
 * Thin wrapper around the shared IDE server base implementation.
 */
export class IDEServer {
  private baseServer: IdeServerBase;
  diffManager: NvimDiffManager;

  constructor(
    log: (message: string) => void,
    contextManager: ContextManager,
    diffManager: NvimDiffManager,
    context: NvimContext,
  ) {
    this.diffManager = diffManager;

    const envWriter = new NvimEnvironmentWriter({
      processId: context.processId,
      log,
    });

    const config = {
      processId: context.processId,
      workspacePath: context.workspacePath,
      log,
      ideInfo: context.ideInfo,
    };

    this.baseServer = createIdeServer(
      contextManager,
      diffManager,
      envWriter,
      config,
    );
  }

  async start(): Promise<void> {
    return this.baseServer.start();
  }

  broadcastIdeContextUpdate(): void {
    this.baseServer.broadcastIdeContextUpdate();
  }

  async syncEnvVars(): Promise<void> {
    await this.baseServer.syncEnvVars();
  }

  async stop(): Promise<void> {
    await this.baseServer.stop();
  }
}
