export interface DockerContainer {
  id: string;
  name: string;
  project?: string | null;
  image: string;
  command?: string | null;
  state: string;
  status: string;
  ports: string[];
  createdAt: string;
  uptime: string;
  cpuPercent?: number | null;
  memoryUsageBytes?: number | null;
  memoryLimitBytes?: number | null;
  memoryPercent?: number | null;
}

export interface DockerRuntime {
  available: boolean;
  engineVersion?: string | null;
  serverName?: string | null;
  total: number;
  running: number;
  stopped: number;
  images: number;
  refreshedAt: string;
  error?: string | null;
  containers: DockerContainer[];
}

export const formatBytes = (bytes?: number | null) => {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
};

export const dockerStatusTone = (state: string) => state === 'running'
  ? 'bg-status-merged'
  : state === 'paused'
    ? 'bg-amber-500'
    : 'bg-muted-foreground';
