import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@apollo/client';
import { GET_CHAT_SESSION_STATES, GET_SETTINGS } from '../graphql/queries';
import { hasPage, useDockMode } from './dockMode';
import { announce, finishedSessions, newAttention, newDiscordPosts, playSound, pushWanted, soundForPush, type AttentionSignal, type DiscordPostRow, type SessionStatus } from './notificationEvents';
import { noticeFromPush, showNotice } from './notices';
import { parseNotificationPrefs } from './notificationPrefs';
import { CACHED_QUERY_OPTIONS } from './queryPolicy';

const SESSIONS_POLL_MS = 30000;
const PREFS_POLL_MS = 300000;

/**
 * Sound and notification for the three events while DOCK is open, from the lists the layout already polls
 * (needs-attention, Discord, passed in once the server has answered) and a light look at the chat sessions.
 * A device with push is told by the push instead, which the service worker hands to the page as a message.
 */
export function useNotificationEvents(attention: AttentionSignal[] | undefined, discord: DiscordPostRow[] | undefined) {
  const mode = useDockMode();
  const { data: settings } = useQuery(GET_SETTINGS, { ...CACHED_QUERY_OPTIONS, pollInterval: PREFS_POLL_MS });
  const { data: sessions, loading } = useQuery<{ chatSessionStates: SessionStatus[] }>(GET_CHAT_SESSION_STATES, {
    ...CACHED_QUERY_OPTIONS, variables: { limit: 50 }, pollInterval: SESSIONS_POLL_MS, skip: !hasPage(mode, '/sessions'),
  });
  const prefs = useMemo(() => parseNotificationPrefs(settings?.settings?.notificationPrefs), [settings]);
  const latest = useRef(prefs);
  const sessionsSeen = useRef<Map<string, string> | null>(null);
  const attentionSeen = useRef<Set<string> | null>(null);
  const discordSeen = useRef<Set<string> | null>(null);

  useEffect(() => { latest.current = prefs; });

  useEffect(() => {
    if (!sessions || loading) return;
    const { seen, events } = finishedSessions(sessionsSeen.current, sessions.chatSessionStates);
    sessionsSeen.current = seen;
    void announce(events, latest.current);
  }, [sessions, loading]);

  useEffect(() => {
    if (!attention) return;
    const { seen, events } = newAttention(attentionSeen.current, attention);
    attentionSeen.current = seen;
    void announce(events, latest.current);
  }, [attention]);

  useEffect(() => {
    if (!discord) return;
    const { seen, events } = newDiscordPosts(discordSeen.current, discord);
    discordSeen.current = seen;
    void announce(events, latest.current);
  }, [discord]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const heard = (message: MessageEvent) => {
      if (document.visibilityState !== 'visible') return;
      const play = soundForPush(message.data, latest.current);
      if (play) playSound(play.sound, play.volume);
      const notice = noticeFromPush(message.data);
      if (notice && pushWanted(message.data, latest.current)) showNotice(notice);
    };
    navigator.serviceWorker.addEventListener('message', heard);
    return () => navigator.serviceWorker.removeEventListener('message', heard);
  }, []);
}
