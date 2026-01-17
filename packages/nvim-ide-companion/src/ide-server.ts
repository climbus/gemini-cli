/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CloseDiffRequestSchema,
  IdeContextNotificationSchema,
  OpenDiffRequestSchema,
} from '@google/gemini-cli-core/src/ide/types.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { type Server as HTTPServer } from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { tmpdir } from '@google/gemini-cli-core';
import type { z } from 'zod';
import type { NvimDiffManager } from './diff-manager.js';
import type { ContextManager } from './context-manager.js';

class CORSError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CORSError';
  }
}

const MCP_SESSION_ID_HEADER = 'mcp-session-id';
const IDE_SERVER_PORT_ENV_VAR = 'GEMINI_CLI_IDE_SERVER_PORT';
const IDE_WORKSPACE_PATH_ENV_VAR = 'GEMINI_CLI_IDE_WORKSPACE_PATH';
const IDE_AUTH_TOKEN_ENV_VAR = 'GEMINI_CLI_IDE_AUTH_TOKEN';

interface NvimContext {
  workspacePath: string;
  processId: number;
  ideInfo: { name: string; displayName: string };
}

interface WritePortAndWorkspaceArgs {
  context: NvimContext;
  port: number;
  authToken: string;
  portFile: string | undefined;
  log: (message: string) => void;
}

async function writePortAndWorkspace({
  context,
  port,
  portFile,
  authToken,
  log,
}: WritePortAndWorkspaceArgs): Promise<void> {
  const workspacePath = context.workspacePath;

  // Write environment variables to a shell script that Neovim can source
  try {
    const envDir = path.join(tmpdir(), 'gemini', 'ide');
    await fs.mkdir(envDir, { recursive: true });
    const envScript = path.join(envDir, `nvim-env-${context.processId}.sh`);
    await fs.writeFile(
      envScript,
      `export ${IDE_SERVER_PORT_ENV_VAR}=${port}\nexport ${IDE_WORKSPACE_PATH_ENV_VAR}=${workspacePath}\nexport ${IDE_AUTH_TOKEN_ENV_VAR}=${authToken}\nexport NVIM=1\n`,
      { mode: 0o600 },
    );
    log(`Environment script written to: ${envScript}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Failed to write environment script: ${message}`);
  }

  if (!portFile) {
    log('Missing portFile, cannot write port and workspace info.');
    return;
  }

  const content = JSON.stringify({
    port,
    workspacePath,
    authToken,
  });

  log(`Writing port file to: ${portFile}`);

  try {
    await fs.writeFile(portFile, content).then(() => fs.chmod(portFile, 0o600));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Failed to write port to file: ${message}`);
  }
}

async function cleanupStaleFiles(
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

function sendIdeContextUpdateNotification(
  transport: StreamableHTTPServerTransport,
  log: (message: string) => void,
  contextManager: ContextManager,
) {
  const ideContext = contextManager.state;

  const notification = IdeContextNotificationSchema.parse({
    jsonrpc: '2.0',
    method: 'ide/contextUpdate',
    params: ideContext,
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  transport.send(notification);
}

export class IDEServer {
  private server: HTTPServer | undefined;
  private context: NvimContext | undefined;
  private log: (message: string) => void;
  private portFile: string | undefined;

  private port: number | undefined;
  private authToken: string | undefined;
  private transports: { [sessionId: string]: StreamableHTTPServerTransport } =
    {};
  private contextManager: ContextManager | undefined;
  diffManager: NvimDiffManager;

  constructor(
    log: (message: string) => void,
    contextManager: ContextManager,
    diffManager: NvimDiffManager,
    context: NvimContext,
  ) {
    this.log = log;
    this.contextManager = contextManager;
    this.diffManager = diffManager;
    this.context = context;
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.context) {
        this.log('Error: Missing context');
        return resolve();
      }

      // Clean up stale files on startup
      cleanupStaleFiles(this.log).catch((err) => {
        this.log(`Warning: Stale file cleanup failed: ${err.message}`);
      });

      this.authToken = randomUUID();
      const sessionsWithInitialNotification = new Set<string>();

      const app = express();
      app.use(express.json({ limit: '10mb' }));

      app.use(
        cors({
          origin: (origin, callback) => {
            // Only allow non-browser requests with no origin.
            if (!origin) {
              return callback(null, true);
            }
            return callback(
              new CORSError('Request denied by CORS policy.'),
              false,
            );
          },
        }),
      );

      app.use((req, res, next) => {
        const host = req.headers.host || '';
        const allowedHosts = [
          `localhost:${this.port}`,
          `127.0.0.1:${this.port}`,
        ];
        if (!allowedHosts.includes(host)) {
          return res.status(403).json({ error: 'Invalid Host header' });
        }
        next();
      });

      app.use((req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
          this.log('Missing Authorization header. Rejecting request.');
          res.status(401).send('Unauthorized');
          return;
        }
        const parts = authHeader.split(' ');
        if (parts.length !== 2 || parts[0] !== 'Bearer') {
          this.log('Malformed Authorization header. Rejecting request.');
          res.status(401).send('Unauthorized');
          return;
        }
        const token = parts[1];
        if (token !== this.authToken) {
          this.log('Invalid auth token provided. Rejecting request.');
          res.status(401).send('Unauthorized');
          return;
        }
        next();
      });

      const mcpServer = createMcpServer(this.diffManager, this.log);

      if (this.contextManager) {
        this.contextManager.onDidChange(() => {
          this.broadcastIdeContextUpdate();
        });
      }

      this.diffManager.onDidChange((notification) => {
        for (const transport of Object.values(this.transports)) {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          transport.send(notification);
        }
      });

      app.post('/mcp', async (req: Request, res: Response) => {
        const sessionId = req.headers[MCP_SESSION_ID_HEADER] as
          | string
          | undefined;
        let transport: StreamableHTTPServerTransport;

        if (sessionId && this.transports[sessionId]) {
          transport = this.transports[sessionId];
        } else if (!sessionId && isInitializeRequest(req.body)) {
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newSessionId) => {
              this.log(`New session initialized: ${newSessionId}`);
              this.transports[newSessionId] = transport;
            },
          });
          let missedPings = 0;
          const keepAlive = setInterval(() => {
            const sessionId = transport.sessionId ?? 'unknown';
            transport
              .send({ jsonrpc: '2.0', method: 'ping' })
              .then(() => {
                missedPings = 0;
              })
              .catch((error) => {
                missedPings++;
                this.log(
                  `Failed to send keep-alive ping for session ${sessionId}. Missed pings: ${missedPings}. Error: ${error.message}`,
                );
                if (missedPings >= 3) {
                  this.log(
                    `Session ${sessionId} missed ${missedPings} pings. Closing connection and cleaning up interval.`,
                  );
                  clearInterval(keepAlive);
                }
              });
          }, 60000); // 60 sec

          transport.onclose = () => {
            clearInterval(keepAlive);
            if (transport.sessionId) {
              this.log(`Session closed: ${transport.sessionId}`);
              sessionsWithInitialNotification.delete(transport.sessionId);
              delete this.transports[transport.sessionId];
            }
          };

          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          mcpServer.connect(transport);
        } else {
          this.log(
            'Bad Request: No valid session ID provided for non-initialize request.',
          );
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message:
                'Bad Request: No valid session ID provided for non-initialize request.',
            },
            id: null,
          });
          return;
        }

        try {
          await transport.handleRequest(req, res, req.body);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          this.log(`Error handling MCP request: ${errorMessage}`);
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: '2.0' as const,
              error: {
                code: -32603,
                message: 'Internal server error',
              },
              id: null,
            });
          }
        }
      });

      const handleSessionRequest = async (req: Request, res: Response) => {
        const sessionId = req.headers[MCP_SESSION_ID_HEADER] as
          | string
          | undefined;
        if (!sessionId || !this.transports[sessionId]) {
          this.log('Invalid or missing session ID');
          res.status(400).send('Invalid or missing session ID');
          return;
        }

        const transport = this.transports[sessionId];
        try {
          await transport.handleRequest(req, res);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          this.log(`Error handling session request: ${errorMessage}`);
          if (!res.headersSent) {
            res.status(400).send('Bad Request');
          }
        }

        if (
          this.contextManager &&
          !sessionsWithInitialNotification.has(sessionId)
        ) {
          sendIdeContextUpdateNotification(
            transport,
            this.log.bind(this),
            this.contextManager,
          );
          sessionsWithInitialNotification.add(sessionId);
        }
      };

      app.get('/mcp', handleSessionRequest);

      app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
        this.log(`Error processing request: ${err.message}`);
        this.log(`Stack trace: ${err.stack}`);
        if (err instanceof CORSError) {
          res.status(403).json({ error: 'Request denied by CORS policy.' });
        } else {
          next(err);
        }
      });

      this.server = app.listen(0, '127.0.0.1', async () => {
        const address = (this.server as HTTPServer).address();
        if (address && typeof address !== 'string') {
          this.port = address.port;
          this.log(`IDE server listening on http://127.0.0.1:${this.port}`);
          let portFile: string | undefined;
          try {
            const portDir = path.join(tmpdir(), 'gemini', 'ide');
            await fs.mkdir(portDir, { recursive: true });
            portFile = path.join(
              portDir,
              `gemini-ide-server-${this.context!.processId}-${this.port}.json`,
            );
            this.portFile = portFile;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.log(`Failed to create IDE port file: ${message}`);
          }

          await writePortAndWorkspace({
            context: this.context!,
            port: this.port,
            portFile: this.portFile,
            authToken: this.authToken ?? '',
            log: this.log,
          });
        }
        resolve();
      });

      this.server.on('close', () => {
        this.log('IDE server connection closed.');
      });

      this.server.on('error', (error) => {
        this.log(`IDE server error: ${error.message}`);
      });
    });
  }

  broadcastIdeContextUpdate() {
    if (!this.contextManager) {
      return;
    }
    for (const transport of Object.values(this.transports)) {
      sendIdeContextUpdateNotification(
        transport,
        this.log.bind(this),
        this.contextManager,
      );
    }
  }

  async syncEnvVars(): Promise<void> {
    if (this.context && this.server && this.port && this.authToken) {
      await writePortAndWorkspace({
        context: this.context,
        port: this.port,
        portFile: this.portFile,
        authToken: this.authToken,
        log: this.log,
      });
      this.broadcastIdeContextUpdate();
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err?: Error) => {
          if (err) {
            this.log(`Error shutting down IDE server: ${err.message}`);
            return reject(err);
          }
          this.log(`IDE server shut down`);
          resolve();
        });
      });
      this.server = undefined;
    }

    if (this.portFile) {
      try {
        await fs.unlink(this.portFile);
      } catch (_err) {
        // Ignore errors if the file doesn't exist.
      }
    }

    // Clean up environment script
    if (this.context) {
      try {
        const envScript = path.join(
          tmpdir(),
          'gemini',
          'ide',
          `nvim-env-${this.context.processId}.sh`,
        );
        await fs.unlink(envScript);
      } catch (_err) {
        // Ignore errors if the file doesn't exist.
      }
    }
  }
}

const createMcpServer = (
  diffManager: NvimDiffManager,
  log: (message: string) => void,
) => {
  const server = new McpServer(
    {
      name: 'gemini-cli-companion-mcp-server',
      version: '1.0.0',
    },
    { capabilities: { logging: {} } },
  );
  server.registerTool(
    'openDiff',
    {
      description:
        '(IDE Tool) Open a diff view to create or modify a file. Returns a notification once the diff has been accepted or rejected.',
      inputSchema: OpenDiffRequestSchema.shape,
    },
    async ({ filePath, newContent }: z.infer<typeof OpenDiffRequestSchema>) => {
      log(`Received openDiff request for filePath: ${filePath}`);
      await diffManager.showDiff(filePath, newContent);
      return { content: [] };
    },
  );
  server.registerTool(
    'closeDiff',
    {
      description: '(IDE Tool) Close an open diff view for a specific file.',
      inputSchema: CloseDiffRequestSchema.shape,
    },
    async ({ filePath }: z.infer<typeof CloseDiffRequestSchema>) => {
      log(`Received closeDiff request for filePath: ${filePath}`);
      const content = await diffManager.closeDiff(filePath);
      const response = { content: content ?? undefined };
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response),
          },
        ],
      };
    },
  );
  return server;
};
