import { dockMode } from '../mode';
import { StorageService } from '../storage/service';
import { CHAT_MACHINE, chatService } from './chat';
import { OrchestratorInputError, orchestratorService } from './orchestrator';
import { autoAcceptLedgerLines, type RetroLine } from './retro-apply';

const storage = new StorageService();

/** One sous prompt on the workspace: a new session, or the next turn of `into`, queued while it still works. */
async function runOnWorkspace(title: string, text: string, into: string | null) {
  const machines = await orchestratorService.machines();
  if (!machines.includes(CHAT_MACHINE)) throw new OrchestratorInputError('The workspace is not connected');
  if (into) {
    await chatService.sendMessage(into, text, machines, { mode: 'queue' });
    return into;
  }
  const session = await chatService.createSession({ title, machine: CHAT_MACHINE });
  await chatService.sendMessage(session.id, text, machines);
  return session.id;
}

/** The ledger lines of a draft the kit just posted, accepted without the owner; only the workspace DOCK applies lines. */
export async function autoAcceptRetroDraft<T extends RetroLine>(sprint: string, created: T[]) {
  if (dockMode() !== 'workspace' || !created.length) return [];
  const ids = new Set(created.map((item) => item.id));
  const earlier = (await storage.getRetroItems(sprint)).filter((item) => !ids.has(item.id));
  return autoAcceptLedgerLines(created as RetroLine[], earlier, { update: (id, data) => storage.updateRetroItem(id, data), run: runOnWorkspace }, (item, error) => {
    console.warn(`[Retro] ${item.id} stays open for the owner:`, error instanceof Error ? error.message : 'unknown error');
  });
}
