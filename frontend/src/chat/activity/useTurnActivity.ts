import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ApolloError, useApolloClient } from '@apollo/client';
import { GET_CHAT_ACTIVITY, GET_CHAT_ACTIVITY_DETAIL } from '../../graphql/queries';
import { FAST_POLL_MS, isOptimistic, type ChatMessage } from '../messages';
import { groupByTurn, maxSeq, mergeActivity, type ChatActivity } from './activity';
import { transcriptItems, type TranscriptItem } from './transcript';
import { createDetailStore, type DetailStore } from './detailStore';

const PAGE = 500;
const MAX_PAGES = 6;
const FIRST_TURNS = 8;
const NEAR_TOP_PX = 600;
const MAX_POLL_FAILURES = 3;
const NO_ROWS: ChatActivity[] = [];

let activityUnsupported = false;

const isRefusal = (error: unknown) => {
  if (!(error instanceof ApolloError)) return false;
  const status = (error.networkError as { statusCode?: number } | null)?.statusCode;
  return error.graphQLErrors.length > 0 || status === 400;
};

interface TurnActivity {
  items: TranscriptItem[];
  byTurn: Map<number, ChatActivity[]>;
  liveTurnId: number | undefined;
  store: DetailStore;
}

export function useTurnActivity(sessionId: string, status: string | undefined, messages: ChatMessage[], scrollRef: RefObject<HTMLElement | null>): TurnActivity {
  const client = useApolloClient();
  const [held, setHeld] = useState<{ sessionId: string; rows: ChatActivity[] }>({ sessionId, rows: NO_ROWS });
  const rows = held.sessionId === sessionId ? held.rows : NO_ROWS;
  const rowsRef = useRef<ChatActivity[]>(NO_ROWS);
  const sessionRef = useRef(sessionId);
  const coveredFrom = useRef<number | null>(null);
  const covering = useRef(false);
  const polling = useRef(false);
  const pollFailures = useRef(0);
  const anchorHeight = useRef<number | null>(null);
  const wasRunning = useRef(false);

  const turnIds = useMemo(() => messages.filter((message) => message.role === 'user' && !isOptimistic(message)).map((message) => message.id), [messages]);
  const turnIdsRef = useRef(turnIds);
  const oldestTurn = turnIds[0];
  const newestTurn = turnIds[turnIds.length - 1];
  const running = status === 'running';

  useEffect(() => {
    turnIdsRef.current = turnIds;
  }, [turnIds]);

  useEffect(() => {
    sessionRef.current = sessionId;
    rowsRef.current = NO_ROWS;
    coveredFrom.current = null;
    covering.current = false;
    polling.current = false;
    pollFailures.current = 0;
    wasRunning.current = false;
  }, [sessionId]);

  const apply = useCallback((forSession: string, batch: ChatActivity[], keepPlace: boolean) => {
    if (sessionRef.current !== forSession) return;
    const next = mergeActivity(rowsRef.current, batch);
    if (next === rowsRef.current) return;
    rowsRef.current = next;
    if (keepPlace) anchorHeight.current = scrollRef.current?.scrollHeight ?? null;
    setHeld({ sessionId: forSession, rows: next });
  }, [scrollRef]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && anchorHeight.current !== null) element.scrollTop += element.scrollHeight - anchorHeight.current;
    anchorHeight.current = null;
  }, [rows, scrollRef]);

  const fetchRange = useCallback(async (fromTurnId: number, beforeTurnId?: number) => {
    const all: ChatActivity[] = [];
    let afterSeq = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await client.query<{ chatActivity: ChatActivity[] }>({ query: GET_CHAT_ACTIVITY, variables: { sessionId, afterSeq, fromTurnId, beforeTurnId, limit: PAGE }, fetchPolicy: 'no-cache' });
      all.push(...result.data.chatActivity);
      if (result.data.chatActivity.length < PAGE) break;
      afterSeq = maxSeq(result.data.chatActivity);
    }
    return all;
  }, [client, sessionId]);

  const cover = useCallback(async (older: boolean) => {
    const ids = turnIdsRef.current;
    if (activityUnsupported || covering.current || ids.length === 0) return;
    const from = coveredFrom.current;
    if (from !== null && !(older && ids[0] < from)) return;
    const below = from === null ? ids : ids.filter((id) => id < from);
    const start = below[Math.max(0, below.length - FIRST_TURNS)];
    covering.current = true;
    try {
      const batch = await fetchRange(start, from ?? undefined);
      coveredFrom.current = start;
      apply(sessionId, batch, from !== null);
    } catch (error) {
      if (isRefusal(error)) activityUnsupported = true;
      coveredFrom.current = start;
    } finally {
      covering.current = false;
    }
  }, [apply, fetchRange, sessionId]);

  useEffect(() => {
    void cover(false);
  }, [cover, oldestTurn, newestTurn]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const onScroll = () => {
      if (element.scrollTop < NEAR_TOP_PX) void cover(true);
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    if (element.scrollTop < NEAR_TOP_PX) void cover(true);
    return () => element.removeEventListener('scroll', onScroll);
  }, [cover, scrollRef, oldestTurn]);

  const pollOnce = useCallback(async () => {
    const from = turnIdsRef.current[turnIdsRef.current.length - 1];
    if (activityUnsupported || polling.current || from === undefined || pollFailures.current >= MAX_POLL_FAILURES) return;
    polling.current = true;
    try {
      const result = await client.query<{ chatActivity: ChatActivity[] }>({ query: GET_CHAT_ACTIVITY, variables: { sessionId, afterSeq: maxSeq(rowsRef.current), fromTurnId: from, limit: PAGE }, fetchPolicy: 'no-cache' });
      pollFailures.current = 0;
      apply(sessionId, result.data.chatActivity, false);
    } catch (error) {
      if (isRefusal(error)) activityUnsupported = true;
      else pollFailures.current += 1;
    } finally {
      polling.current = false;
    }
  }, [apply, client, sessionId]);

  useEffect(() => {
    if (!running) return undefined;
    const tick = () => {
      if (!document.hidden) void pollOnce();
    };
    tick();
    const timer = window.setInterval(tick, FAST_POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [running, pollOnce]);

  useEffect(() => {
    if (wasRunning.current && !running) void pollOnce();
    wasRunning.current = running;
  }, [running, pollOnce]);

  const store = useMemo(() => createDetailStore(async (id) => {
    const result = await client.query<{ chatActivityDetail: string | null }>({ query: GET_CHAT_ACTIVITY_DETAIL, variables: { sessionId, id }, fetchPolicy: 'no-cache' });
    return result.data.chatActivityDetail ?? null;
  }), [client, sessionId]);

  const byTurn = useMemo(() => groupByTurn(rows), [rows]);
  const items = useMemo(() => transcriptItems(messages, byTurn), [messages, byTurn]);
  return { items, byTurn, liveTurnId: running ? newestTurn : undefined, store };
}
