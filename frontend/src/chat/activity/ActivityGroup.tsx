import React, { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { ANNOUNCE_MS, announcement, buildTree, countsText, formatDuration, groupSummary, liveLine, sameEvents, summaryText, type ThreadGroup } from './activity';
import { NodeList, StatusIcon } from './ActivityRow';
import { TurnHighlights } from './TurnHighlights';
import type { DetailStore } from './detailStore';
import { useNow } from './useNow';
import { useThrottledText } from './useThrottledText';

interface ActivityGroupProps {
  group: ThreadGroup;
  live: boolean;
  turnRunning: boolean;
  store: DetailStore;
  stickRef: { current: boolean };
}

export const ActivityGroup = memo(function ActivityGroup({ group, live, turnRunning, store, stickRef }: ActivityGroupProps) {
  const { events } = group;
  const [open, setOpen] = useState(false);
  const [announced, setAnnounced] = useState(live);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tapTop = useRef<number | null>(null);
  const clockOn = useMemo(() => events.some((event) => event.status === 'running'), [events]);
  const now = useNow(clockOn);
  const summary = useMemo(() => groupSummary(events, now, group.stopped), [events, now, group.stopped]);
  const line = useMemo(() => (live ? liveLine(events) : null), [live, events]);
  const tree = useMemo(() => (open ? buildTree(events) : []), [open, events]);
  const spoken = useThrottledText(announced && group.last && (live || !turnRunning) ? announcement(events, live, group.stopped) : '', ANNOUNCE_MS);
  const status = summary.failed > 0 ? 'error' : summary.denied > 0 ? 'denied' : summary.stopped > 0 || summary.userStopped ? 'stopped' : 'ok';

  useEffect(() => {
    if (live) setAnnounced(true);
  }, [live]);

  useLayoutEffect(() => {
    const button = buttonRef.current;
    const scroller = button?.closest<HTMLElement>('[role="log"]');
    if (button && scroller && tapTop.current !== null) scroller.scrollTop += button.getBoundingClientRect().top - tapTop.current;
    tapTop.current = null;
  }, [open]);

  const toggle = () => {
    stickRef.current = false;
    tapTop.current = buttonRef.current?.getBoundingClientRect().top ?? null;
    setOpen((current) => !current);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    setOpen(false);
    buttonRef.current?.focus();
  };

  const elapsed = line ? formatDuration(Math.max(0, now - Date.parse(line.startedAt))) : '';
  const parent = line?.path[line.path.length - 1];

  return (
    <li aria-live="off" className={cn('min-w-0 overflow-hidden rounded-sm border bg-surface-0 font-mono text-[0.68rem]', status === 'error' ? 'border-status-conflict/50' : status === 'denied' ? 'border-amber-300/50' : 'border-border')} onKeyDown={handleKeyDown}>
      <TurnHighlights events={events} store={store} now={now} />
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-9 w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 max-[900px]:min-h-11"
        onClick={toggle}
      >
        <span className="sr-only">Claude&apos;s activity: </span>
        {live ? (
          <>
            <Loader2 size={12} className="flex-none animate-spin text-status-merged motion-reduce:animate-none" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-foreground" aria-hidden="true">
              {line ? line.label : 'Working...'}
              {parent && <span className="text-muted-foreground"> · in {parent}</span>}
              {line && <span className="tabular-nums text-muted-foreground"> · {elapsed}</span>}
            </span>
            <span className="flex-none text-muted-foreground">{countsText(summary)}</span>
          </>
        ) : (
          <>
            <span className="-mt-[0.2rem] flex"><StatusIcon status={status} /></span>
            <span className={cn('min-w-0 flex-1 truncate', status === 'error' ? 'text-status-conflict' : status === 'denied' ? 'text-amber-200' : 'text-muted-foreground')}>{summaryText(summary)}</span>
          </>
        )}
        <ChevronRight size={12} className={cn('flex-none text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-90')} aria-hidden="true" />
      </button>
      {announced && <span className="sr-only" aria-live="polite">{spoken}</span>}
      <div id={panelId}>
        {open && <div className="min-w-0 border-t border-border"><NodeList nodes={tree} store={store} now={now} /></div>}
      </div>
    </li>
  );
}, (previous, next) => previous.live === next.live && previous.turnRunning === next.turnRunning && previous.store === next.store && previous.group.key === next.group.key && previous.group.last === next.group.last && previous.group.stopped === next.group.stopped && sameEvents(previous.group.events, next.group.events));
