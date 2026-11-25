import { importLessons } from '../integrations/lessons-import';
import { evidenceRoot, lessonService } from '../integrations/lessons-live';
import { sprintDashboardService } from '../integrations/sprint-dashboard';
import { prisma } from '../storage/client';
import { StorageService } from '../storage/service';

/**
 * One-off: node dist/cli/import-lessons.js --sprint "QRD Sprint 27" --sprint "QRD Sprint 28" [--keys QRD-1,QRD-2] [--evidence <dir>]
 * Ingests .evidence/judge/*.json, .evidence/retro/*-judge.json and the closed ledgers of the sprints into Agents › Lessons.
 * A lessons file for a skill or agent needs the bridge; it is written by the server's next lessons pass.
 */
async function main() {
  const args = process.argv.slice(2);
  const values = (flag: string) => args.flatMap((arg, index) => (arg === flag && args[index + 1] ? [args[index + 1]] : []));
  const sprints = values('--sprint');
  const keys = values('--keys').flatMap((value) => value.split(',')).map((key) => key.trim()).filter(Boolean);
  const evidence = values('--evidence')[0] || evidenceRoot();
  const storage = new StorageService();
  const result = await importLessons({
    evidence,
    sprints,
    keys,
    service: lessonService,
    sprintKeys: async (name) => {
      const sprint = (await sprintDashboardService.listSprints()).find((item) => item.name === name);
      if (!sprint) return null;
      const issues = JSON.parse(await sprintDashboardService.issueEvents(sprint.id)) as Array<{ key: string }>;
      return issues.map((issue) => issue.key);
    },
    ticketOf: async (sessionId) => (await storage.getChatSession(sessionId))?.ticketKey ?? null,
    log: (line) => process.stdout.write(`${line}\n`),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.unprocessed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
