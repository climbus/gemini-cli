/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { tmpdir } from '@google/gemini-cli-core';
import type { IdeEnvironmentWriter } from '@google/gemini-cli-core/src/ide/ide-server-base.js';

const IDE_SERVER_PORT_ENV_VAR = 'GEMINI_CLI_IDE_SERVER_PORT';
const IDE_WORKSPACE_PATH_ENV_VAR = 'GEMINI_CLI_IDE_WORKSPACE_PATH';
const IDE_AUTH_TOKEN_ENV_VAR = 'GEMINI_CLI_IDE_AUTH_TOKEN';

/**
 * VSCode-specific environment writer that uses the extension context
 * to set environment variables for integrated terminals.
 */
export class VsCodeEnvironmentWriter implements IdeEnvironmentWriter {
  private portFile: string | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    private log: (message: string) => void,
  ) {}

  async writeEnvironment(config: {
    port: number;
    authToken: string;
    workspacePath: string;
  }): Promise<void> {
    const { port, authToken, workspacePath } = config;

    // Set environment variables for integrated terminals
    this.context.environmentVariableCollection.replace(
      IDE_SERVER_PORT_ENV_VAR,
      port.toString(),
    );
    this.context.environmentVariableCollection.replace(
      IDE_WORKSPACE_PATH_ENV_VAR,
      workspacePath,
    );
    this.context.environmentVariableCollection.replace(
      IDE_AUTH_TOKEN_ENV_VAR,
      authToken,
    );

    // Write port file for CLI discovery
    try {
      const portDir = path.join(tmpdir(), 'gemini', 'ide');
      await fs.mkdir(portDir, { recursive: true });
      this.portFile = path.join(
        portDir,
        `gemini-ide-server-${process.ppid}-${port}.json`,
      );

      const content = JSON.stringify({
        port,
        workspacePath,
        authToken,
      });

      await fs.writeFile(this.portFile, content);
      await fs.chmod(this.portFile, 0o600);
      this.log(`Port file written to: ${this.portFile}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(`Failed to write port file: ${message}`);
    }
  }

  async clearEnvironment(): Promise<void> {
    // Clear environment variables
    this.context.environmentVariableCollection.clear();

    // Clean up port file
    if (this.portFile) {
      try {
        await fs.unlink(this.portFile);
      } catch (_err) {
        // Ignore errors if the file doesn't exist
      }
    }
  }
}
