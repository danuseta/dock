import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import cors from 'cors';
import express, { Express } from 'express';
import { existsSync } from 'node:fs';
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

export async function createApp(options: CreateAppOptions = {}): Promise<JidisApp> {
  const app = express();
  const apolloServer = new ApolloServer<AuthContext>({ typeDefs, resolvers });
  const frontendDistPath = path.resolve(
    options.frontendDistPath || process.env.FRONTEND_DIST_PATH || defaultFrontendDistPath(),
  );
  const frontendIndexPath = path.join(frontendDistPath, 'index.html');
  const frontendEnabled = existsSync(frontendIndexPath);

  await apolloServer.start();

  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
  app.use(cors({
    credentials: true,
    origin: options.corsOrigin || process.env.CORS_ORIGIN || 'http://localhost:3000',
  }));
  app.use(express.json());

  app.use('/auth/google', createGoogleCalendarRouter());

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
    response.status(200).json({ status: 'ok', service: 'bff-graphql' });
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
