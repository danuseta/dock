import React from 'react';
import { useQuery } from '@apollo/client';
import { GET_SETTINGS } from '../graphql/queries';
import { FinishSetupView } from './FinishSetupView';
import { CACHED_QUERY_OPTIONS } from '../lib/queryPolicy';
import { setupGaps, type SetupSettings } from '../lib/setupStatus';

export const FinishSetupCard: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const { data } = useQuery<{ settings: SetupSettings }>(GET_SETTINGS, CACHED_QUERY_OPTIONS);
  return data?.settings ? <FinishSetupView gaps={setupGaps(data.settings)} onNavigate={onNavigate} /> : null;
};
