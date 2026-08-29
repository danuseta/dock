import 'dotenv/config';
import { createApp } from './app';

const port = Number(process.env.PORT || 4000);

export async function startServer(): Promise<void> {
  const { app, frontendEnabled } = await createApp();

  app.listen(port, () => {
    const shellStatus = frontendEnabled ? 'with React SPA' : 'API only';
    console.log(`DOCK GraphQL server running on port ${port} at /graphql (${shellStatus})`);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exitCode = 1;
  });
}
