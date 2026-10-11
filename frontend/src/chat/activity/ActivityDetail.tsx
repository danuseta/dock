import { memo, useEffect, useSyncExternalStore } from 'react';
import { splitDetail } from './activity';
import type { DetailStore } from './detailStore';

interface ActivityDetailProps { id: number; version: string; store: DetailStore }

const quiet = 'px-1 py-1 font-mono text-[0.66rem] text-muted-foreground';

export const ActivityDetail = memo(function ActivityDetail({ id, version, store }: ActivityDetailProps) {
  const entry = useSyncExternalStore(store.subscribe, () => store.get(id));
  useEffect(() => {
    store.load(id, version);
  }, [store, id, version]);

  if (entry.state === 'failed') {
    return (
      <p className={quiet}>
        This detail could not be loaded.{' '}
        <button type="button" className="min-h-11 px-1 underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 min-[901px]:min-h-0" onClick={() => store.load(id, version)}>Try again</button>
      </p>
    );
  }
  if (entry.text === null) return <p className={quiet}>{entry.state === 'ready' ? 'No detail was recorded for this step.' : 'Loading the detail...'}</p>;
  const { body, notice } = splitDetail(entry.text);
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-1 py-1">
      {body && (
        <pre
          className="max-h-[40vh] max-w-full overflow-auto overscroll-contain whitespace-pre rounded-xs border border-border bg-surface-0 p-2 font-mono text-[0.66rem] leading-snug text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          tabIndex={0}
          aria-label="Step detail"
        >{body}</pre>
      )}
      {notice && <p className={quiet}>{notice}</p>}
    </div>
  );
});
