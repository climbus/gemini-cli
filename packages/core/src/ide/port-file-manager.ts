/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { tmpdir } from '../utils/paths.js';

export interface PortFileInfo {
  port: number;
  workspacePath: string;
  authToken: string;
  ideInfo?: {
    name: string;
    displayName: string;
  };
}

/**
 * Writes IDE server port information to a JSON file for CLI discovery.
 */
export async function writePortFile(
  portFile: string,
  info: PortFileInfo,
): Promise<void> {
  const content = JSON.stringify(info);
  await fs.writeFile(portFile, content);
  await fs.chmod(portFile, 0o600);
}

/**
 * Generates the path for a port file based on process ID and port number.
 */
export function getPortFilePath(processId: number, port: number): string {
  const portDir = path.join(tmpdir(), 'gemini', 'ide');
  return path.join(portDir, `gemini-ide-server-${processId}-${port}.json`);
}

/**
 * Ensures the IDE directory exists.
 */
export async function ensureIdeDirectory(): Promise<string> {
  const ideDir = path.join(tmpdir(), 'gemini', 'ide');
  await fs.mkdir(ideDir, { recursive: true });
  return ideDir;
}

/**
 * Cleans up stale port files from dead processes or files older than 24 hours.
 * This prevents accumulation of orphaned discovery files.
 */
export async function cleanupStaleFiles(
  log: (message: string) => void,
): Promise<void> {
  const portFileDir = path.join(tmpdir(), 'gemini', 'ide');

  try {
    const files = await fs.readdir(portFileDir);
    const now = Date.now();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (
        !file.startsWith('gemini-ide-server-') &&
        !file.startsWith('nvim-env-')
      ) {
        continue;
      }

      const filePath = path.join(portFileDir, file);

      try {
        const stats = await fs.stat(filePath);
        const ageMs = now - stats.mtimeMs;

        // Delete files older than 24 hours
        if (ageMs > ONE_DAY_MS) {
          await fs.unlink(filePath);
          log(`Cleaned up old file: ${file}`);
          continue;
        }

        // Extract PID from filename
        const pidMatch = file.match(/(?:gemini-ide-server|nvim-env)-(\d+)/);
        if (pidMatch) {
          const pid = parseInt(pidMatch[1], 10);

          // Check if process is still running
          try {
            process.kill(pid, 0); // Signal 0 checks existence without killing
          } catch (_err) {
            // Process doesn't exist, safe to delete
            await fs.unlink(filePath);
            log(`Cleaned up stale file from dead process ${pid}: ${file}`);
          }
        }
      } catch (_err) {
        // Ignore errors on individual files
      }
    }
  } catch (err) {
    // Directory doesn't exist or can't be read - not an error
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log(
        `Error during stale file cleanup: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
