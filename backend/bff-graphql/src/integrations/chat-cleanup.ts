import { CHAT_MACHINE } from './chat';
import { OrchestratorInputError, normalizeMachine } from './orchestrator';

export interface MachineCleanupDeps {
  sessions(machine: string): Promise<Array<{ id: string; source: string }>>;
  counts(machine: string): Promise<{ messages: number; activity: number; interactions: number; attachments: number; attachmentBytes: number }>;
  deleteSession(id: string): Promise<boolean>;
  forgetStatus(machine: string): Promise<void>;
}

/**
 * Removes every chat session of a machine DOCK no longer keeps, through the same path as deleting one session,
 * so messages, activity, requests, attachment rows and files go with it. Without `apply` it only counts.
 */
export async function removeMachineSessions(deps: MachineCleanupDeps, machineInput: unknown, apply: boolean) {
  const machine = normalizeMachine(machineInput);
  if (machine === CHAT_MACHINE) throw new OrchestratorInputError(`The ${CHAT_MACHINE} sessions are the ones DOCK keeps`);
  const sessions = await deps.sessions(machine);
  const report = {
    machine,
    apply,
    sessions: {
      total: sessions.length,
      cli: sessions.filter((session) => session.source === 'cli').length,
      dock: sessions.filter((session) => session.source === 'dock').length,
    },
    ...await deps.counts(machine),
    deleted: 0,
    failed: [] as string[],
  };
  if (!apply) return report;
  for (const session of sessions) {
    try {
      if (await deps.deleteSession(session.id)) report.deleted += 1;
      else report.failed.push(session.id);
    } catch {
      report.failed.push(session.id);
    }
  }
  await deps.forgetStatus(machine);
  return report;
}
