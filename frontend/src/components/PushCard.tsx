import { useEffect, useState } from 'react';
import { useApolloClient, useMutation } from '@apollo/client';
import { BellRing } from 'lucide-react';
import { GET_PUSH_PUBLIC_KEY } from '../graphql/queries';
import { SEND_TEST_PUSH, SUBSCRIBE_PUSH, UNSUBSCRIBE_PUSH } from '../graphql/mutations';
import { currentPushSupport, keyBytes, subscriptionInput } from '../lib/push';
import { Button, Card } from './ui';

/** Switches push notifications on or off for the browser or home screen app this page runs in. */
export const PushCard = () => {
  const client = useApolloClient();
  const [subscribe] = useMutation(SUBSCRIBE_PUSH);
  const [unsubscribe] = useMutation(UNSUBSCRIBE_PUSH);
  const [sendTest] = useMutation(SEND_TEST_PUSH);
  const [support] = useState(currentPushSupport);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  useEffect(() => {
    if (support !== 'ready') return;
    void navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription()).then((subscription) => setOn(Boolean(subscription)));
  }, [support]);

  const act = async (work: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ text: await work(), failed: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Failed', failed: true });
    }
    setBusy(false);
  };

  const enable = () => act(async () => {
    if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked for DOCK in this device\'s settings.');
    const { data } = await client.query({ query: GET_PUSH_PUBLIC_KEY, fetchPolicy: 'network-only' });
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(data.pushPublicKey) });
    await subscribe({ variables: subscriptionInput(subscription) });
    setOn(true);
    return 'On for this device.';
  });

  const disable = () => act(async () => {
    const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (subscription) {
      await unsubscribe({ variables: { endpoint: subscription.endpoint } });
      await subscription.unsubscribe();
    }
    setOn(false);
    return 'Off for this device.';
  });

  const test = () => act(async () => {
    const { data } = await sendTest();
    return data.sendTestPush > 0 ? `Sent to ${data.sendTestPush} device${data.sendTestPush === 1 ? '' : 's'}.` : 'No device took the notification.';
  });

  return (
    <Card aria-labelledby="push-title">
      <div className="mb-4 flex gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-surface-2 text-accent"><BellRing size={18} aria-hidden="true" /></span>
        <div>
          <h3 id="push-title" className="font-display text-lg font-bold">Notifications on this device</h3>
          <p className="mt-1 text-pretty text-sm text-muted-foreground">A notification when a ticket is parked, an agent asks, or a pull request waits for your review. Each phone or browser is switched on by itself.</p>
        </div>
      </div>
      {support === 'install-first' && <p className="text-pretty text-sm text-secondary-foreground">On an iPhone, notifications only work in the installed app. In Safari choose Share, then Add to Home Screen, open DOCK from the new icon and come back to this page.</p>}
      {support === 'unsupported' && <p className="text-pretty text-sm text-secondary-foreground">This browser does not support push notifications.</p>}
      {support === 'ready' && (
        <div className="flex flex-wrap items-center gap-3">
          {on
            ? <Button disabled={busy} onClick={() => void disable()}>{busy ? 'Working...' : 'Turn off'}</Button>
            : <Button variant="primary" disabled={busy} onClick={() => void enable()}>{busy ? 'Working...' : 'Turn on'}</Button>}
          {on && <Button disabled={busy} onClick={() => void test()}>Send a test</Button>}
          {message && <span role="status" className={message.failed ? 'text-sm text-status-conflict' : 'text-sm text-status-merged'}>{message.text}</span>}
        </div>
      )}
    </Card>
  );
};
