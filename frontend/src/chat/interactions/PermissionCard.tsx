import React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../../components/ui';
import { useNow } from '../activity/useNow';
import { countdown, isAnswerable, permissionAnswer, permissionButtons, type ChatInteraction, type PermissionBody, type PermissionDecision, type SettledLine } from './interactions';
import { useAnswer } from './useAnswer';

const LABELS: Record<PermissionDecision, string> = { deny: 'Deny', allow: 'Allow', allow_session: 'Always allow this session' };
const VARIANTS: Record<PermissionDecision, 'danger' | 'primary' | 'default'> = { deny: 'danger', allow: 'primary', allow_session: 'default' };

export const PermissionCard: React.FC<{ sessionId: string; interaction: ChatInteraction; body: PermissionBody; onSettled: (line: SettledLine) => void }> = ({ sessionId, interaction, body, onSettled }) => {
  const now = useNow(true);
  const { busy, error, submit } = useAnswer(sessionId, interaction, onSettled);
  const open = isAnswerable(interaction, now);
  const left = countdown(interaction.expiresAt, now);
  const detail = body.detail && body.detail !== body.summary ? body.detail : '';
  return (
    <section className="flex min-h-0 min-w-0 shrink flex-col rounded-sm border border-amber-300/50 bg-amber-300/10 p-2.5" aria-label={`Permission request: ${body.label}`}>
      <div className="flex min-w-0 flex-none items-baseline justify-between gap-2">
        <p className="min-w-0 break-words font-display text-xs font-bold [overflow-wrap:anywhere]" role="alert">Permission needed: {body.label}{body.agent ? ` (asked by ${body.agent})` : ''}</p>
        <span className="flex-none font-mono text-[0.66rem] text-muted-foreground tabular-nums">{left.text}</span>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain" tabIndex={0} role="region" aria-label="Request details">
      {body.summary && <p className="mt-1 break-words font-mono text-[0.72rem] [overflow-wrap:anywhere]">{body.summary}</p>}
      {detail && (
        <pre className="mt-1.5 whitespace-pre-wrap rounded-xs border border-border bg-surface-0 p-2 font-mono text-[0.72rem] [overflow-wrap:anywhere]" aria-label="Full request">{detail}</pre>
      )}
      {body.alwaysLabel && <p className="mt-1.5 break-words font-mono text-[0.66rem] text-muted-foreground [overflow-wrap:anywhere]">Always allow covers: {body.alwaysLabel}</p>}
      </div>
      {error && <p className="mt-1.5 flex-none text-pretty text-xs break-words text-status-conflict" role="alert">{error}</p>}
      <div className="mt-2 flex flex-none flex-wrap gap-2">
        {permissionButtons(body).map((decision) => (
          <Button key={decision} size="sm" variant={VARIANTS[decision]} className="min-h-11 min-w-[6.5rem] flex-1" disabled={!open || busy} onClick={() => void submit(permissionAnswer(decision))}>
            {busy && decision === 'allow' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}{LABELS[decision]}
          </Button>
        ))}
      </div>
    </section>
  );
};
