import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { KeyRound } from 'lucide-react';
import { GET_SETTINGS } from '../../graphql/queries';
import { CHANGE_MASTER_PIN, REMOVE_MASTER_PIN, SET_MASTER_PIN } from '../../graphql/mutations';
import { Button, ConfirmDialog, Input } from '../../components/ui';
import { ConnectionStatus, Field, SettingsCard } from '../SettingsParts';

const PIN = /^\d{4,6}$/;
const PIN_RULE = 'Use 4 to 6 digits.';

const PinInput = ({ label, value, onChange, onEnter }: { label: string; value: string; onChange: (value: string) => void; onEnter?: () => void }) => (
  <Input aria-label={label} type="password" inputMode="numeric" autoComplete="off" pattern="\d{4,6}" maxLength={6} className="font-mono" value={value} onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))} onKeyDown={(event) => { if (event.key === 'Enter' && onEnter) onEnter(); }} />
);

/** The fallback PIN. Each action here is its own mutation, so nothing waits for a save bar. */
export const SecuritySection = ({ hasPin }: { hasPin: boolean }) => {
  const refetch = { refetchQueries: [{ query: GET_SETTINGS }], awaitRefetchQueries: true };
  const [setPin, { loading: setting }] = useMutation(SET_MASTER_PIN, refetch);
  const [changePin, { loading: changing }] = useMutation(CHANGE_MASTER_PIN, refetch);
  const [removePin, { loading: removing }] = useMutation(REMOVE_MASTER_PIN, refetch);
  const [newPin, setNewPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [removeCurrent, setRemoveCurrent] = useState('');
  const [changeOpen, setChangeOpen] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (work: () => Promise<boolean>, done: string, refused: string) => {
    setNote(null);
    try {
      if (await work()) { setNote({ ok: true, text: done }); return true; }
      setNote({ ok: false, text: refused });
    } catch (error) {
      setNote({ ok: false, text: error instanceof Error ? error.message : refused });
    }
    return false;
  };

  const turnOn = async () => {
    if (!PIN.test(newPin)) return setNote({ ok: false, text: PIN_RULE });
    if (await run(async () => Boolean((await setPin({ variables: { pin: newPin } })).data?.setMasterPin), 'PIN on. Other signed-in devices were signed out.', 'The PIN was not saved.')) setNewPin('');
  };

  const change = async () => {
    if (!PIN.test(currentPin)) return setNote({ ok: false, text: 'Enter the current PIN.' });
    if (!PIN.test(newPin)) return setNote({ ok: false, text: `New PIN: ${PIN_RULE.toLowerCase()}` });
    if (await run(async () => Boolean((await changePin({ variables: { oldPin: currentPin, newPin } })).data?.changeMasterPin), 'PIN changed. Other signed-in devices were signed out.', 'The current PIN is not right.')) {
      setCurrentPin('');
      setNewPin('');
      setChangeOpen(false);
    }
  };

  const turnOff = async () => {
    setConfirmOff(false);
    if (await run(async () => Boolean((await removePin({ variables: { oldPin: removeCurrent } })).data?.removeMasterPin), 'PIN off.', 'The current PIN is not right.')) setRemoveCurrent('');
  };

  return (
    <div className="flex flex-col gap-5">
      {hasPin
        ? <ConnectionStatus tone="ok" title="PIN on" detail="Asked for outside Tailscale; .ts.net addresses stay unlocked">{!changeOpen && <Button size="sm" onClick={() => { setChangeOpen(true); setNote(null); }}><KeyRound size={14} aria-hidden="true" />Change PIN</Button>}</ConnectionStatus>
        : <ConnectionStatus tone="warn" title="No PIN" detail="Anyone outside Tailscale who reaches DOCK can open it" />}
      {note && <p role={note.ok ? 'status' : 'alert'} className={note.ok ? 'text-sm text-status-merged' : 'text-sm text-status-conflict'}>{note.text}</p>}

      {!hasPin && (
        <SettingsCard title="Turn on PIN" caption="4 to 6 digits. Stored as a salted hash.">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-[220px]"><Field label="New PIN"><PinInput label="New PIN" value={newPin} onChange={setNewPin} onEnter={turnOn} /></Field></div>
            <Button variant="primary" onClick={turnOn} disabled={setting}>{setting ? 'Saving…' : 'Turn on PIN'}</Button>
          </div>
        </SettingsCard>
      )}

      {hasPin && changeOpen && (
        <SettingsCard title="Change PIN" caption="Other signed-in devices are signed out.">
          <div className="grid grid-cols-2 gap-3 max-[620px]:grid-cols-1">
            <Field label="Current PIN"><PinInput label="Current PIN" value={currentPin} onChange={setCurrentPin} /></Field>
            <Field label="New PIN"><PinInput label="New PIN" value={newPin} onChange={setNewPin} onEnter={change} /></Field>
          </div>
          <div className="mt-4 flex gap-2"><Button variant="ghost" onClick={() => { setChangeOpen(false); setNote(null); }}>Cancel</Button><Button variant="primary" onClick={change} disabled={changing}>{changing ? 'Changing…' : 'Change PIN'}</Button></div>
        </SettingsCard>
      )}

      {hasPin && (
        <SettingsCard title="Turn off PIN" caption="Removes the lock for access outside Tailscale." danger>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-[220px]"><Field label="Current PIN"><PinInput label="Current PIN to turn off" value={removeCurrent} onChange={setRemoveCurrent} /></Field></div>
            <Button variant="danger" onClick={() => (PIN.test(removeCurrent) ? setConfirmOff(true) : setNote({ ok: false, text: 'Enter the current PIN.' }))} disabled={removing}>{removing ? 'Turning off…' : 'Turn off PIN'}</Button>
          </div>
        </SettingsCard>
      )}

      <ConfirmDialog open={confirmOff} title="Turn off the PIN?" description="Anyone outside Tailscale who reaches DOCK can open it again." confirmLabel="Turn off PIN" onConfirm={turnOff} onCancel={() => setConfirmOff(false)} />
    </div>
  );
};
