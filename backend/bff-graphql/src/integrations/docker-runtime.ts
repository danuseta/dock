const DEFAULT_DOCKER_API_URL = 'http://docker-proxy:2375';
const REQUEST_TIMEOUT_MS = 4_000;
const CACHE_TTL_MS = 8_000;
const MAX_LOG_LINES = 200;
const MAX_LOG_BYTES = 128 * 1024;
const CONTAINER_ID_PATTERN = /^[a-f0-9]{12,64}$/i;

type FetchLike = typeof fetch;

interface DockerPort {
  IP?: string;
  PrivatePort: number;
  PublicPort?: number;
  Type: string;
}

interface DockerContainerResponse {
  Id: string;
  Names?: string[];
  Image: string;
  Command?: string;
  Created: number;
  State: string;
  Status: string;
  Ports?: DockerPort[];
  Labels?: Record<string, string>;
}

interface DockerInfoResponse {
  Name?: string;
  ServerVersion?: string;
  Images?: number;
}

interface DockerStatsResponse {
  cpu_stats?: { cpu_usage?: { total_usage?: number; percpu_usage?: number[] }; system_cpu_usage?: number; online_cpus?: number };
  precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number };
  memory_stats?: { usage?: number; limit?: number; stats?: { cache?: number } };
}

export interface DockerContainer {
  id: string;
  name: string;
  project: string | null;
  image: string;
  command: string | null;
  state: string;
  status: string;
  ports: string[];
  createdAt: string;
  uptime: string;
  cpuPercent: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
  memoryPercent: number | null;
}

export interface DockerRuntime {
  available: boolean;
  engineVersion: string | null;
  serverName: string | null;
  total: number;
  running: number;
  stopped: number;
  images: number;
  containers: DockerContainer[];
  refreshedAt: string;
  error: string | null;
}

const formatPorts = (ports: DockerPort[] = []) => ports.map((port) => {
  const privatePort = `${port.PrivatePort}/${port.Type}`;
  return port.PublicPort ? `${port.IP || '0.0.0.0'}:${port.PublicPort} → ${privatePort}` : privatePort;
});

const formatUptime = (createdSeconds: number, state: string) => {
  if (state !== 'running') return 'Stopped';
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - createdSeconds);
  const days = Math.floor(seconds / 86_400);
  if (days > 0) return `${days}d ${Math.floor((seconds % 86_400) / 3_600)}h`;
  const hours = Math.floor(seconds / 3_600);
  if (hours > 0) return `${hours}h ${Math.floor((seconds % 3_600) / 60)}m`;
  return `${Math.floor(seconds / 60)}m`;
};

const calculateStats = (stats: DockerStatsResponse) => {
  const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage || 0) - (stats.precpu_stats?.cpu_usage?.total_usage || 0);
  const systemDelta = (stats.cpu_stats?.system_cpu_usage || 0) - (stats.precpu_stats?.system_cpu_usage || 0);
  const cpuCount = stats.cpu_stats?.online_cpus || stats.cpu_stats?.cpu_usage?.percpu_usage?.length || 1;
  const cpuPercent = systemDelta > 0 && cpuDelta >= 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;
  const memoryLimitBytes = stats.memory_stats?.limit || 0;
  const memoryUsageBytes = Math.max(0, (stats.memory_stats?.usage || 0) - (stats.memory_stats?.stats?.cache || 0));
  return {
    cpuPercent: Number(cpuPercent.toFixed(2)),
    memoryUsageBytes,
    memoryLimitBytes,
    memoryPercent: memoryLimitBytes > 0 ? Number(((memoryUsageBytes / memoryLimitBytes) * 100).toFixed(2)) : 0,
  };
};

export class DockerRuntimeService {
  private cache: { expiresAt: number; value: DockerRuntime } | null = null;

  constructor(
    private readonly fetcher: FetchLike = fetch,
    private readonly baseUrl = process.env.DOCKER_API_URL || DEFAULT_DOCKER_API_URL,
  ) {}

  private async request(path: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Docker API returned ${response.status}`);
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  async runtime(includeStats = false): Promise<DockerRuntime> {
    if (!includeStats && this.cache && this.cache.expiresAt > Date.now()) return this.cache.value;

    try {
      const [infoResponse, containersResponse] = await Promise.all([
        this.request('/info'),
        this.request('/containers/json?all=1'),
      ]);
      const info = await infoResponse.json() as DockerInfoResponse;
      const rawContainers = await containersResponse.json() as DockerContainerResponse[];
      const containers = await Promise.all(rawContainers.map(async (container): Promise<DockerContainer> => {
        const base = {
          id: container.Id,
          name: container.Names?.[0]?.replace(/^\//, '') || container.Id.slice(0, 12),
          project: container.Labels?.['com.docker.compose.project'] || null,
          image: container.Image,
          command: container.Command || null,
          state: container.State,
          status: container.Status,
          ports: formatPorts(container.Ports),
          createdAt: new Date(container.Created * 1000).toISOString(),
          uptime: formatUptime(container.Created, container.State),
          cpuPercent: null,
          memoryUsageBytes: null,
          memoryLimitBytes: null,
          memoryPercent: null,
        };
        if (!includeStats || container.State !== 'running') return base;
        try {
          const response = await this.request(`/containers/${container.Id}/stats?stream=false&one-shot=true`);
          return { ...base, ...calculateStats(await response.json() as DockerStatsResponse) };
        } catch {
          return base;
        }
      }));

      const value: DockerRuntime = {
        available: true,
        engineVersion: info.ServerVersion || null,
        serverName: info.Name || null,
        total: containers.length,
        running: containers.filter((container) => container.state === 'running').length,
        stopped: containers.filter((container) => container.state !== 'running').length,
        images: info.Images || 0,
        containers,
        refreshedAt: new Date().toISOString(),
        error: null,
      };
      if (!includeStats) this.cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
      return value;
    } catch (error) {
      console.error('[Docker Runtime] Inventory unavailable:', error instanceof Error ? error.message : 'unknown error');
      return {
        available: false, engineVersion: null, serverName: null, total: 0, running: 0, stopped: 0,
        images: 0, containers: [], refreshedAt: new Date().toISOString(), error: 'Docker runtime is unavailable',
      };
    }
  }

  async logs(id: string, tail = 100): Promise<string> {
    if (!CONTAINER_ID_PATTERN.test(id)) throw new Error('Invalid container ID');
    const boundedTail = Math.min(MAX_LOG_LINES, Math.max(1, Math.trunc(tail)));
    const response = await this.request(`/containers/${id}/logs?stdout=true&stderr=true&timestamps=true&tail=${boundedTail}`);
    const bytes = new Uint8Array(await response.arrayBuffer()).slice(0, MAX_LOG_BYTES);
    return this.decodeLogs(bytes).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  }

  private decodeLogs(bytes: Uint8Array): string {
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let offset = 0;
    while (offset + 8 <= bytes.length && bytes[offset] <= 2) {
      const length = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0);
      const start = offset + 8;
      const end = Math.min(start + length, bytes.length);
      chunks.push(decoder.decode(bytes.slice(start, end)));
      offset = end;
    }
    return chunks.length > 0 ? chunks.join('') : decoder.decode(bytes);
  }
}

export const dockerRuntimeService = new DockerRuntimeService();
