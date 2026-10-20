import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, CornerDownRight, ListPlus, Loader2, Maximize2, Minimize2, Paperclip, Square } from 'lucide-react';
import { Button } from '../../components/ui';
import { cn } from '../../lib/cn';
import { machinePlace } from '../messages';
import { AttachmentTray } from './AttachmentTray';
import { CommandPicker } from './CommandPicker';
import {
  MAX_TEXT, acceptAttribute, attachmentLimitText, buildPayload, canSend, composerFeatures, insertCommand, isSendKey, moveHighlight, optionId, slashQuery,
  type ChatCommand, type ComposerProps, type SendMode,
} from './composerLogic';
import { readDraft, useDraftSaver } from './composerInput';
import { useAttachments } from './useAttachments';
import { useCommands } from './useCommands';
import { isPhone } from '../../lib/phone';

const ComposerBody: React.FC<ComposerProps> = ({ sessionId, machine, capabilities, blocker, busy, stopping, control, onSend, onStop, seed }) => {
  const features = composerFeatures(capabilities);
  const [draft, setDraft] = useState(() => readDraft(sessionId));
  const [sending, setSending] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [hint, setHint] = useState<{ text: string; hint: string } | null>(null);
  const [mode, setMode] = useState<SendMode>('queue');
  const [full, setFull] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachments = useAttachments(sessionId, features.attachments);
  useDraftSaver(sessionId, draft);
  useEffect(() => {
    if (!seed) return;
    setDraft(seed.text);
    textarea.current?.focus();
  }, [seed]);
  useLayoutEffect(() => {
    const box = textarea.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = full ? '' : `${box.scrollHeight}px`;
  }, [draft, full]);

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

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!features.attachments) return;
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    attachments.add(files);
  };

  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    attachments.add(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const sendLabel = busy ? (mode === 'steer' ? (features.steer ? 'Steer: add to this turn' : 'Steer: stop this turn and send') : 'Queue: send after this turn') : 'Send message';
  const iconButton = 'inline-flex size-8 flex-none items-center justify-center rounded-[10px] border disabled:cursor-not-allowed disabled:opacity-40 max-[900px]:size-11';

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', full && 'max-[900px]:fixed max-[900px]:inset-0 max-[900px]:z-[60] max-[900px]:bg-background max-[900px]:p-3 max-[900px]:pt-[max(0.75rem,env(safe-area-inset-top))]')}>
      <div className="flex items-center justify-end min-[901px]:hidden">
        <Button size="sm" variant="ghost" className="h-11 min-w-11" aria-pressed={full} aria-label={full ? 'Back to the small message box' : 'Write in full screen'} onClick={() => setFull((current) => !current)}>
          {full ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
        </Button>
      </div>
      {hasRows || (pickerOpen && (loading || commands.length === 0)) ? (
        <CommandPicker id={pickerId} commands={commands} loading={loading} highlight={highlight} onHighlight={setHighlight} onPick={pick} />
      ) : null}
      {hint && hint.text === draft && <p className="font-mono text-[0.68rem] text-muted-foreground">{hint.hint}</p>}
      <div className={cn('flex min-w-0 flex-col gap-1.5 rounded-[14px] border border-border-glow bg-surface-1 px-2.5 pt-2 pb-2 focus-within:border-border-accent', full && 'max-[900px]:min-h-0 max-[900px]:flex-1')}>
        {features.attachments && <AttachmentTray items={attachments.items} notice={attachments.notice} limitText={limitText} limitId={limitId} disabled={sending} onRemove={attachments.remove} />}
        <textarea
          ref={textarea}
          className={cn('max-h-[50dvh] min-w-0 resize-none bg-transparent px-1 py-0.5 font-body text-[0.82rem] text-foreground placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50', full && 'max-[900px]:max-h-none max-[900px]:flex-1')}
          rows={1}
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
          onPaste={handlePaste}
        />
        <div className="flex items-center gap-1.5">
          {features.attachments && (
            <>
              <input ref={fileInput} type="file" multiple hidden accept={acceptAttribute()} onChange={handleFiles} />
              <button
                type="button"
                className={cn(iconButton, 'border-border text-secondary-foreground hover:bg-surface-hover hover:text-foreground')}
                aria-label="Attach files"
                title="Attach files"
                aria-describedby={limitText ? limitId : undefined}
                disabled={sending || busy || limitText !== ''}
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip size={15} aria-hidden="true" />
              </button>
            </>
          )}
          <span className="flex-1" />
          {busy && (
            <span className="inline-flex flex-none overflow-hidden rounded-[10px] border border-border-glow" role="radiogroup" aria-label="How a message is sent while Claude works">
              {(['queue', 'steer'] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  role="radio"
                  aria-checked={mode === choice}
                  aria-label={choice === 'queue' ? 'Queue: send after this turn' : features.steer ? 'Steer: add to this turn' : 'Steer: stop this turn and send'}
                  title={choice === 'queue' ? 'Queue: sent when Claude finishes this turn' : features.steer ? 'Steer: added to this turn; Claude reads it after the current step' : 'Steer: stops the current step and answers this next'}
                  className={cn('inline-flex size-8 items-center justify-center max-[900px]:size-11', mode === choice ? 'bg-surface-hover text-foreground' : 'text-muted-foreground hover:bg-surface-2')}
                  onClick={() => setMode(choice)}
                >
                  {choice === 'queue' ? <ListPlus size={15} aria-hidden="true" /> : <CornerDownRight size={15} aria-hidden="true" />}
                </button>
              ))}
            </span>
          )}
          <button
            type="button"
            className={cn(iconButton, 'border-transparent bg-accent text-black hover:bg-accent-hover')}
            disabled={!sendable}
            aria-label={sendLabel}
            title={sendLabel}
            aria-describedby={blocker ? blockerId : undefined}
            onClick={() => void send()}
          >
            <ArrowUp size={15} aria-hidden="true" />
          </button>
          {showStop && (
            <button type="button" className={cn(iconButton, 'border-status-conflict text-status-conflict hover:bg-status-conflict/10')} disabled={stopping} aria-label={stopping ? 'Stopping the turn' : 'Stop the turn'} title={stopping ? 'Stopping...' : 'Stop the turn'} onClick={onStop}>
              {stopping ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Square size={14} aria-hidden="true" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export function Composer(props: ComposerProps): JSX.Element {
  return <ComposerBody key={props.sessionId} {...props} />;
}
