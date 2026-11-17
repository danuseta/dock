import { StorageAPI } from '../datasources/StorageAPI';
import { chatService } from './chat';
import { gmSettingsView } from './guild-master';
import { resetOwnerPassLabel } from './review-approval';

const storageAPI = new StorageAPI();

/** The settings a Guild Master turn reads and writes, through the same updateSettings path as the Settings page. */
export const gmSettings = {
  view: async () => gmSettingsView(await storageAPI.getPublicSettings()),
  async put(values: Record<string, string>) {
    const ok = await storageAPI.updateSettings(values);
    resetOwnerPassLabel();
    return { ok, ...(ok ? {} : { error: 'DOCK refused one of the values' }), ...gmSettingsView(await storageAPI.getPublicSettings()) };
  },
};

chatService.gmSettings = gmSettings.view;
