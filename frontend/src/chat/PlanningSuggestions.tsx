import React, { useState } from 'react';
import { useApolloClient } from '@apollo/client';
import { BarChart3, CalendarRange, FileEdit, FileSpreadsheet, Play } from 'lucide-react';
import { planningSprintOf } from '../agents/planning';
import { GET_PLANNING_CHAT_PROMPT } from '../graphql/queries';
import { cn } from '../lib/cn';
import { chatSuggestions, type ChatSuggestion } from './suggestions';

const ICONS = { planner: Play, sheet: FileSpreadsheet, rewrite: FileEdit, chart: BarChart3, timeline: CalendarRange } as const;

/** Suggestion chips above the message box of a Planning chat. A click fills the box and never sends. */
export const PlanningSuggestions: React.FC<{ title: string | null | undefined; messageCount: number; onPick: (text: string) => void }> = ({ title, messageCount, onPick }) => {
  const client = useApolloClient();
  const [failed, setFailed] = useState(false);
  const sprint = planningSprintOf(title);
  const list = chatSuggestions(title, messageCount);
  if (!sprint || list.length === 0) return null;
  const pick = async (suggestion: ChatSuggestion) => {
    setFailed(false);
    if (suggestion.text) {
      onPick(suggestion.text);
      return;
    }
    try {
      const answer = await client.query<{ planningChatPrompt: string }>({ query: GET_PLANNING_CHAT_PROMPT, variables: { sprint }, fetchPolicy: 'network-only' });
      onPick(answer.data.planningChatPrompt);
    } catch {
      setFailed(true);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Suggestions">
        {list.map((suggestion) => {
          const Icon = ICONS[suggestion.id];
          return (
            <button
              key={suggestion.id}
              type="button"
              onClick={() => void pick(suggestion)}
              className={cn('inline-flex h-7 items-center gap-1.5 rounded-pill border border-border bg-surface-1 px-3 font-mono text-[0.7rem] text-secondary-foreground hover:border-accent hover:text-accent max-[900px]:h-11', suggestion.id === 'planner' && 'border-accent text-accent')}
            >
              <Icon size={12} aria-hidden="true" />{suggestion.label}
            </button>
          );
        })}
      </div>
      {failed && <p className="text-xs text-status-conflict" role="alert">The sprint-planner prompt could not be loaded.</p>}
    </div>
  );
};
