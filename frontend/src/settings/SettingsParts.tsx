import { useState, type ReactNode } from 'react';
import { Eye, EyeOff, Save } from 'lucide-react';
import { Button, Card, IconButton, Input } from '../components/ui';
import { cn } from '../lib/cn';
import type { NavigationMode } from '../lib/navigationPreferences';

export const SettingsCard = ({ title, caption, aside, danger = false, children }: { title: string; caption?: string; aside?: ReactNode; danger?: boolean; children: ReactNode }) => (
  <Card className={cn('p-5', danger && 'border-status-conflict/40 bg-status-conflict-bg/40')}>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="text-balance font-display text-lg font-bold">{title}</h3>{caption && <p className="mt-0.5 text-pretty text-xs text-muted-foreground">{caption}</p>}</div>
      {aside}
    </div>
    {children}
  </Card>
);

/** Label and help on the left, the control on the right; stacked on a phone. */
export const SettingRow = ({ label, help, children }: { label: string; help?: string; children: ReactNode }) => (
  <div className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] items-center gap-4 border-t border-border py-3 first:border-t-0 first:pt-0 max-[720px]:grid-cols-1 max-[720px]:gap-2">
    <div><p className="text-sm font-medium text-foreground">{label}</p>{help && <p className="text-pretty text-xs text-muted-foreground">{help}</p>}</div>
    <div className="min-w-0">{children}</div>
  </div>
);

export type StatusTone = 'ok' | 'bad' | 'warn' | 'off';

const toneClass: Record<StatusTone, string> = {
  ok: 'border-status-merged/45 bg-status-merged-bg',
  bad: 'border-status-conflict/50 bg-status-conflict-bg',
  warn: 'border-status-warn/45 bg-status-warn-bg',
  off: 'border-dashed border-border bg-surface-0',
};

const dotClass: Record<StatusTone, string> = {
  ok: 'bg-status-merged', bad: 'bg-status-conflict', warn: 'bg-status-warn', off: 'border border-muted-foreground',
};

/** The state of a connection, read from saved data and the last test, above its form. */
export const ConnectionStatus = ({ tone, title, detail, children }: { tone: StatusTone; title: string; detail?: string; children?: ReactNode }) => (
  <div className={cn('mb-4 flex flex-wrap items-center gap-3 rounded-md border px-4 py-3', toneClass[tone])} role={tone === 'bad' ? 'alert' : 'status'}>
    <span className={cn('size-2 shrink-0 rounded-full', dotClass[tone])} aria-hidden="true" />
    <div className="min-w-0 flex-1"><p className="font-display text-sm font-bold">{title}</p>{detail && <p className="truncate font-mono text-xs text-muted-foreground">{detail}</p>}</div>
    {children}
  </div>
);

export const Field = ({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) => (
  <label className="block">
    <span className="mb-1 block text-sm font-medium">{label}</span>
    {children}
    {error ? <span className="mt-1 block text-pretty text-xs text-status-conflict" role="alert">{error}</span> : hint && <span className="mt-1 block text-pretty text-xs text-muted-foreground">{hint}</span>}
  </label>
);

/** A secret is never sent to the browser: once saved the field stays blank and says so. */
export const SecretInput = ({ label, saved, value, onChange, placeholder, hint }: { label: string; saved: boolean; value: string; onChange: (value: string) => void; placeholder: string; hint?: string }) => {
  const [shown, setShown] = useState(false);
  return (
    <Field label={label} hint={value && saved ? 'Replaces the saved value when you save.' : hint}>
      <span className="relative block">
        <Input type={shown ? 'text' : 'password'} autoComplete="off" className="pr-12 font-mono" placeholder={saved ? 'Saved · leave blank to keep' : placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
        <IconButton className="absolute top-0 right-0" variant="ghost" aria-label={shown ? `Hide ${label}` : `Show ${label}`} onClick={() => setShown(!shown)}>{shown ? <EyeOff size={16} /> : <Eye size={16} />}</IconButton>
      </span>
    </Field>
  );
};

/** The outcome of a Test button, next to it rather than in a toast. */
export const TestResultText = ({ busy, result }: { busy: boolean; result?: { ok: boolean; message: string } }) => (
  <span role="status" className={cn('font-mono text-xs', busy ? 'text-muted-foreground' : result?.ok ? 'text-status-merged' : 'text-status-conflict')}>
    {busy ? 'Testing…' : result ? `${result.ok ? '✓' : '✗'} ${result.message}` : ''}
  </span>
);

export type SaveOutcome = { ok: boolean; message: string } | null;

/** The save bar of the open section; another section's unsaved changes show as a dot in the rail. */
export const SaveBar = ({ section, changes, errors, saving, outcome, navigationMode, onSave, onDiscard }: {
  section: string;
  changes: number;
  errors: string[];
  saving: boolean;
  outcome: SaveOutcome;
  navigationMode: NavigationMode;
  onSave: () => void;
  onDiscard: () => void;
}) => {
  const message = saving ? 'Saving…'
    : errors.length ? `Fix ${errors.length === 1 ? 'the field' : `${errors.length} fields`} before saving`
      : changes ? `${section} · ${changes} change${changes === 1 ? '' : 's'}`
        : outcome ? outcome.message : 'No changes';
  const tone = errors.length || (outcome && !outcome.ok && !changes) ? 'text-status-conflict' : outcome?.ok && !changes ? 'text-status-merged' : 'text-muted-foreground';
  return (
    <div className={cn(
      'fixed right-[76px] z-20 flex items-center gap-3 rounded-md border border-border-glow bg-surface-2 p-2 pl-4 shadow-card max-[760px]:bottom-[86px] max-[760px]:left-2.5 max-[760px]:h-12 max-[760px]:justify-between max-[760px]:gap-2 max-[760px]:p-1.5 max-[760px]:pl-3',
      !changes && !outcome && 'max-[760px]:hidden',
      navigationMode === 'bottom' ? 'bottom-[max(6rem,calc(env(safe-area-inset-bottom)+6rem))]' : 'bottom-[max(1.5rem,env(safe-area-inset-bottom))]',
    )} role="status">
      <span className={cn('flex min-w-0 items-center gap-2 truncate text-xs', tone)}>{changes > 0 && !saving && !errors.length && <span className="size-2 shrink-0 rounded-full bg-status-warn" aria-hidden="true" />}{message}</span>
      {changes > 0 && !saving && <Button variant="ghost" size="sm" onClick={onDiscard}>Discard</Button>}
      <Button variant="primary" className="h-10 px-4 max-[760px]:h-9" onClick={onSave} disabled={!changes || errors.length > 0 || saving}><Save size={16} aria-hidden="true" />{saving ? 'Saving…' : `Save ${section}`}</Button>
    </div>
  );
};
