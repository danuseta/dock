// The pure side of the Planning storyboard board: which flows show, which tickets each holds, how a version reads.
import type { DraftTicket, StoryboardFlow, StoryboardScenario, StoryboardState } from './planning';

export const flowsOfScenario = (scenario: StoryboardScenario | undefined): StoryboardFlow[] => scenario?.groups.flatMap((group) => group.flows) ?? [];
export const changedFlowCount = (board: StoryboardState | undefined) => (board?.scenarios ?? []).reduce((count, scenario) => count + flowsOfScenario(scenario).filter((flow) => flow.changed).length, 0);

/** The tickets a flow lists, plus the sprint tickets a changed flow without its own list flagged from their AC text. */
export function flowTickets(flow: StoryboardFlow, tickets: DraftTicket[]): string[] {
  const guessed = tickets.filter((ticket) => ticket.storyboard?.frames.includes(flow.id)).map((ticket) => ticket.key);
  return [...new Set([...flow.tickets, ...guessed])];
}

/** The scenario's groups with only the flows that hold an open sprint ticket when `only` is set; empty groups drop out. */
export function visibleGroups(scenario: StoryboardScenario | undefined, tickets: DraftTicket[], only: boolean) {
  const open = new Set(tickets.map((ticket) => ticket.key));
  return (scenario?.groups ?? [])
    .map((group) => ({ title: group.title, flows: group.flows.filter((flow) => !only || flowTickets(flow, tickets).some((key) => open.has(key))) }))
    .filter((group) => group.flows.length > 0);
}

export const versionLabel = (version: number | null) => {
  if (!version) return 'no version';
  return version > 1e9 ? `v${version} · ${new Date(version * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : `v${version}`;
};
