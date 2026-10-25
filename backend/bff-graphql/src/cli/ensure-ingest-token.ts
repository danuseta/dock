import { orchestratorService } from '../integrations/orchestrator';
import { prisma } from '../storage/client';

const MACHINE = 'workspace';

export interface IngestTokenService {
  authenticateMachine(token: string): Promise<string | null>;
  createToken(name: string, machine?: string | null): Promise<{ token: string }>;
}

export async function ensureIngestToken(service: IngestTokenService, current: string | undefined) {
  const existing = current?.trim();
  if (existing && (await service.authenticateMachine(existing)) === MACHINE) return null;
  return (await service.createToken(MACHINE, MACHINE)).token;
}

async function main() {
  const created = await ensureIngestToken(orchestratorService, process.env.DOCK_INGEST_TOKEN);
  if (created) process.stdout.write(`${created}\n`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'unknown error'}\n`);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
