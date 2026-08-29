export interface Ticket {
  id: string;
  key: string;
  summary: string;
  description?: string;
  status: string;
  assignee?: string;
  reporter?: string;
  priority?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommitInfo {
  sha: string;
  author: string;
  message: string;
  date: string;
  url: string;
}

export interface FileInfo {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  blobUrl: string;
}

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  description?: string;
  state: string;
  status?: string;
  url: string;
  author?: string;
  repository?: string;
  repo?: string;
  owner?: string;
  pullNumber?: number;
  baseBranch?: string;
  headBranch?: string;
  commitsCount?: number;
  commits?: CommitInfo[];
  changedFilesCount?: number;
  files?: FileInfo[];
  createdAt?: string;
  updatedAt?: string;
  mergedAt?: string;
}

export interface ConflictDetail {
  file: string;
  message: string;
  resolution?: string;
}

export interface DemoLink {
  id: string;
  name: string;
  url: string;
  environment: 'development' | 'staging' | 'production';
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  id: string;
  key: string;
  value: string;
  description?: string;
  updatedAt: string;
}

export interface RepositoryConfig {
  id: string;
  owner: string;
  name: string;
  webhookSecret?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookPayload {
  event: string;
  payload: any;
}

export interface ServiceResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
