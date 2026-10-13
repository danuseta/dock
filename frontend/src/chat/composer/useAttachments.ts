import { useCallback, useEffect, useRef, useState } from 'react';
import { checkFile, isImageType } from './composerLogic';
import type { ChatAttachment } from '../messages';
import { deleteAttachment, prepareImage, uploadAttachment } from './upload';
import { UploadRefused, createUploadQueue, retryOnce } from './uploadQueue';

export interface AttachmentItem {
  key: string;
  name: string;
  mime: string;
  size: number;
  state: 'uploading' | 'ready' | 'error';
  progress: number;
  id: string | null;
  error: string | null;
  previewUrl: string | null;
}

export interface AttachmentControl {
  items: AttachmentItem[];
  ids: string[];
  sent: ChatAttachment[];
  uploading: boolean;
  notice: string;
  add: (files: File[]) => void;
  remove: (key: string) => void;
  clear: () => void;
}

const messageOf = (error: unknown) => (error instanceof Error && error.message ? error.message : 'The upload failed');
const isBusy = (error: unknown) => error instanceof UploadRefused && error.status === 429;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function useAttachments(sessionId: string, enabled: boolean): AttachmentControl {
  const [items, setItems] = useState<AttachmentItem[]>([]);
  const [notice, setNotice] = useState('');
  const itemsRef = useRef(items);
  const aborts = useRef(new Map<string, AbortController>());
  const counter = useRef(0);
  const enqueue = useRef(createUploadQueue());

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    const controllers = aborts.current;
    return () => {
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      itemsRef.current.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, []);

  const patch = useCallback((key: string, change: Partial<AttachmentItem>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));
  }, []);

  const run = useCallback(async (key: string, original: File) => {
    const controller = new AbortController();
    aborts.current.set(key, controller);
    try {
      const file = await prepareImage(original);
      if (controller.signal.aborted) return;
      const problem = checkFile(file, 0);
      if (problem) {
        patch(key, { state: 'error', error: problem });
        return;
      }
      patch(key, { name: file.name, mime: file.type, size: file.size });
      const uploaded = await enqueue.current(async () => {
        if (controller.signal.aborted) return null;
        return retryOnce(() => uploadAttachment(sessionId, file, (fraction) => patch(key, { progress: fraction }), controller.signal), isBusy, pause, controller.signal);
      });
      if (!uploaded) return;
      patch(key, { state: 'ready', progress: 1, id: uploaded.id, name: uploaded.name, size: uploaded.size });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) patch(key, { state: 'error', error: messageOf(error) });
    } finally {
      aborts.current.delete(key);
    }
  }, [patch, sessionId]);

  const add = useCallback((files: File[]) => {
    if (!enabled) return;
    const accepted: AttachmentItem[] = [];
    const sources = new Map<string, File>();
    let counted = itemsRef.current.filter((item) => item.state !== 'error').length;
    let problem = '';
    for (const file of files) {
      const refused = checkFile(isImageType(file.type) ? { name: file.name, type: file.type, size: Math.min(file.size, 1) } : file, counted);
      if (refused) {
        problem = refused;
        continue;
      }
      counter.current += 1;
      const key = `${sessionId}-${counter.current}`;
      counted += 1;
      sources.set(key, file);
      accepted.push({ key, name: file.name, mime: file.type, size: file.size, state: 'uploading', progress: 0, id: null, error: null, previewUrl: isImageType(file.type) ? URL.createObjectURL(file) : null });
    }
    setNotice(problem);
    if (accepted.length === 0) return;
    setItems((current) => [...current, ...accepted]);
    accepted.forEach((item) => {
      const source = sources.get(item.key);
      if (source) void run(item.key, source);
    });
  }, [enabled, run, sessionId]);

  const remove = useCallback((key: string) => {
    const target = itemsRef.current.find((item) => item.key === key);
    aborts.current.get(key)?.abort();
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    if (target?.id) void deleteAttachment(target.id);
    setNotice('');
    setItems((current) => current.filter((item) => item.key !== key));
  }, []);

  const clear = useCallback(() => {
    itemsRef.current.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    setNotice('');
    setItems([]);
  }, []);

  return {
    items,
    ids: items.flatMap((item) => (item.state === 'ready' && item.id ? [item.id] : [])),
    sent: items.flatMap((item) => (item.state === 'ready' && item.id ? [{ id: item.id, name: item.name, mime: item.mime, size: item.size, state: 'attached' }] : [])),
    uploading: items.some((item) => item.state === 'uploading'),
    notice,
    add,
    remove,
    clear,
  };
}
