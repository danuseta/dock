import { useEffect, useMemo, useRef, useState } from 'react';
import { useApolloClient } from '@apollo/client';
import { GET_CHAT_ACTIVITY, GET_CHAT_ACTIVITY_DETAIL } from '../../graphql/queries';
import { FAST_POLL_MS } from '../messages';
import { maxSeq, mergeActivity, type ChatActivity } from './activity';
import { createDetailStore, type DetailStore } from './detailStore';

const PAGE = 500;
const MAX_PAGES = 6;
const NO_ROWS: ChatActivity[] = [];

interface AgentThreadRows { rows: ChatActivity[]; state: 'loading' | 'ready' | 'failed'; store: DetailStore }

/**
 * Every row of the turn a thread belongs to, fetched for that turn alone. The conversation only holds the newest turns,
 * so a worker from an older turn would otherwise open empty. While the thread runs, new rows are polled.
 */
export function useAgentThread(sessionId: string, turnId: number | null, live: boolean): AgentThreadRows {
  const client = useApolloClient();
  const [held, setHeld] = useState<{ key: string; rows: ChatActivity[]; state: AgentThreadRows['state'] }>({ key: '', rows: NO_ROWS, state: 'loading' });
  const key = `${sessionId}:${turnId}`;
  const rowsRef = useRef<ChatActivity[]>(NO_ROWS);
  const keyRef = useRef(key);

  useEffect(() => {
    keyRef.current = key;
    rowsRef.current = NO_ROWS;
    if (turnId === null) return undefined;
    let cancelled = false;
    const load = async () => {
      const all: ChatActivity[] = [];
      let afterSeq = 0;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await client.query<{ chatActivity: ChatActivity[] }>({ query: GET_CHAT_ACTIVITY, variables: { sessionId, afterSeq, fromTurnId: turnId, beforeTurnId: turnId + 1, limit: PAGE }, fetchPolicy: 'no-cache' });
        all.push(...result.data.chatActivity);
        if (result.data.chatActivity.length < PAGE) break;
        afterSeq = maxSeq(result.data.chatActivity);
      }
      return all;
    };
    load().then(
      (rows) => {
        if (cancelled) return;
        rowsRef.current = mergeActivity(NO_ROWS, rows);
        setHeld({ key, rows: rowsRef.current, state: 'ready' });
      },
      () => {
        if (!cancelled) setHeld({ key, rows: NO_ROWS, state: 'failed' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, key, sessionId, turnId]);

  useEffect(() => {
    if (!live || turnId === null) return undefined;
    let busy = false;
    const timer = window.setInterval(() => {
      if (busy || document.hidden || keyRef.current !== key) return;
      busy = true;
      client.query<{ chatActivity: ChatActivity[] }>({ query: GET_CHAT_ACTIVITY, variables: { sessionId, afterSeq: maxSeq(rowsRef.current), fromTurnId: turnId, beforeTurnId: turnId + 1, limit: PAGE }, fetchPolicy: 'no-cache' })
        .then((result) => {
          if (keyRef.current !== key) return;
          const next = mergeActivity(rowsRef.current, result.data.chatActivity);
          if (next === rowsRef.current) return;
          rowsRef.current = next;
          setHeld({ key, rows: next, state: 'ready' });
        }, () => undefined)
        .finally(() => {
          busy = false;
        });
    }, FAST_POLL_MS);
    return () => window.clearInterval(timer);
  }, [client, key, live, sessionId, turnId]);

  const store = useMemo(() => createDetailStore(async (id) => {
    const result = await client.query<{ chatActivityDetail: string | null }>({ query: GET_CHAT_ACTIVITY_DETAIL, variables: { sessionId, id }, fetchPolicy: 'no-cache' });
    return result.data.chatActivityDetail ?? null;
  }), [client, sessionId]);

  return held.key === key ? { rows: held.rows, state: held.state, store } : { rows: NO_ROWS, state: 'loading', store };
}
