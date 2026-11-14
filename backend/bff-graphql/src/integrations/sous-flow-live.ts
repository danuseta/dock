import { StorageService } from '../storage/service';
import { SOUS_FLOW_CACHE, SOUS_FLOW_KEY, flowLines, profileFor, readSousFlow, type SousFlowSettings } from './sous-flow';

const storage = new StorageService();

/** The saved Sous flow settings, with the defaults filled in. */
export async function sousFlowSettings(): Promise<SousFlowSettings> {
  return readSousFlow((await storage.getSettingValues([SOUS_FLOW_KEY]))[0]?.value);
}

/** The "Kirim checkpoint" switch: the one source the checkpoint route reads. */
export const checkpointsOn = async () => (await sousFlowSettings()).checkpoint;

/** The profile the ticket was given on its detail page, or null when it follows the person's own profile. */
export async function ticketProfile(key: string): Promise<string | null> {
  const value = await storage.getCache(SOUS_FLOW_CACHE, key.trim().toUpperCase()).catch(() => null);
  return typeof value === 'string' && value ? value : null;
}

export async function setTicketProfile(key: string, name: string | null): Promise<string | null> {
  const ticket = key.trim().toUpperCase();
  if (!name) {
    await storage.deleteCache(SOUS_FLOW_CACHE, ticket);
    return null;
  }
  await storage.upsertCache(SOUS_FLOW_CACHE, ticket, name, 0);
  return name;
}

/** The lines the ticket's flow adds to the sous prompt; none for a profile where every stage runs. */
export async function ticketFlowLines(key: string): Promise<string[]> {
  return flowLines(profileFor(await sousFlowSettings(), await ticketProfile(key)).profile);
}
