import { chatService } from '../integrations/chat';
import { removeMachineSessions } from '../integrations/chat-cleanup';
import { prisma } from '../storage/client';
import { StorageService } from '../storage/service';

/**
 * One-off: node dist/cli/remove-machine-sessions.js --machine laptop [--apply]
 * Without --apply it prints what would be removed and changes nothing.
 */
async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--machine');
  const machine = at >= 0 ? args[at + 1] : undefined;
  const apply = args.includes('--apply');
  const storage = new StorageService();
  const report = await removeMachineSessions({
    sessions: (name) => storage.getChatSessionsOnMachine(name),
    counts: (name) => storage.countChatRowsOnMachine(name),
    deleteSession: (id) => chatService.deleteSession(id),
    forgetStatus: (name) => chatService.forgetStatus(name),
  }, machine, apply);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!apply) process.stdout.write('Dry run: nothing was removed. Add --apply to remove.\n');
  if (report.failed.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
