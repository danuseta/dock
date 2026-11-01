import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { UPDATE_SETTINGS } from '../graphql/mutations';
import { GET_SETTINGS } from '../graphql/queries';
import { CHAT_MACHINE_OPTIONS } from './composer/documents';
import { defaultsToSave, type PopoverRow } from './headerState';

export const useMakeDefault = (machine: string, rows: PopoverRow[]) => {
  const [saved, setSaved] = useState<boolean | null>(null);
  const [updateSettings, { loading: saving }] = useMutation<{ updateSettings: boolean }>(UPDATE_SETTINGS, { refetchQueries: [{ query: CHAT_MACHINE_OPTIONS, variables: { machine } }, { query: GET_SETTINGS }] });
  const toSave = defaultsToSave(rows);
  const pending = Object.keys(toSave).length > 0;

  const makeDefault = async () => {
    try {
      const { data } = await updateSettings({ variables: { input: toSave } });
      setSaved(data?.updateSettings === true);
    } catch {
      setSaved(false);
    }
  };

  return { saved, setSaved, saving, pending, makeDefault };
};

export type MakeDefault = ReturnType<typeof useMakeDefault>;
