import { apiOrigin } from '../../lib/apollo';
import { UploadRefused } from './uploadQueue';
import { IMAGE_BYTES, IMAGE_EDGE_PX, isImageType, uploadMime } from './composerLogic';

export interface UploadedAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
}

const UPLOAD_HEADER = { 'x-dock-upload': '1' };
const ENDPOINT = `${apiOrigin}/api/chat/attachments`;

const parseJson = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

const readError = (status: number, body: string): string => {
  if (status === 429) return 'Too many uploads at once. Try again in a moment';
  const parsed = parseJson(body);
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    const text = record.error ?? record.message;
    if (typeof text === 'string' && text) return text.slice(0, 200);
  }
  const plain = body.trim().slice(0, 200);
  return plain || `The upload was refused (${status})`;
};

export async function prepareImage(file: File): Promise<File> {
  if (!isImageType(file.type) || typeof createImageBitmap === 'undefined') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= IMAGE_EDGE_PX && file.size <= IMAGE_BYTES) return file;
    const scale = Math.min(1, IMAGE_EDGE_PX / longest);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}

export function uploadAttachment(sessionId: string, file: File, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<UploadedAttachment> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(file.name)}`);
    request.withCredentials = true;
    for (const [name, value] of Object.entries(UPLOAD_HEADER)) request.setRequestHeader(name, value);
    request.setRequestHeader('content-type', uploadMime(file));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    request.onerror = () => reject(new Error('The upload could not reach DOCK'));
    request.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new UploadRefused(request.status, readError(request.status, request.responseText)));
        return;
      }
      const parsed = parseJson(request.responseText);
      const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      if (typeof record.id !== 'string') {
        reject(new Error('DOCK did not confirm the upload'));
        return;
      }
      resolve({ id: record.id, name: typeof record.name === 'string' ? record.name : file.name, mime: typeof record.mime === 'string' ? record.mime : file.type, size: typeof record.size === 'number' ? record.size : file.size });
    };
    signal.addEventListener('abort', () => request.abort(), { once: true });
    if (signal.aborted) {
      request.abort();
      return;
    }
    request.send(file);
  });
}

export async function deleteAttachment(id: string): Promise<void> {
  await fetch(`${ENDPOINT}/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include', headers: UPLOAD_HEADER }).then(() => undefined, () => undefined);
}
