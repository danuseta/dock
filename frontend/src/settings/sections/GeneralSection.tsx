import { useEffect, useState } from 'react';
import { Checkbox, Input, Select } from '../../components/ui';
import { cn } from '../../lib/cn';
import { NAVIGATION_PREFERENCES_EVENT, readNavigationPreferences, saveNavigationPreferences, type NavigationMode, type NavigationPreferences } from '../../lib/navigationPreferences';
import { MAX_SERVICE_HEALTH_REFRESH_SECONDS, MIN_SERVICE_HEALTH_REFRESH_SECONDS } from '../../lib/serviceHealthRefresh';
import { healthSeconds, sectionErrors, type SectionValues } from '../sections';
import { SettingRow, SettingsCard } from '../SettingsParts';

const navigationPreview: Record<NavigationMode, string> = {
  left: 'h-full w-2', right: 'ml-auto h-full w-2', top: 'h-2 w-3/5', bottom: 'mt-auto h-2 w-3/5',
};

const every = (seconds: number) => [Math.floor(seconds / 3600) && `${Math.floor(seconds / 3600)} h`, Math.floor((seconds % 3600) / 60) && `${Math.floor((seconds % 3600) / 60)} min`, seconds % 60 && `${seconds % 60} s`].filter(Boolean).join(' ');

export const GeneralSection = ({ values, set }: { values: SectionValues; set: (key: string, value: string) => void }) => {
  const [navigation, setNavigation] = useState(readNavigationPreferences);
  const [savedNote, setSavedNote] = useState(false);

  useEffect(() => {
    const handleChange = (event: Event) => setNavigation((event as CustomEvent<NavigationPreferences>).detail);
    window.addEventListener(NAVIGATION_PREFERENCES_EVENT, handleChange);
    return () => window.removeEventListener(NAVIGATION_PREFERENCES_EVENT, handleChange);
  }, []);

  useEffect(() => {
    if (!savedNote) return undefined;
    const timer = setTimeout(() => setSavedNote(false), 2500);
    return () => clearTimeout(timer);
  }, [savedNote]);

  const saveNavigation = (next: NavigationPreferences) => {
    setNavigation(next);
    saveNavigationPreferences(next);
    setSavedNote(true);
  };

  const error = sectionErrors('general', values)[0];
  const minutes = values.healthUnit === 'minutes';

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard title="This device" caption="Saves immediately, only in this browser." aside={savedNote ? <span role="status" className="font-mono text-xs text-status-merged">✓ Saved on this device</span> : undefined}>
        <SettingRow label="Navigation layout" help="Where the main menu sits.">
          <div className="grid grid-cols-4 gap-2 max-[520px]:grid-cols-2" role="radiogroup" aria-label="Navigation layout">
            {([['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['bottom', 'Bottom']] as const).map(([mode, label]) => {
              const active = navigation.mode === mode;
              return (
                <button type="button" role="radio" aria-checked={active} key={mode} className={cn('rounded-sm border p-2 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60', active ? 'border-accent bg-accent-dim' : 'border-border bg-surface-0 hover:border-border-glow')} onClick={() => saveNavigation({ mode, collapsed: mode === 'left' || mode === 'right' ? navigation.collapsed : false })}>
                  <span className="mb-2 flex h-8 rounded-sm border border-border bg-background p-1" aria-hidden="true"><span className={cn('block rounded-[2px] bg-accent/70', navigationPreview[mode])} /></span>
                  <strong className="block font-display text-xs">{label}</strong>
                </button>
              );
            })}
          </div>
        </SettingRow>
        {(navigation.mode === 'left' || navigation.mode === 'right') && (
          <SettingRow label="Start with a small sidebar" help="Icons only until you expand it.">
            <Checkbox aria-label="Start with a small sidebar" checked={navigation.collapsed} onChange={(event) => saveNavigation({ ...navigation, collapsed: event.target.checked })} />
          </SettingRow>
        )}
      </SettingsCard>

      <SettingsCard title="All devices" caption="Saved with the General save bar.">
        <SettingRow label="Service health refresh" help="How often Home and Services check upstream. Longer intervals send fewer requests.">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <Input type="number" min={minutes ? 1 : MIN_SERVICE_HEALTH_REFRESH_SECONDS} max={minutes ? MAX_SERVICE_HEALTH_REFRESH_SECONDS / 60 : MAX_SERVICE_HEALTH_REFRESH_SECONDS} step={1} inputMode="numeric" aria-label="Refresh every" className="font-mono tabular-nums" value={values.healthValue} aria-invalid={Boolean(error)} aria-describedby="refresh-interval-note" onChange={(event) => set('healthValue', event.target.value)} />
            <Select aria-label="Time unit" value={values.healthUnit} onValueChange={(value) => set('healthUnit', value)} options={[{ value: 'seconds', label: 'Seconds' }, { value: 'minutes', label: 'Minutes' }]} />
          </div>
          <p id="refresh-interval-note" role={error ? 'alert' : undefined} className={cn('mt-1.5 font-mono text-xs', error ? 'text-status-conflict' : 'text-muted-foreground')}>{error || `= every ${every(healthSeconds(values))}`}</p>
        </SettingRow>
      </SettingsCard>
    </div>
  );
};
