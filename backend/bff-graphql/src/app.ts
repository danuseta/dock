import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import cors from 'cors';
import express, { Express } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolvers } from './resolvers';
import { typeDefs } from './schema/typeDefs';
import {
  AuthContext,
  isTailscaleRequest,
  pinRateLimiter,
  sessionManager,
} from './auth/session';
import { createGoogleCalendarRouter } from './auth/google-calendar-router';
import { createAgentLookRouter } from './routes/agent-looks';
import { createBrainProxyRouter } from './routes/brain';
import { createChatAttachmentRouter } from './routes/chat-attachments';
import { createBlackboardRouter } from './routes/blackboard';
import { createDemoVideoRouter } from './routes/demo-videos';
import { createOrchestratorApiRouter, createOrchestratorIngestRouter } from './routes/orchestrator';
import { dockMode } from './mode';
import { buildOf } from './integrations/dock-issues';

export interface CreateAppOptions {
  corsOrigin?: string;
  frontendDistPath?: string;
}

export interface JidisApp {
  app: Express;
  apolloServer: ApolloServer<AuthContext>;
  frontendEnabled: boolean;
}

function defaultFrontendDistPath(): string {
  return path.resolve(__dirname, '../../../frontend/dist');
}

export { buildOf };

export async function createApp(options: CreateAppOptions = {}): Promise<JidisApp> {
  const app = express();
  const mode = dockMode();
  const apolloServer = new ApolloServer<AuthContext>({ typeDefs, resolvers });
  const frontendDistPath = path.resolve(
    options.frontendDistPath || process.env.FRONTEND_DIST_PATH || defaultFrontendDistPath(),
  );
  const frontendIndexPath = path.join(frontendDistPath, 'index.html');
  const frontendEnabled = existsSync(frontendIndexPath);
  const build = frontendEnabled ? buildOf(readFileSync(frontendIndexPath, 'utf8')) : null;

  await apolloServer.start();

  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
  app.use(cors({
    credentials: true,
    origin: options.corsOrigin || process.env.CORS_ORIGIN || 'http://localhost:3000',
  }));
  // Mounted ahead of the global parser: ingest routes carry their own body limits.
  if (mode === 'laptop') {
    app.use(['/ingest/orchestrator/sessions', '/ingest/orchestrator/chat'], (_request, response) => {
      response.status(404).json({ error: 'Chat runs on the workspace DOCK. This DOCK only keeps the run ledger.' });
    });
  }
  app.use('/ingest/orchestrator', createOrchestratorIngestRouter());
  app.use('/ingest/brain', createBrainProxyRouter());
  if (mode === 'workspace') app.use('/api/chat/attachments', createChatAttachmentRouter());
  if (mode === 'workspace') app.use('/api/blackboard', createBlackboardRouter());
  if (mode === 'workspace') app.use('/api/demo-videos', createDemoVideoRouter());
  if (mode === 'workspace') app.use('/api/agent-looks', createAgentLookRouter());
  app.use(express.json());

  app.use('/auth/google', createGoogleCalendarRouter());
  app.use('/api/orchestrator', createOrchestratorApiRouter());

  app.use('/graphql', expressMiddleware(apolloServer, {
    context: async ({ req, res }) => ({
      request: req,
      response: res,
      authenticated: sessionManager.isAuthenticated(req),
      trustedNetwork: isTailscaleRequest(req),
      clientKey: req.ip || req.socket.remoteAddress || 'unknown',
      sessions: sessionManager,
      pinRateLimiter,
    }),
  }));

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok', service: 'bff-graphql', build });
  });

  if (frontendEnabled) {
    app.use(express.static(frontendDistPath));
    app.get('*', (request, response, next) => {
      if (
        request.path === '/health'
        || request.path.startsWith('/graphql')
        || request.path === '/api'
        || request.path.startsWith('/api/')
        || request.path.startsWith('/internal/')
        || request.path.startsWith('/ingest/')
        || path.extname(request.path) !== ''
      ) {
        next();
        return;
      }

      response.sendFile(frontendIndexPath);
    });
  }

  return { app, apolloServer, frontendEnabled };
}
