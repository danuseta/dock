import { isAllRun, startsSous, type SousFlowProfile, type SousFlowSettings } from '../../lib/sousFlow';

/** The profile a session runs: the one picked in its composer, else the ticket's own, else the person's own profile. */
export function sessionProfileName(settings: SousFlowSettings, picked: string | null, ticket: string | null | undefined): string {
  if (picked && settings.profiles[picked]) return picked;
  if (ticket && settings.profiles[ticket]) return ticket;
  return settings.mine;
}

/** The message with the flow's lines under it; only a message that starts sous on a ticket gets them, and none for a flow where every stage runs. */
export const withFlowLines = (text: string, profile: SousFlowProfile, lines: readonly string[]) => (
  startsSous(text) && !isAllRun(profile) && lines.length > 0 ? `${text}\n${lines.join(' ')}` : text
);

export interface SessionFlow {
  names: string[];
  name: string;
  profile: SousFlowProfile;
  picked: boolean;
  pick: (name: string | null) => void;
  /** The message as it goes to sous with this session's flow. */
  decorate: (text: string) => Promise<string>;
}

