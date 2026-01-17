/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

interface LoggerConfig {
  debug: boolean;
}

export function createLogger(config: LoggerConfig) {
  return (message: string) => {
    if (config.debug) {
      // eslint-disable-next-line no-console
      console.log(`[Gemini Nvim] ${message}`);
    }
  };
}
