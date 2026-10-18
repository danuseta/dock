export interface DevServer { name: string; folder: string; port: number; running: boolean; state: 'running' | 'starting' | 'stopped' | 'failed'; error?: string | null; pid?: number | null; ticketKey?: string | null; hasLog: boolean }
export interface DevServerAction { at: string; target: string; action: string; ok: boolean; output: string }

/** Running and starting apps can be stopped. */
export const canStop = (state: DevServer['state']) => state === 'running' || state === 'starting';

/** The lines of a log that hold the search text, all of them when there is none. */
export const filterLog = (log: string, search: string) => {
  const needle = search.trim().toLowerCase();
  return needle ? log.split('\n').filter((line) => line.toLowerCase().includes(needle)).join('\n') : log;
};
