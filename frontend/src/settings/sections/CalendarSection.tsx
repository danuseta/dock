import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { CalendarDays, Check, Copy, Unplug } from 'lucide-react';
import { GET_SETTINGS } from '../../graphql/queries';
import { DISCONNECT_GOOGLE_CALENDAR } from '../../graphql/mutations';
import { Button, ConfirmDialog, Input } from '../../components/ui';
import { cn } from '../../lib/cn';
import type { SavedSettings, SectionValues } from '../sections';
import { ConnectionStatus, Field, SecretInput, SettingsCard } from '../SettingsParts';

const googleFailureMessages: Record<string, string> = {
  'access-denied': 'Google denied access. Confirm this account is allowed as a test user, then try again.',
  'redirect-uri': 'Google rejected the redirect URI. Register the exact callback in step 1 in Google Cloud.',
  'invalid-client': 'Google rejected the OAuth client. Check the client ID and secret, then save again.',
  'state-expired': 'The OAuth request expired or was interrupted. Connect again.',
  'refresh-token': 'Google did not return offline access. Revoke DOCK access in Google, then connect again.',
  configuration: 'The OAuth client ID or secret is missing. Save both first.',
  'token-exchange': 'Google accepted the redirect but rejected the token exchange. Check the OAuth client.',
  'provider-error': 'Google returned an OAuth error. Check the account and the consent screen, then try again.',
};

/** What `?google=` said when Google sent the browser back here. */
export interface GoogleReturn { result: string; reason: string | null }

export const CalendarSection = ({ values, set, settings, dirty, googleReturn }: {
  values: SectionValues;
  set: (key: string, value: string) => void;
  settings: SavedSettings;
  dirty: boolean;
  googleReturn: GoogleReturn | null;
}) => {
  const [disconnect, { loading: disconnecting }] = useMutation(DISCONNECT_GOOGLE_CALENDAR, { refetchQueries: [{ query: GET_SETTINGS }], awaitRefetchQueries: true });
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [copied, setCopied] = useState(false);
  const redirectUri = `${window.location.origin}/auth/google/callback`;
  const clientSaved = Boolean(settings.googleClientId && settings.hasGoogleClientSecret);
  const connected = Boolean(settings.googleCalendarConnected);
  const steps: Array<[string, boolean]> = [['Redirect URI', true], ['OAuth client', clientSaved], ['Connect', connected], ['Calendar', false]];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const failed = googleReturn?.result === 'failed' ? googleFailureMessages[googleReturn.reason || ''] ?? googleFailureMessages['token-exchange']
    : googleReturn?.result === 'configuration-required' ? googleFailureMessages.configuration : null;

  return (
    <div className="flex flex-col gap-5">
      {failed ? <ConnectionStatus tone="bad" title="Google did not connect" detail={failed} />
        : connected && settings.googleCalendarError ? <ConnectionStatus tone="bad" title="Connected, but Google refuses the calendar" detail={settings.googleCalendarError} />
          : connected ? <ConnectionStatus tone="ok" title={googleReturn?.result === 'connected' ? 'Google Calendar connected just now' : 'Google Calendar connected'} detail="Read-only"><Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(true)} disabled={disconnecting}><Unplug size={14} aria-hidden="true" />{disconnecting ? 'Disconnecting…' : 'Disconnect'}</Button></ConnectionStatus>
            : <ConnectionStatus tone="off" title="Not connected" detail={clientSaved ? 'Client saved · step 3: connect' : 'Follow the steps below'} />}

      <ol className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Connection steps">
        {steps.map(([label, done], index) => {
          const current = !done && steps.slice(0, index).every(([, before]) => before);
          return (
            <li key={label} className={cn('flex items-center gap-2 font-display text-xs font-semibold', done ? 'text-status-merged' : current ? 'text-foreground' : 'text-muted-foreground')} aria-current={current ? 'step' : undefined}>
              <span className={cn('grid size-6 place-items-center rounded-full border font-mono text-[0.7rem]', done ? 'border-status-merged bg-status-merged text-black' : current ? 'border-accent text-accent' : 'border-border-glow')}>{done ? '✓' : index + 1}</span>{label}
            </li>
          );
        })}
      </ol>

      <SettingsCard title="1 · Authorized redirect URI" caption="Add it to the OAuth web client in Google Cloud.">
        <div className="flex items-center gap-2 rounded-sm border border-dashed border-border-glow bg-surface-0 py-1.5 pr-1.5 pl-3">
          <code className="min-w-0 flex-1 truncate font-mono text-xs">{redirectUri}</code>
          <Button size="sm" onClick={copy}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? 'Copied' : 'Copy'}</Button>
        </div>
      </SettingsCard>

      <SettingsCard title="2 · OAuth client" caption="Saved with the Calendar save bar.">
        <div className="grid grid-cols-2 gap-3 max-[620px]:grid-cols-1">
          <Field label="Client ID"><Input className="font-mono" placeholder="…apps.googleusercontent.com" value={values.googleClientId} onChange={(event) => set('googleClientId', event.target.value)} /></Field>
          <SecretInput label="Client secret" saved={Boolean(settings.hasGoogleClientSecret)} value={values.googleClientSecret} onChange={(value) => set('googleClientSecret', value)} placeholder="GOCSPX-…" />
        </div>
      </SettingsCard>

      <SettingsCard title="3 · Connect" caption={dirty ? 'Save the Calendar changes first.' : clientSaved ? 'Opens Google, then comes back to this section.' : 'Save the client ID and secret first.'}>
        <Button variant="primary" disabled={!clientSaved || dirty} onClick={() => window.location.assign('/auth/google/start')}><CalendarDays size={16} aria-hidden="true" />{connected ? 'Reconnect Google' : 'Connect Google'}</Button>
      </SettingsCard>

      <SettingsCard title="4 · Calendar" caption="Which calendar the Calendar page shows. Saved with the Calendar save bar.">
        <Field label="Calendar ID" hint="primary is the account's own calendar."><Input className="font-mono" disabled={!connected} value={values.googleCalendarId} onChange={(event) => set('googleCalendarId', event.target.value)} /></Field>
      </SettingsCard>

      <ConfirmDialog open={confirmDisconnect} title="Disconnect Google Calendar?" description="The Calendar page stops showing events until you connect again." confirmLabel="Disconnect" onConfirm={() => { setConfirmDisconnect(false); void disconnect(); }} onCancel={() => setConfirmDisconnect(false)} />
    </div>
  );
};
