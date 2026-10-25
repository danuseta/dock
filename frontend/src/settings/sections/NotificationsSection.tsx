import { Volume2 } from 'lucide-react';
import { PushCard } from '../../components/PushCard';
import { Button, Checkbox, Select } from '../../components/ui';
import { playSound } from '../../lib/notificationEvents';
import { NOTIFICATION_EVENTS, NOTIFICATION_SOUNDS, valuesToPrefs } from '../../lib/notificationPrefs';
import { type SectionValues } from '../sections';
import { SettingRow, SettingsCard } from '../SettingsParts';

const soundOptions = NOTIFICATION_SOUNDS.map((sound) => ({ value: sound.id, label: sound.label }));

export const NotificationsSection = ({ values, set }: { values: SectionValues; set: (key: string, value: string) => void }) => {
  const volume = valuesToPrefs(values).volume;

  return (
    <div className="flex flex-col gap-5">
      <PushCard />

      <SettingsCard title="Events" caption="Saved with the Notifications save bar. A sound and a browser notification while DOCK is open, a push when it is closed.">
        <SettingRow label="Volume" help="For every sound, including the previews.">
          <div className="flex items-center gap-3">
            <input type="range" min={0} max={100} step={5} aria-label="Volume" className="h-2 w-full accent-accent" value={values.volume} onChange={(event) => set('volume', event.target.value)} />
            <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{values.volume}%</span>
          </div>
        </SettingRow>
        {NOTIFICATION_EVENTS.map((event) => (
          <SettingRow key={event.id} label={event.label} help={event.help}>
            <div className="flex flex-wrap items-center gap-3">
              <Checkbox aria-label={`Notify: ${event.label}`} checked={values[`${event.id}On`] === 'true'} onChange={(change) => set(`${event.id}On`, String(change.target.checked))} />
              <div className="min-w-0 flex-1">
                <Select aria-label={`Sound: ${event.label}`} value={values[`${event.id}Sound`]} onValueChange={(value) => set(`${event.id}Sound`, value)} options={soundOptions} />
              </div>
              <Button size="sm" aria-label={`Preview sound: ${event.label}`} onClick={() => playSound(values[`${event.id}Sound`], volume)}><Volume2 size={14} aria-hidden="true" /> Preview</Button>
            </div>
          </SettingRow>
        ))}
      </SettingsCard>
    </div>
  );
};
