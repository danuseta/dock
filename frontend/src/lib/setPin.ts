import type { DockMode } from './dockMode';

export const needsSetPin = (mode: DockMode, hasMasterPin: boolean): boolean => mode === 'workspace' && !hasMasterPin;

export const pinStepOutcome = (first: string, entered: string): 'short' | 'confirm' | 'mismatch' | 'save' => {
  if (entered.length < 4) return 'short';
  if (!first) return 'confirm';
  return entered === first ? 'save' : 'mismatch';
};
