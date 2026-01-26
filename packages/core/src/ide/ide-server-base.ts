/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { type Server as HTTPServer } from 'node:http';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IdeContext } from './types.js';
import { IdeContextNotificationSchema } from './types.js';
import {
  createMcpServerForIde,
  type IdeDiffProvider,
} from './mcp-server-factory.js';
import {
  writePortFile,
  getPortFilePath,
  ensureIdeDirectory,
  cleanupStaleFiles,
} from './port-file-manager.js';

class CORSError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CORSError';
  }
}

const MCP_SESSION_ID_HEADER = 'mcp-session-id';

/**
 * Provider interface for IDE context (open files, cursor position, etc.)
 */
export interface IdeContextProvider {
  readonly state: IdeContext;
  onDidChange(callback: () => void): { dispose: () => void };
}

/**
 * Writer interface for environment variables (IDE-specific implementation)
 */
export interface IdeEnvironmentWriter {
  writeEnvironment(config: {
    port: number;
    authToken: string;
    workspacePath: string;
  }): Promise<void>;
  clearEnvironment(): Promise<void>;
}

/**
 * Configuration for IDE server
 */
export interface IdeServerConfig {
  processId: number;
  workspacePath: string;
  log: (message: string) => void;
  ideInfo?: {
    name: string;
    displayName: string;
  };
}

/**
 * Base IDE server interface
 */
export interface IdeServerBase {
  start(): Promise<void>;
  stop(): Promise<void>;
  broadcastIdeContextUpdate(): void;
  syncEnvVars(): Promise<void>;
}

function sendIdeContextUpdateNotification(
  transport: StreamableHTTPServerTransport,
  contextProvider: IdeContextProvider,
): void {
  const ideContext = contextProvider.state;

  const notification = IdeContextNotificationSchema.parse({
    jsonrpc: '2.0',
    method: 'ide/contextUpdate',
    params: ideContext,
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  transport.send(notification);
}

/**
 * Creates an IDE server with shared HTTP/MCP logic.
 * Uses dependency injection for IDE-specific behavior.
 */
export function createIdeServer(
  contextProvider: IdeContextProvider,
  diffProvider: IdeDiffProvider,
  envWriter: IdeEnvironmentWriter,
  config: IdeServerConfig,
): IdeServerBase {
  let server: HTTPServer | undefined;
  let port: number | undefined;
  let authToken: string | undefined;
  let portFile: string | undefined;
  const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

  const log = config.log;

  async function start(): Promise<void> {
    return new Promise((resolve) => {
      // Clean up stale files on startup
      cleanupStaleFiles(log).catch((err) => {
        log(`Warning: Stale file cleanup failed: ${err.message}`);
      });

      authToken = randomUUID();
      const sessionsWithInitialNotification = new Set<string>();

      const app = express();
      app.use(express.json({ limit: '10mb' }));

      // CORS middleware - only allow non-browser requests
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

      // Host validation middleware
      app.use((req, res, next) => {
        const host = req.headers.host || '';
        const allowedHosts = [`localhost:${port}`, `127.0.0.1:${port}`];
        if (!allowedHosts.includes(host)) {
          res.status(403).json({ error: 'Invalid Host header' });
          return;
        }
        next();
      });

      // Bearer token authentication middleware
      app.use((req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
          log('Missing Authorization header. Rejecting request.');
          res.status(401).send('Unauthorized');
          return;
        }
        const parts = authHeader.split(' ');
        if (parts.length !== 2 || parts[0] !== 'Bearer') {
          log('Malformed Authorization header. Rejecting request.');
          res.status(401).send('Unauthorized');
          return;
        }
        const token = parts[1];
        if (token !== authToken) {
          log('Invalid auth token provided. Rejecting request.');
          res.status(401).send('Unauthorized');
          return;
        }
        next();
      });

      const mcpServer = createMcpServerForIde(diffProvider, log);

      // Subscribe to context changes
      contextProvider.onDidChange(() => {
        broadcastIdeContextUpdate();
      });

      // Subscribe to diff changes
      diffProvider.onDidChange((notification) => {
        for (const transport of Object.values(transports)) {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          transport.send(notification);
        }
      });

      // POST /mcp - Handle MCP requests and session initialization
      app.post('/mcp', async (req: Request, res: Response) => {
        const sessionId = req.headers[MCP_SESSION_ID_HEADER] as
          | string
          | undefined;
        let transport: StreamableHTTPServerTransport;

        if (sessionId && transports[sessionId]) {
          transport = transports[sessionId];
        } else if (!sessionId && isInitializeRequest(req.body)) {
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newSessionId) => {
              log(`New session initialized: ${newSessionId}`);
              transports[newSessionId] = transport;
            },
          });

          // Keep-alive mechanism: ping every 60 seconds, disconnect after 3 missed pings
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
                log(
                  `Failed to send keep-alive ping for session ${sessionId}. Missed pings: ${missedPings}. Error: ${error.message}`,
                );
                if (missedPings >= 3) {
                  log(
                    `Session ${sessionId} missed ${missedPings} pings. Closing connection and cleaning up interval.`,
                  );
                  clearInterval(keepAlive);
                }
              });
          }, 60000); // 60 sec

          transport.onclose = () => {
            clearInterval(keepAlive);
            if (transport.sessionId) {
              log(`Session closed: ${transport.sessionId}`);
              sessionsWithInitialNotification.delete(transport.sessionId);
              delete transports[transport.sessionId];
            }
          };

          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          mcpServer.connect(transport);
        } else {
          log(
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
          log(`Error handling MCP request: ${errorMessage}`);
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

      // GET /mcp - Handle session requests
      const handleSessionRequest = async (req: Request, res: Response) => {
        const sessionId = req.headers[MCP_SESSION_ID_HEADER] as
          | string
          | undefined;
        if (!sessionId || !transports[sessionId]) {
          log('Invalid or missing session ID');
          res.status(400).send('Invalid or missing session ID');
          return;
        }

        const transport = transports[sessionId];
        try {
          await transport.handleRequest(req, res);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          log(`Error handling session request: ${errorMessage}`);
          if (!res.headersSent) {
            res.status(400).send('Bad Request');
          }
        }

        // Send initial context notification for new sessions
        if (!sessionsWithInitialNotification.has(sessionId)) {
          sendIdeContextUpdateNotification(transport, contextProvider);
          sessionsWithInitialNotification.add(sessionId);
        }
      };

      app.get('/mcp', handleSessionRequest);

      // Error handling middleware
      app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
        log(`Error processing request: ${err.message}`);
        log(`Stack trace: ${err.stack}`);
        if (err instanceof CORSError) {
          res.status(403).json({ error: 'Request denied by CORS policy.' });
        } else {
          next(err);
        }
      });

      // Start HTTP server
      server = app.listen(0, '127.0.0.1', async () => {
        const address = (server as HTTPServer).address();
        if (address && typeof address !== 'string') {
          port = address.port;
          log(`IDE server listening on http://127.0.0.1:${port}`);

          try {
            await ensureIdeDirectory();
            portFile = getPortFilePath(config.processId, port);

            await writePortFile(portFile, {
              port,
              workspacePath: config.workspacePath,
              authToken: authToken ?? '',
              ideInfo: config.ideInfo,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log(`Failed to create IDE port file: ${message}`);
          }

          // Write environment variables (IDE-specific)
          try {
            await envWriter.writeEnvironment({
              port,
              authToken: authToken ?? '',
              workspacePath: config.workspacePath,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log(`Failed to write environment variables: ${message}`);
          }
        }
        resolve();
      });

      server.on('close', () => {
        log('IDE server connection closed.');
      });

      server.on('error', (error) => {
        log(`IDE server error: ${error.message}`);
      });
    });
  }

  function broadcastIdeContextUpdate(): void {
    for (const transport of Object.values(transports)) {
      sendIdeContextUpdateNotification(transport, contextProvider);
    }
  }

  async function syncEnvVars(): Promise<void> {
    if (server && port && authToken) {
      try {
        await envWriter.writeEnvironment({
          port,
          authToken,
          workspacePath: config.workspacePath,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`Failed to sync environment variables: ${message}`);
      }
      broadcastIdeContextUpdate();
    }
  }

  async function stop(): Promise<void> {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((err?: Error) => {
          if (err) {
            log(`Error shutting down IDE server: ${err.message}`);
            return reject(err);
          }
          log(`IDE server shut down`);
          resolve();
        });
      });
      server = undefined;
    }

    // Clean up environment variables
    try {
      await envWriter.clearEnvironment();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Failed to clear environment variables: ${message}`);
    }

    // Clean up port file
    if (portFile) {
      try {
        await import('node:fs/promises').then((fs) => fs.unlink(portFile!));
      } catch (_err) {
        // Ignore errors if the file doesn't exist
      }
    }
  }

  return {
    start,
    stop,
    broadcastIdeContextUpdate,
    syncEnvVars,
  };
}
