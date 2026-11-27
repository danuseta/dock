import { StorageService } from '../storage/service';
import { SOUS_FLOW_CACHE, SOUS_FLOW_KEY, decideLines, flowLines, flowRuleLines, guessesHold, profileFor, readFlowRules, readSousFlow, type SousFlowSettings } from './sous-flow';
import { SOUS_FLOW_RULES_KEY } from './lessons';

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

/** The rules Agents › Lessons wrote from flow lessons. */
export async function sousFlowRules(): Promise<string[]> {
  return readFlowRules((await storage.getSettingValues([SOUS_FLOW_RULES_KEY]))[0]?.value);
}

/** The lines the ticket's flow adds to the sous prompt: its stages, how the Decisions stage treats guesses, then the flow rules. */
export async function ticketFlowLines(key: string): Promise<string[]> {
  const { profile } = profileFor(await sousFlowSettings(), await ticketProfile(key));
  return [...flowLines(profile), ...decideLines(profile), ...flowRuleLines(await sousFlowRules())];
}

/** Whether the ticket's guesses hold its pull request as a draft, from its Sous flow profile. */
export async function ticketGuessesHold(key: string): Promise<boolean> {
  return guessesHold(profileFor(await sousFlowSettings(), await ticketProfile(key)).profile);
}
