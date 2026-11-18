import { planningSprintOf } from '../agents/planning';

export type SuggestionId = 'planner' | 'chart' | 'timeline';

/** text null: the prompt comes from DOCK when the chip is clicked (planningChatPrompt). */
export interface ChatSuggestion { id: SuggestionId; label: string; text: string | null }

export const chartPrompt = (sprint: string) => `Make an HTML chart of story points per developer for sprint "${sprint}", biggest first, and put it in Planning as a visual.`;
export const timelinePrompt = (sprint: string) => `Make an HTML timeline of each developer's tickets until the end of sprint "${sprint}" and put it in Planning as a visual.`;

/** The chips above the message box of a Planning-<sprint> chat; Run sprint-planner only while the session has no messages. */
export function chatSuggestions(title: string | null | undefined, messageCount: number): ChatSuggestion[] {
  const sprint = planningSprintOf(title);
  if (!sprint) return [];
  return [
    ...(messageCount === 0 ? [{ id: 'planner' as const, label: 'Run sprint-planner', text: null }] : []),
    { id: 'chart', label: 'Chart SP per dev', text: chartPrompt(sprint) },
    { id: 'timeline', label: 'Timeline per dev', text: timelinePrompt(sprint) },
  ];
}
