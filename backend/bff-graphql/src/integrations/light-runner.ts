/** The light runner switches of Settings › Sous flow, with their defaults. */
export const LIGHT_SWITCHES = {
  lightRunnerOn: true,
  lightForFindings: true,
  lightForParty: true,
  lightForRetro: false,
  lightBrowserCheck: true,
  lightBlastCheck: true,
} as const;
/** The light runner numbers, with their defaults and the range Settings accepts. */
export const LIGHT_NUMBERS = {
  lightMaxLines: { fallback: 150, min: 1, max: 2000 },
  lightMaxFiles: { fallback: 3, min: 1, max: 50 },
  lightBlastLoops: { fallback: 2, min: 0, max: 5 },
} as const;
export const LIGHT_CHOICES = {
  lightWorkerModel: ['sonnet', 'haiku'],
  lightPublish: ['push', 'draft'],
} as const;
export const LIGHT_KEYS = [...Object.keys(LIGHT_SWITCHES), ...Object.keys(LIGHT_NUMBERS), ...Object.keys(LIGHT_CHOICES)];

export interface LightSettings {
  lightRunnerOn: boolean; lightForFindings: boolean; lightForParty: boolean; lightForRetro: boolean; lightBrowserCheck: boolean; lightBlastCheck: boolean;
  lightMaxLines: number; lightMaxFiles: number; lightBlastLoops: number; lightWorkerModel: string; lightPublish: string;
}

/** Whether a value fits a light runner Settings key; switches are saved as 'true' or 'false'. */
export function isLightSetting(key: string, value: unknown): boolean {
  if (key in LIGHT_SWITCHES) return value === 'true' || value === 'false';
  if (key in LIGHT_NUMBERS) {
    const range = LIGHT_NUMBERS[key as keyof typeof LIGHT_NUMBERS];
    const number = Number(value);
    return value !== '' && value !== null && Number.isInteger(number) && number >= range.min && number <= range.max;
  }
  if (key in LIGHT_CHOICES) return (LIGHT_CHOICES[key as keyof typeof LIGHT_CHOICES] as readonly string[]).includes(String(value));
  return false;
}

/** The saved light runner settings; a value never saved, or one that no longer fits, takes its default. */
export function lightSettings(values: { get(key: string): string | null | undefined }): LightSettings {
  const fits = (key: string) => {
    const value = values.get(key);
    return value != null && isLightSetting(key, value) ? value : null;
  };
  const switches = Object.fromEntries(Object.entries(LIGHT_SWITCHES).map(([key, fallback]) => [key, fits(key) === null ? fallback : fits(key) === 'true']));
  const numbers = Object.fromEntries(Object.entries(LIGHT_NUMBERS).map(([key, range]) => [key, fits(key) === null ? range.fallback : Number(fits(key))]));
  const choices = Object.fromEntries(Object.entries(LIGHT_CHOICES).map(([key, options]) => [key, fits(key) ?? options[0]]));
  return { ...switches, ...numbers, ...choices } as unknown as LightSettings;
}

/** The light runner takes review findings only when it is on and on for findings. */
export const lightForFindings = (settings: LightSettings) => (settings.lightRunnerOn && settings.lightForFindings ? settings : null);

const onOff = (value: boolean) => (value ? 'on' : 'off');

/** The `Light settings:` line sous-light-runner reads from its prompt. */
export const lightSettingsLine = (settings: LightSettings) =>
  `Light settings: lines=${settings.lightMaxLines} files=${settings.lightMaxFiles} worker=${settings.lightWorkerModel} browser=${onOff(settings.lightBrowserCheck)} blast=${onOff(settings.lightBlastCheck)} loops=${settings.lightBlastLoops} publish=${settings.lightPublish}`;
