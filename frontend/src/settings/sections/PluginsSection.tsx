import type { ReactNode } from 'react';
import { Info, Lock } from 'lucide-react';
import { Input } from '../../components/ui';
import { cn } from '../../lib/cn';
import type { SectionValues } from '../sections';
import { SettingRow, SettingsCard } from '../SettingsParts';

const STORAGE_OPTIONS = [['s3', 'S3'], ['local', 'Local folder'], ['none', 'None']] as const;
const VOICE_OPTIONS = [['elevenlabs', 'ElevenLabs'], ['none', 'None']] as const;

const Choice = ({ label, options, value, onChange }: { label: string; options: ReadonlyArray<readonly [string, string]>; value: string; onChange: (value: string) => void }) => (
  <span className="inline-flex overflow-hidden rounded-xs border border-border-glow font-mono text-[0.72rem]" role="radiogroup" aria-label={label}>
    {options.map(([id, text]) => (
      <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)} className={cn('px-3 py-1.5 max-[760px]:min-h-11', value === id ? 'bg-surface-hover font-bold text-foreground' : 'text-secondary-foreground hover:bg-surface-1')}>{text}</button>
    ))}
  </span>
);

const Note = ({ children }: { children: string }) => (
  <p className="mt-2 flex items-center gap-1.5 text-xs text-status-warn"><Info size={12} aria-hidden="true" />{children}</p>
);

export const PluginsSection = ({ values, set, s3Fields, voiceKeys }: { values: SectionValues; set: (key: string, value: string) => void; s3Fields: ReactNode; voiceKeys: ReactNode }) => (
  <div className="flex flex-col gap-5">
    <SettingsCard title="Plugins" caption="One choice per kind. An empty choice hides the feature that needs it instead of failing. Save in the header applies the choices.">
      <SettingRow label="Storage" help="Where demo videos go">
        <Choice label="Storage plugin" options={STORAGE_OPTIONS} value={values.storagePlugin} onChange={(value) => set('storagePlugin', value)} />
        {values.storagePlugin === 'none' && <Note>Demo video upload is hidden; videos stay in the evidence folder.</Note>}
      </SettingRow>
      {values.storagePlugin === 'local' && (
        <SettingRow label="Local folder" help="Each video is copied here as QRD-xxxx.mp4. The link is the file path.">
          <Input aria-label="Local folder" className="font-mono" placeholder="/home/coder/demo-videos" value={values.storageLocalDir} onChange={(event) => set('storageLocalDir', event.target.value)} />
        </SettingRow>
      )}
      <SettingRow label="Voice" help="Narration of demo videos">
        <Choice label="Voice plugin" options={VOICE_OPTIONS} value={values.voicePlugin} onChange={(value) => set('voicePlugin', value)} />
        {values.voicePlugin === 'none' && <Note>Demo videos are recorded without narration. No error, no setup step.</Note>}
      </SettingRow>
      <SettingRow label="Harness" help="What runs the agents">
        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-secondary-foreground"><Lock size={13} aria-hidden="true" />Claude Code, not a plugin</span>
      </SettingRow>
    </SettingsCard>
    {values.voicePlugin === 'elevenlabs' && voiceKeys}
    {values.storagePlugin === 's3' && s3Fields}
  </div>
);
