export interface JudgeSettingsForm { on: boolean; account: string; windows: Array<{ from: string; to: string }>; idleMinutes: number; noonCutoff: string }

/** Judge stays off until the owner switches it on, so nothing runs on a fresh DOCK. */
export const JUDGE_DEFAULTS: JudgeSettingsForm = { on: false, account: '', windows: [{ from: '21:00', to: '23:30' }, { from: '08:00', to: '09:00' }], idleMinutes: 30, noonCutoff: '12:00' };

export function readJudgeSettings(raw: string | null | undefined): JudgeSettingsForm {
  try {
    const value = JSON.parse(raw ?? '') as Partial<JudgeSettingsForm>;
    return { ...JUDGE_DEFAULTS, ...value, windows: Array.isArray(value.windows) ? value.windows : JUDGE_DEFAULTS.windows };
  } catch {
    return JUDGE_DEFAULTS;
  }
}
