export interface LightValues {
  lightRunnerOn: boolean; lightForFindings: boolean; lightForParty: boolean; lightForRetro: boolean;
  lightMaxLines: number; lightMaxFiles: number; lightWorkerModel: string; lightBrowserCheck: boolean; lightBlastCheck: boolean; lightBlastLoops: number; lightPublish: string;
}

export const LIGHT_RANGES = {
  lightMaxLines: { min: 1, max: 2000 },
  lightMaxFiles: { min: 1, max: 50 },
  lightBlastLoops: { min: 0, max: 5 },
} as const;

/** The steps a light job takes under these settings; empty when the light runner is off. */
export const lightSteps = (light: LightValues): string[] => (light.lightRunnerOn
  ? ['scout', 'brief', `worker · ${light.lightWorkerModel}`, 'verifier', ...(light.lightBrowserCheck ? ['browser check (FE)'] : []), ...(light.lightBlastCheck ? ['blast check'] : []), light.lightPublish === 'draft' ? 'publisher · draft PR' : 'publisher · push to PR']
  : []);
