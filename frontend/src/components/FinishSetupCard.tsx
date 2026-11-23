import React, { useState } from 'react';
import { useQuery } from '@apollo/client';
import { GET_SETTINGS } from '../graphql/queries';
import { FinishSetupView } from './FinishSetupView';
import { CACHED_QUERY_OPTIONS } from '../lib/queryPolicy';
import { useDockMode } from '../lib/dockMode';
import { setupGaps, type SetupSettings } from '../lib/setupStatus';

const HIDDEN_KEY = 'jidis.finish-setup-hidden';

const readHidden = () => {
  try { return window.localStorage.getItem(HIDDEN_KEY) === '1'; } catch { return false; }
};

export const FinishSetupCard: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const mode = useDockMode();
  const [hidden, setHidden] = useState(readHidden);
  const { data } = useQuery<{ settings: SetupSettings }>(GET_SETTINGS, CACHED_QUERY_OPTIONS);
  if (hidden || !data?.settings) return null;
  const hide = () => {
    try { window.localStorage.setItem(HIDDEN_KEY, '1'); } catch { /* hidden until the page reloads */ }
    setHidden(true);
  };
  return <FinishSetupView gaps={setupGaps(data.settings)} mode={mode} onNavigate={onNavigate} onHide={hide} />;
};
