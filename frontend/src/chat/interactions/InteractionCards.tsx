import React from 'react';
import { useNow } from '../activity/useNow';
import { freshLines, parseBody, planTextFor, type ChatInteraction, type SettledLine } from './interactions';
import { PermissionCard } from './PermissionCard';
import { PlanCard } from './PlanCard';
import { QuestionCard } from './QuestionCard';

interface InteractionCardsProps {
  sessionId: string;
  cards: ChatInteraction[];
  lines: SettledLine[];
  messages: ReadonlyArray<{ id: number; role: string; text: string }>;
  onSettled: (line: SettledLine) => void;
}

export const InteractionCards: React.FC<InteractionCardsProps> = ({ sessionId, cards, lines, messages, onSettled }) => {
  const now = useNow(lines.length > 0);
  const recent = freshLines(lines, now);
  if (cards.length === 0 && recent.length === 0) return null;
  return (
    <div className="flex max-h-[55%] min-h-0 shrink flex-col gap-2 overflow-hidden border-t border-border bg-surface-0 px-3.5 py-2.5">
      {recent.map((line) => (
        <p key={`done-${line.id}`} className="break-words font-mono text-[0.68rem] text-muted-foreground [overflow-wrap:anywhere]" role="status">{line.outcome}: {line.title}</p>
      ))}
      {[...cards].reverse().map((interaction) => {
        const body = parseBody(interaction);
        if (!body) return null;
        if (body.kind === 'permission') return <PermissionCard key={interaction.id} sessionId={sessionId} interaction={interaction} body={body} onSettled={onSettled} />;
        if (body.kind === 'question') return <QuestionCard key={interaction.id} sessionId={sessionId} interaction={interaction} body={body} onSettled={onSettled} />;
        return <PlanCard key={interaction.id} sessionId={sessionId} interaction={interaction} planText={planTextFor(messages, interaction.turnId)} onSettled={onSettled} />;
      })}
    </div>
  );
};
