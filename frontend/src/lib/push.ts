/** The server's public key in the form `pushManager.subscribe` wants: base64url text to bytes. */
export function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64Url.length / 4) * 4, '=');
  const text = atob(padded);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}

export type PushSupport = 'ready' | 'install-first' | 'unsupported';

/**
 * Whether this browser can take push notifications right now. An iPhone only offers them to a page opened from the
 * home screen, so there the answer in Safari itself is "install first".
 */
export function pushSupport(scope: { serviceWorker: boolean; pushManager: boolean; notification: boolean; ios: boolean; standalone: boolean }): PushSupport {
  if (scope.serviceWorker && scope.pushManager && scope.notification) return 'ready';
  return scope.ios && !scope.standalone ? 'install-first' : 'unsupported';
}

export function currentPushSupport(): PushSupport {
  return pushSupport({
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
    notification: 'Notification' in window,
    ios: /iPhone|iPad|iPod/.test(navigator.userAgent),
    standalone: window.matchMedia('(display-mode: standalone)').matches,
  });
}

/** The keys of a browser subscription as the server stores them. */
export function subscriptionInput(subscription: PushSubscription): { endpoint: string; p256dh: string; auth: string } {
  const json = subscription.toJSON();
  return { endpoint: subscription.endpoint, p256dh: json.keys!.p256dh, auth: json.keys!.auth };
}
