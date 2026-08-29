import { create } from 'zustand';

interface SettingsState {
  jiraConfig: any;
  githubConfig: any;
  discordConfig: any;
  darkMode: boolean;
  autoRefreshInterval: number;
  setJiraConfig: (config: any) => void;
  setGithubConfig: (config: any) => void;
  setDiscordConfig: (config: any) => void;
  toggleDarkMode: () => void;
  setAutoRefreshInterval: (interval: number) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  jiraConfig: {},
  githubConfig: {},
  discordConfig: {},
  darkMode: true,
  autoRefreshInterval: 60000,
  setJiraConfig: (config) => set({ jiraConfig: config }),
  setGithubConfig: (config) => set({ githubConfig: config }),
  setDiscordConfig: (config) => set({ discordConfig: config }),
  toggleDarkMode: () => set((state) => ({ darkMode: !state.darkMode })),
  setAutoRefreshInterval: (interval) => set({ autoRefreshInterval: interval }),
}));
