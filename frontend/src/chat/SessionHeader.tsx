import React, { useId, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { ChevronDown, Pencil } from 'lucide-react';
import { RENAME_CHAT_SESSION, SET_CHAT_SESSION_OPTIONS } from '../graphql/mutations';
import { Button, Input } from '../components/ui';
import { cn } from '../lib/cn';
import { CHAT_MACHINE_OPTIONS } from './composer/documents';
import { composerFeatures } from './composer/composerLogic';
import { sessionTurnOptions, type ChatSession } from './messages';
import {
  appliedOptions, appliedText, defaultsText, effortChoicesFor, modeChoices, modelChoices, modelsText, withChoice,
  type Choice, type OptionField, type SessionMachineOptions,
} from './sessionOptions';

const TITLE_MAX = 120;

const selectClass = 'h-9 w-full min-w-0 rounded-sm border border-border bg-surface-1 px-2 font-body text-xs text-foreground focus-visible:border-border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50 max-[900px]:h-11';

const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

const Field: React.FC<{ label: string; value: string; choices: Choice[]; disabled: boolean; onChange: (value: string) => void }> = ({ label, value, choices, disabled, onChange }) => (
  <label className="flex min-w-[7.5rem] flex-1 flex-col gap-0.5 font-mono text-[0.62rem] text-muted-foreground">
    {label}
    <select className={selectClass} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
    </select>
  </label>
);

interface SessionHeaderProps {
  session: ChatSession;
  machine: string;
  capabilities: readonly string[];
  /** The Sessions page has its own title and rename control. */
  showTitle: boolean;
}

export const SessionHeader: React.FC<SessionHeaderProps> = ({ session, machine, capabilities, showTitle }) => {
  const features = composerFeatures(capabilities);
  const wanted = features.model || features.effort || features.mode;
  const { data } = useQuery<{ chatMachineOptions: SessionMachineOptions | null }>(CHAT_MACHINE_OPTIONS, {
    variables: { machine },
    skip: !wanted,
    fetchPolicy: 'cache-and-network',
  });
  const [rename, { loading: renaming }] = useMutation(RENAME_CHAT_SESSION);
  const [setOptions, { loading: saving }] = useMutation(SET_CHAT_SESSION_OPTIONS);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const panelId = useId();
  const machineOptions = wanted ? data?.chatMachineOptions ?? undefined : undefined;
  const options = sessionTurnOptions(session);
  const applied = appliedOptions(options, machineOptions);
  const editable = session.source === 'dock';
  const showModel = editable && features.model && (machineOptions?.models.length ?? 0) > 0;
  const efforts = machineOptions && editable && features.effort ? effortChoicesFor(machineOptions, options) : [];
  const showMode = editable && features.mode && (machineOptions?.modes.length ?? 0) > 0;
  const hasDetails = machineOptions !== undefined && (showModel || efforts.length > 1 || showMode);

  if (!editable || (!showTitle && !hasDetails)) return null;

  const saveTitle = async () => {
    const title = (titleDraft ?? '').trim();
    if (!title) return;
    setError('');
    try {
      await rename({ variables: { id: session.id, title } });
      setTitleDraft(null);
    } catch (renameError) {
      setError(messageOf(renameError, 'The session could not be renamed'));
    }
  };

  const choose = (field: OptionField) => async (value: string) => {
    if (!machineOptions) return;
    setError('');
    try {
      await setOptions({ variables: { id: session.id, options: withChoice(options, field, value, machineOptions) } });
    } catch (saveError) {
      setError(messageOf(saveError, 'The options could not be saved'));
    }
  };

  return (
    <div className="flex flex-none flex-col border-b border-border bg-surface-0">
      <div className="flex min-w-0 items-center gap-1.5 px-3.5 py-1.5">
        {showTitle && (titleDraft === null ? (
          <>
            <span className="min-w-0 truncate font-display text-xs font-bold" title={session.title}>{session.title || session.ticketKey || 'Untitled session'}</span>
            <Button size="sm" variant="ghost" className="h-6 flex-none px-1.5 max-[900px]:h-11 max-[900px]:min-w-11" aria-label="Rename session" title="Rename" onClick={() => setTitleDraft(session.title)}><Pencil size={12} aria-hidden="true" /></Button>
          </>
        ) : (
          <form className="flex min-w-0 flex-1 items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); void saveTitle(); }}>
            <Input className="h-8 min-w-0 flex-1 px-2.5 text-xs max-[900px]:h-11" value={titleDraft} maxLength={TITLE_MAX} aria-label="Session title" autoFocus onChange={(event) => setTitleDraft(event.target.value)} />
            <Button size="sm" type="submit" variant="primary" className="max-[900px]:h-11" disabled={renaming || !titleDraft.trim()}>Save</Button>
            <Button size="sm" variant="ghost" className="max-[900px]:h-11" onClick={() => setTitleDraft(null)}>Cancel</Button>
          </form>
        ))}
        {hasDetails && titleDraft === null && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            className="ml-auto flex min-h-7 min-w-0 flex-none items-center gap-1.5 rounded-xs border border-border bg-surface-1 px-2 text-left font-mono text-[0.66rem] text-secondary-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 max-[900px]:min-h-11"
            onClick={() => setOpen((current) => !current)}
          >
            <span className="min-w-0 truncate">{appliedText(applied) || 'Session options'}</span>
            <ChevronDown size={13} aria-hidden="true" className={cn('flex-none text-muted-foreground transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>
      {hasDetails && open && machineOptions && (
        <div id={panelId} className="flex flex-col gap-2 border-t border-border px-3.5 py-2" role="group" aria-label="Options for this session">
          <div className="flex flex-wrap items-end gap-2">
            {showMode && <Field label="Mode" value={options?.permissionMode ?? ''} choices={modeChoices(machineOptions)} disabled={saving} onChange={(value) => void choose('permissionMode')(value)} />}
            {showModel && <Field label="Model" value={options?.model ?? ''} choices={modelChoices(machineOptions)} disabled={saving} onChange={(value) => void choose('model')(value)} />}
            {efforts.length > 1 && <Field label="Effort" value={options?.effort ?? ''} choices={efforts} disabled={saving} onChange={(value) => void choose('effort')(value)} />}
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[0.66rem] text-muted-foreground">
            <dt>Applies now</dt>
            <dd className="min-w-0 text-secondary-foreground">
              {applied.length > 0
                ? applied.map((row, index) => (
                  <React.Fragment key={row.field}>
                    {index > 0 && ' · '}
                    {row.label.toLowerCase()} {row.value}{row.fromDefault ? ' (machine default)' : ''}
                  </React.Fragment>
                ))
                : 'the machine decides'}
            </dd>
            <dt>Machine defaults</dt>
            <dd className="min-w-0 text-secondary-foreground">{defaultsText(machineOptions)}</dd>
            {machineOptions.models.length > 0 && (
              <>
                <dt>Models on {machine}</dt>
                <dd className="min-w-0 text-secondary-foreground [overflow-wrap:anywhere]">{modelsText(machineOptions.models)}</dd>
              </>
            )}
          </dl>
        </div>
      )}
      {error && <p className="border-t border-border px-3.5 py-1.5 text-pretty text-xs break-words text-status-conflict" role="alert">{error}</p>}
    </div>
  );
};
