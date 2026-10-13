import { useEffect, useRef, useState } from 'react';
import { closedSince, settle, visiblePending, type ChatInteraction, type SettledInteraction, type SettledLine } from './interactions';

export interface InteractionLog {
  cards: ChatInteraction[];
  lines: SettledLine[];
  record: (line: SettledLine) => void;
}

export function useInteractionLog(pending: ChatInteraction[] | null | undefined, settled?: SettledInteraction[] | null): InteractionLog {
  const [log, setLog] = useState<SettledLine[]>([]);
  const previous = useRef<ChatInteraction[]>([]);

  useEffect(() => {
    const before = previous.current;
    const next = pending ?? [];
    const now = Date.now();
    previous.current = next;
    setLog((current) => {
      const closed = closedSince(before, next, current, now, settled ?? []);
      return closed.length === 0 ? current : closed.reduce((lines, line) => settle(lines, line, now), current);
    });
  }, [pending, settled]);

  const record = (line: SettledLine) => setLog((current) => settle(current, line, line.at));
  return { cards: visiblePending(pending ?? [], log), lines: log, record };
}
