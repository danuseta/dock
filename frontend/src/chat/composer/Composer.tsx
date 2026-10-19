import React, { useRef, useState } from 'react';
import { Loader2, Maximize2, Minimize2, Paperclip, SendHorizontal, Square } from 'lucide-react';
import { Button } from '../../components/ui';
import { cn } from '../../lib/cn';
import { machinePlace } from '../messages';
import { AttachmentTray } from './AttachmentTray';
import { CommandPicker } from './CommandPicker';
import { OptionsBar } from './OptionsBar';
import {
  MAX_TEXT, acceptAttribute, attachmentLimitText, buildPayload, canSend, composerFeatures, insertCommand, isSendKey, moveHighlight, optionId, slashQuery,
  type ChatCommand, type ComposerProps, type SendMode,
} from './composerLogic';
import { useAttachments } from './useAttachments';
import { useCommands } from './useCommands';
import { readOpen, writeOpen } from './optionsSummary';
import { useTurnOptions } from './useTurnOptions';
import { isPhone } from '../../lib/phone';

const ComposerBody: React.FC<ComposerProps> = ({ sessionId, machine, capabilities, blocker, busy, stopping, sessionOptions, onSend, onStop }) => {
  const features = composerFeatures(capabilities);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(readOpen);
  const [highlight, setHighlight] = useState(0);
  const [hint, setHint] = useState<{ text: string; hint: string } | null>(null);
  const [mode, setMode] = useState<SendMode>('queue');
  const [full, setFull] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachments = useAttachments(sessionId, features.attachments);
  const control = useTurnOptions(sessionId, machine, features, sessionOptions);

  const query = features.picker ? slashQuery(draft) : null;
  const pickerOpen = query !== null && !dismissed;
  const { commands, loading } = useCommands(machine, pickerOpen ? query : null);
  const keptFiles = attachments.items.filter((item) => item.state !== 'error').length;
  const limitText = attachmentLimitText(keptFiles);
  const limitId = `chat-attach-limit-${sessionId}`;
  const pickerId = `chat-commands-${sessionId}`;
  const blockerId = `chat-blocker-${sessionId}`;
  const showStop = features.stop && busy;
  const sendable = canSend({ text: draft, attachments: attachments.items.length, attachmentsEnabled: features.attachments, uploading: attachments.uploading, blocker, sending });
  const hasRows = pickerOpen && commands.length > 0;

  const showOptions = (open: boolean) => {
    setOptionsOpen(open);
    writeOpen(open);
  };

  const change = (value: string) => {
    setDraft(value);
    setHighlight(0);
    if (slashQuery(value) === null) setDismissed(false);
  };

  const pick = (command: ChatCommand) => {
    const text = insertCommand(command.name);
    setDraft(text);
    setHint(command.argumentHint ? { text, hint: command.argumentHint } : null);
    setHighlight(0);
    textarea.current?.focus();
  };

  const send = async () => {
    if (!sendable) return;
    const original = draft;
    const payload = { ...buildPayload({ text: draft, attachmentIds: attachments.ids, attachments: attachments.sent, options: control.options, features, machineOptions: control.machineOptions }), mode: busy ? mode : null };
    setSending(true);
    if (optionsOpen) showOptions(false);
    setDraft('');
    setHint(null);
    setFull(false);
    try {
      await onSend(payload);
      attachments.clear();
    } catch {
      setDraft((current) => current || original);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (pickerOpen && !event.nativeEvent.isComposing) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissed(true);
        return;
      }
      if (hasRows && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        setHighlight(moveHighlight(highlight, event.key === 'ArrowDown' ? 1 : -1, commands.length));
        return;
      }
      if (hasRows && (event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
        event.preventDefault();
        pick(commands[Math.min(highlight, commands.length - 1)]);
        return;
      }
    }
    if (!isSendKey({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing })) return;
    event.preventDefault();
    void send();
  };

  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    attachments.add(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', full && 'max-[900px]:fixed max-[900px]:inset-0 max-[900px]:z-[60] max-[900px]:bg-background max-[900px]:p-3 max-[900px]:pt-[max(0.75rem,env(safe-area-inset-top))]')}>
      <div className="flex items-center justify-end min-[901px]:hidden">
        <Button size="sm" variant="ghost" className="h-11 min-w-11" aria-pressed={full} aria-label={full ? 'Back to the small message box' : 'Write in full screen'} onClick={() => setFull((current) => !current)}>
          {full ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
        </Button>
      </div>
      <OptionsBar features={features} control={control} disabled={sending} open={optionsOpen} onToggle={() => showOptions(!optionsOpen)} />
      {features.attachments && <AttachmentTray items={attachments.items} notice={attachments.notice} limitText={limitText} limitId={limitId} disabled={sending} onRemove={attachments.remove} />}
      {hasRows || (pickerOpen && (loading || commands.length === 0)) ? (
        <CommandPicker id={pickerId} commands={commands} loading={loading} highlight={highlight} onHighlight={setHighlight} onPick={pick} />
      ) : null}
      {hint && hint.text === draft && <p className="font-mono text-[0.68rem] text-muted-foreground">{hint.hint}</p>}
      <div className={cn('flex items-end gap-2', full && 'max-[900px]:min-h-0 max-[900px]:flex-1 max-[900px]:items-stretch')}>
        {features.attachments && (
          <>
            <input ref={fileInput} type="file" multiple hidden accept={acceptAttribute()} onChange={handleFiles} />
            <Button
              size="icon"
              variant="default"
              className="h-10 max-[900px]:size-11"
              aria-label="Attach files"
              aria-describedby={limitText ? limitId : undefined}
              disabled={sending || busy || limitText !== ''}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip size={16} aria-hidden="true" />
            </Button>
          </>
        )}
        <textarea
          ref={textarea}
          className={cn('max-h-[50dvh] min-h-24 min-w-0 max-[900px]:min-h-16 flex-1 resize-y rounded-sm border border-border bg-surface-1 px-3 py-2 font-body text-[0.82rem] text-foreground placeholder:text-muted-foreground focus-visible:border-border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50', full && 'max-[900px]:max-h-none max-[900px]:resize-none')}
          rows={4}
          maxLength={MAX_TEXT}
          value={draft}
          placeholder={isPhone() ? 'Type your message...' : `Message Claude Code on ${machinePlace(machine)}...`}
          aria-label="Message"
          role={features.picker ? 'combobox' : undefined}
          aria-autocomplete={features.picker ? 'list' : undefined}
          aria-expanded={features.picker ? hasRows : undefined}
          aria-controls={features.picker && hasRows ? pickerId : undefined}
          aria-activedescendant={hasRows ? optionId(pickerId, Math.min(highlight, commands.length - 1)) : undefined}
          aria-describedby={blocker ? blockerId : undefined}
          onChange={(event) => change(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="flex flex-none flex-col items-stretch gap-1.5">
          {showStop && (
            <Button size="sm" variant="danger" className="h-10 max-[900px]:h-11 max-[900px]:min-w-11" disabled={stopping} aria-label={stopping ? 'Stopping the turn' : 'Stop the turn'} onClick={onStop}>
              {stopping ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Square size={14} aria-hidden="true" />}
              {stopping ? 'Stopping...' : 'Stop'}
            </Button>
          )}
          <Button size="sm" variant="primary" className="h-10 max-[900px]:h-11 max-[900px]:min-w-11" disabled={!sendable} aria-label={busy ? (mode === 'steer' ? (features.steer ? 'Steer: add to this turn' : 'Steer: stop this turn and send') : 'Queue: send after this turn') : 'Send message'} aria-describedby={blocker ? blockerId : undefined} onClick={() => void send()}>
            <SendHorizontal size={14} aria-hidden="true" />{busy ? (mode === 'steer' ? 'Steer' : 'Queue') : 'Send'}
          </Button>
        </div>
      </div>
      {busy && (
        <div className="flex flex-wrap items-center gap-2 font-mono text-[0.66rem] text-muted-foreground" role="group" aria-label="While Claude works">
          <span className="inline-flex overflow-hidden rounded-xs border border-border-glow">
            {(['queue', 'steer'] as const).map((choice) => (
              <button key={choice} type="button" aria-pressed={mode === choice} className={mode === choice ? 'bg-surface-hover px-2 py-1 font-bold text-foreground max-[900px]:min-h-11' : 'px-2 py-1 text-secondary-foreground hover:bg-surface-1 max-[900px]:min-h-11'} onClick={() => setMode(choice)}>{choice === 'queue' ? 'Queue' : 'Steer'}</button>
            ))}
          </span>
          <span className="text-pretty">{mode === 'queue' ? 'Sent when Claude finishes this turn.' : features.steer ? 'Added to this turn; Claude reads it after the current step, and subagents keep running.' : 'Stops the current step, subagents included, and answers this next in the same session.'}</span>
        </div>
      )}
    </div>
  );
};

export function Composer(props: ComposerProps): JSX.Element {
  return <ComposerBody key={props.sessionId} {...props} />;
}
