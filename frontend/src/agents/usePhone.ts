import { useSyncExternalStore } from 'react';
import { PHONE_QUERY } from '../lib/phone';

const subscribePhone = (notify: () => void) => {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};

export const usePhone = () => useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
