import type { ChatAttachment } from '../messages';
import type { TurnOptionsControl } from './useTurnOptions';

export interface TurnOptions {
  model: string | null;
  effort: string | null;
  permissionMode: string | null;
  fast: boolean | null;
}

export interface SendPayload {
  text: string;
  attachmentIds: string[];
  attachments: ChatAttachment[];
  options: TurnOptions | null;
  /** Set when Claude is still on the previous turn: queue waits for it, steer adds to it (or stops it on a bridge without steer). */
  mode?: SendMode | null;
}

export type SendMode = 'queue' | 'steer';

export interface ComposerProps {
  sessionId: string;
  machine: string;
  capabilities: readonly string[];
  blocker: string | null;
  busy: boolean;
  stopping: boolean;
  control: TurnOptionsControl;
  onSend: (payload: SendPayload) => Promise<void>;
  onStop: () => void;
  seed?: { text: string } | null;
  /** The chat panel on a phone: expand sits in the box, Stop takes the place of Send while the box is empty, and the model and Queue/Steer sit under it. */
  compact?: { modelLabel: string } | null;
}

export interface ChatCommand {
  name: string;
  description: string;
  argumentHint: string;
  kind: string;
}

export interface ChatModel {
  value: string;
  label: string;
  efforts: string[];
  fast: boolean;
  /** Claude Code's supportsAutoMode; a bridge that does not say leaves it unset. */
  auto?: boolean;
}

export interface MachineOptions {
  models: ChatModel[];
  modes: string[];
  fastAvailable: boolean;
}

export interface ComposerFeatures {
  picker: boolean;
  attachments: boolean;
  stop: boolean;
  model: boolean;
  effort: boolean;
  fast: boolean;
  mode: boolean;
  steer: boolean;
}

export const MAX_TEXT = 8000;
export const MAX_ATTACHMENTS = 4;
export const IMAGE_BYTES = 5 * 1024 * 1024;
export const FILE_BYTES = 8 * 1024 * 1024;
export const IMAGE_EDGE_PX = 2000;
export const COMMAND_LIMIT = 30;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const TEXT_EXTENSIONS = ['md', 'txt', 'log', 'csv', 'json', 'yaml', 'yml', 'xml', 'html', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'kt', 'sh', 'sql', 'diff', 'patch'];
export const PERMISSION_MODES = ['auto', 'plan', 'acceptEdits', 'bypassPermissions'];
export const MODE_LABELS: Record<string, string> = { auto: 'Auto', plan: 'Plan', acceptEdits: 'Accept edits', bypassPermissions: 'Bypass permissions' };
export const EMPTY_OPTIONS: TurnOptions = { model: null, effort: null, permissionMode: null, fast: null };

export const composerFeatures = (capabilities: readonly string[]): ComposerFeatures => ({
  picker: capabilities.includes('commands'),
  attachments: capabilities.includes('attachments'),
  stop: capabilities.includes('stop'),
  model: capabilities.includes('model'),
  effort: capabilities.includes('effort'),
  fast: capabilities.includes('fast'),
  mode: capabilities.includes('interactive'),
  steer: capabilities.includes('steer'),
});

export const slashQuery = (text: string): string | null => (/^\/\S*$/.test(text) ? text.slice(1) : null);

export const optionId = (id: string, index: number): string => `${id}-option-${index}`;

export const insertCommand = (name: string): string => `/${name.replace(/^\//, '')} `;

export const moveHighlight = (index: number, delta: number, length: number): number => {
  if (length <= 0) return 0;
  if (index < 0 || index >= length) return delta > 0 ? 0 : length - 1;
  return (index + delta + length) % length;
};

export const effortChoices = (models: readonly ChatModel[], model: string | null): string[] => {
  if (model !== null) return models.find((item) => item.value === model)?.efforts ?? [];
  if (models.length === 0) return [];
  return models[0].efforts.filter((level) => models.every((item) => item.efforts.includes(level)));
};

/** An effort the new model does not offer steps down to the highest level it does offer below it. */
export const chooseModel = (options: TurnOptions, model: string | null, models: readonly ChatModel[]): TurnOptions => {
  if (options.effort === null) return { ...options, model };
  const levels = effortChoices(models, model);
  if (levels.includes(options.effort)) return { ...options, model };
  const ladder = [...new Set(models.flatMap((item) => item.efforts))];
  const at = ladder.indexOf(options.effort);
  const below = levels.filter((level) => ladder.indexOf(level) <= at);
  return { ...options, model, effort: below.length > 0 ? below[below.length - 1] : null };
};

export const sanitizeOptions = (options: TurnOptions | null, features: ComposerFeatures, machine: MachineOptions | undefined): TurnOptions | null => {
  if (!options) return null;
  const models = machine?.models ?? [];
  const model = features.model && options.model !== null && models.some((item) => item.value === options.model) ? options.model : null;
  const effort = features.effort && options.effort !== null && effortChoices(models, model).includes(options.effort) ? options.effort : null;
  const permissionMode = features.mode && options.permissionMode !== null && PERMISSION_MODES.includes(options.permissionMode) && (machine?.modes ?? PERMISSION_MODES).includes(options.permissionMode) ? options.permissionMode : null;
  const fast = features.fast && machine?.fastAvailable === true && options.fast === true ? true : null;
  const clean: TurnOptions = { model, effort, permissionMode, fast };
  return model === null && effort === null && permissionMode === null && fast === null ? null : clean;
};

export const buildPayload = (input: { text: string; attachmentIds: readonly string[]; attachments?: readonly ChatAttachment[]; options: TurnOptions | null; features: ComposerFeatures; machineOptions: MachineOptions | undefined }): SendPayload => ({
  text: input.text.trim(),
  attachmentIds: input.features.attachments ? [...input.attachmentIds] : [],
  attachments: input.features.attachments ? [...(input.attachments ?? [])] : [],
  options: sanitizeOptions(input.options, input.features, input.machineOptions),
});

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};

export const isImageType = (type: string): boolean => IMAGE_TYPES.includes(type);

const isTextFile = (file: { name: string; type: string }): boolean =>
  file.type === 'application/pdf' || file.type === 'application/json' || file.type.startsWith('text/') || TEXT_EXTENSIONS.includes(extensionOf(file.name));

export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
};

export const attachmentLimitText = (attached: number): string => (attached >= MAX_ATTACHMENTS ? `At most ${MAX_ATTACHMENTS} files per message` : '');

export const checkFile = (file: { name: string; type: string; size: number }, attached: number): string | null => {
  if (attached >= MAX_ATTACHMENTS) return `Attach at most ${MAX_ATTACHMENTS} files per message`;
  if (!isImageType(file.type) && !isTextFile(file)) return `${file.name}: this file type is not supported`;
  if (file.size <= 0) return `${file.name} is empty`;
  const image = isImageType(file.type);
  const limit = image ? IMAGE_BYTES : FILE_BYTES;
  if (file.size > limit) return `${file.name} is larger than ${formatSize(limit)}`;
  return null;
};

export const uploadMime = (file: { name: string; type: string }): string => {
  if (isImageType(file.type) || file.type === 'application/pdf' || file.type === 'application/json' || file.type.startsWith('text/')) return file.type;
  return 'application/octet-stream';
};

export const acceptAttribute = (): string => [...IMAGE_TYPES, 'application/pdf', 'text/*', 'application/json', ...TEXT_EXTENSIONS.map((extension) => `.${extension}`)].join(',');

export const canSend = (input: { text: string; attachments: number; attachmentsEnabled: boolean; uploading: boolean; blocker: string | null; sending: boolean }): boolean => {
  if (input.blocker || input.sending || input.uploading || input.text.length > MAX_TEXT) return false;
  return input.text.trim().length > 0 || (input.attachmentsEnabled && input.attachments > 0);
};

export const isSendKey = (event: { key: string; shiftKey: boolean; isComposing: boolean }): boolean => event.key === 'Enter' && !event.shiftKey && !event.isComposing;
