import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: false });
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import storageRoutes from './routes/storage.routes';
import { Logger } from './utils/logger';
import { AppError } from './utils/errors';
import { assertEncryptionKey } from './utils/crypto';

const app = express();
const port = process.env.PORT || 8004;
assertEncryptionKey();
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error('DATABASE_URL is required');
}
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl
    }
  }
});
const logger = new Logger('StorageService');

app.use(cors());
app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ok', database: 'connected' });
  } catch (error: any) {
    logger.error('Health check failed', error);
    res.status(503).json({ status: 'error', database: 'disconnected', details: error?.message || String(error), dbUrlSet: !!process.env.DATABASE_URL });
  }
});

app.use('/api', storageRoutes);

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', err);
  
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
  }

  res.status(500).json({
    success: false,
    error: err?.message || 'Internal Server Error',
  });
});

app.listen(port, () => {
  logger.info(`Storage service listening at http://localhost:${port}`);
});

export { prisma };
