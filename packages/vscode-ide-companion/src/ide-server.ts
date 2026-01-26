/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  createIdeServer,
  type IdeServerBase,
} from '@google/gemini-cli-core/src/ide/ide-server-base.js';
import type { DiffManager } from './diff-manager.js';
import { OpenFilesManager } from './open-files-manager.js';
import { VsCodeEnvironmentWriter } from './vscode-env-writer.js';

/**
 * IDE server for VSCode integration.
 * Thin wrapper around the shared IDE server base implementation.
 */
export class IDEServer {
  private baseServer: IdeServerBase | undefined;
  private openFilesManager: OpenFilesManager | undefined;
  diffManager: DiffManager;

  constructor(log: (message: string) => void, diffManager: DiffManager) {
    this.log = log;
    this.diffManager = diffManager;
  }

  private log: (message: string) => void;

  start(context: vscode.ExtensionContext): Promise<void> {
    this.openFilesManager = new OpenFilesManager(context);
    const envWriter = new VsCodeEnvironmentWriter(context, this.log);

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspacePath =
      workspaceFolders && workspaceFolders.length > 0
        ? workspaceFolders
            .map((folder) => folder.uri.fsPath)
            .join(path.delimiter)
        : '';

    const config = {
      processId: process.ppid,
      workspacePath,
      log: this.log,
    };

    this.baseServer = createIdeServer(
      this.openFilesManager,
      this.diffManager,
      envWriter,
      config,
    );

    // Note: The base server handles subscriptions to context and diff changes
    return this.baseServer.start();
  }

  broadcastIdeContextUpdate(): void {
    if (this.baseServer) {
      this.baseServer.broadcastIdeContextUpdate();
    }
  }

  async syncEnvVars(): Promise<void> {
    if (this.baseServer) {
      await this.baseServer.syncEnvVars();
    }
  }

  async stop(): Promise<void> {
    if (this.baseServer) {
      await this.baseServer.stop();
    }
  }
}
