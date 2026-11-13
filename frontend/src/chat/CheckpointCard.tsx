import React from 'react';
import { Database, Flag, Play, TestTube2 } from 'lucide-react';
import { Button } from '../components/ui';
import { cn } from '../lib/cn';
import { AgentAvatar, MessageTime } from './activity/TranscriptParts';
import { shortAgent } from './activity/transcript';
import { hasNotes, stepLabel, type Checkpoint } from './checkpoints';

interface CheckpointCardProps {
  checkpoint: Checkpoint;
  /** Inside an agent's own thread the agent is already named above, so the card leaves its avatar out. */
  compact?: boolean;
  /** "Lanjut dari <tahap>" after the flow stopped here; it sends that line as a chat message. */
  onContinue?: { label: string; run: () => void } | null;
  as?: 'li' | 'div';
}

const NoteList: React.FC<{ icon: React.ReactNode; title: string; items: string[] }> = ({ icon, title, items }) => (
  <div className="flex flex-col gap-0.5">
    <p className="flex items-center gap-1.5 font-mono text-[0.62rem] font-bold uppercase tracking-[0.08em] text-status-warn">{icon}{title}</p>
    <ul className="flex list-disc flex-col gap-0.5 pl-5 text-[0.76rem] text-secondary-foreground">
      {items.map((item) => <li key={item} className="text-pretty [overflow-wrap:anywhere]">{item}</li>)}
    </ul>
  </div>
);

/** A checkpoint in a thread: the step, the agent and the time over the lead's short report, and the final review's notes. */
export const CheckpointCard: React.FC<CheckpointCardProps> = ({ checkpoint, compact, onContinue, as = 'li' }) => {
  const Tag = as;
  const agent = checkpoint.agent ?? 'lead';
  return (
    <Tag className={cn('min-w-0 rounded-md border border-border-glow bg-surface-1 px-3 py-2.5', compact && 'bg-surface-0')} aria-label={`Checkpoint ${stepLabel(checkpoint.step)}`}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.76rem]">
        <Flag size={13} aria-hidden="true" className="flex-none text-sky-200" />
        <span className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">Checkpoint</span>
        <span className="rounded-xs border border-border px-1.5 font-mono text-[0.66rem] font-semibold text-foreground">{stepLabel(checkpoint.step)}</span>
        {!compact && <span className="flex min-w-0 items-center gap-1.5 text-secondary-foreground"><AgentAvatar name={agent} small /><span className="truncate">{shortAgent(agent)}</span></span>}
        <MessageTime at={checkpoint.at} />
      </p>
      <p className="mt-1.5 text-pretty text-[0.82rem] leading-relaxed text-foreground [overflow-wrap:anywhere]">{checkpoint.text}</p>
      {hasNotes(checkpoint) && (
        <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
          {checkpoint.untestable.length > 0 && <NoteList icon={<TestTube2 size={12} aria-hidden="true" />} title="Belum bisa dites selama tiket ini sendirian di UAT" items={checkpoint.untestable} />}
          {checkpoint.missingData.length > 0 && <NoteList icon={<Database size={12} aria-hidden="true" />} title="Data uji yang belum ada" items={checkpoint.missingData} />}
        </div>
      )}
      {onContinue && (
        <div className="mt-2.5">
          <Button size="sm" variant="primary" onClick={onContinue.run}><Play size={13} aria-hidden="true" />{onContinue.label}</Button>
        </div>
      )}
    </Tag>
  );
};
