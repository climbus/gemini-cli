/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { tmpdir } from '@google/gemini-cli-core';
import type { IdeEnvironmentWriter } from '@google/gemini-cli-core/src/ide/ide-server-base.js';
import { cleanupStaleFiles } from '@google/gemini-cli-core/src/ide/port-file-manager.js';

const IDE_SERVER_PORT_ENV_VAR = 'GEMINI_CLI_IDE_SERVER_PORT';
const IDE_WORKSPACE_PATH_ENV_VAR = 'GEMINI_CLI_IDE_WORKSPACE_PATH';
const IDE_AUTH_TOKEN_ENV_VAR = 'GEMINI_CLI_IDE_AUTH_TOKEN';

/**
 * Neovim-specific environment writer that creates a shell script
 * for the CLI to source.
 */
export class NvimEnvironmentWriter implements IdeEnvironmentWriter {
  private envScript: string | undefined;
  private portFile: string | undefined;

  constructor(
    private config: {
      processId: number;
      log: (msg: string) => void;
    },
  ) {}

  async writeEnvironment(envConfig: {
    port: number;
    authToken: string;
    workspacePath: string;
  }): Promise<void> {
    const { port, authToken, workspacePath } = envConfig;

    // Write environment variables to a shell script that the CLI can source
    try {
      const envDir = path.join(tmpdir(), 'gemini', 'ide');
      await fs.mkdir(envDir, { recursive: true });
      this.envScript = path.join(
        envDir,
        `nvim-env-${this.config.processId}.sh`,
      );

      await fs.writeFile(
        this.envScript,
        `export ${IDE_SERVER_PORT_ENV_VAR}=${port}\nexport ${IDE_WORKSPACE_PATH_ENV_VAR}=${workspacePath}\nexport ${IDE_AUTH_TOKEN_ENV_VAR}=${authToken}\nexport NVIM=1\n`,
        { mode: 0o600 },
      );
      this.config.log(`Environment script written to: ${this.envScript}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.config.log(`Failed to write environment script: ${message}`);
    }

    // Write port file for CLI discovery
    try {
      const portDir = path.join(tmpdir(), 'gemini', 'ide');
      await fs.mkdir(portDir, { recursive: true });
      this.portFile = path.join(
        portDir,
        `gemini-ide-server-${this.config.processId}-${port}.json`,
      );

      const content = JSON.stringify({
        port,
        workspacePath,
        authToken,
        ideInfo: {
          name: 'nvim',
          displayName: 'Neovim',
        },
      });

      await fs.writeFile(this.portFile, content);
      await fs.chmod(this.portFile, 0o600);
      this.config.log(`Port file written to: ${this.portFile}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.config.log(`Failed to write port file: ${message}`);
    }

    // Clean up stale files
    try {
      await cleanupStaleFiles(this.config.log);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.config.log(`Warning: Stale file cleanup failed: ${message}`);
    }
  }

  async clearEnvironment(): Promise<void> {
    // Clean up environment script
    if (this.envScript) {
      try {
        await fs.unlink(this.envScript);
      } catch (_err) {
        // Ignore errors if the file doesn't exist
      }
    }

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
