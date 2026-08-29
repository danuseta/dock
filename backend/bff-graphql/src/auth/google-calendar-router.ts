import { Request, Response, Router } from 'express';
import { sessionManager, shouldRequirePin } from './session';
import { googleCalendarService } from '../integrations/google-calendar';
import { StorageService } from '../storage/service';

function callbackUrl(request: Request): string {
  const configuredBaseUrl = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, '');
  if (configuredBaseUrl) return `${configuredBaseUrl}/auth/google/callback`;
  const forwardedProto = request.headers['x-forwarded-proto'];
  const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(',')[0]
    || request.protocol;
  return `${protocol}://${request.get('host')}/auth/google/callback`;
}

function failureReason(error: unknown): string {
  const responseData = (error as { response?: { data?: { error?: unknown; error_description?: unknown } } })?.response?.data;
  const message = [responseData?.error, responseData?.error_description, error instanceof Error ? error.message : '']
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (message.includes('invalid or expired oauth state')) return 'state-expired';
  if (message.includes('redirect_uri') || message.includes('redirect uri')) return 'redirect-uri';
  if (message.includes('invalid_client') || message.includes('invalid client')) return 'invalid-client';
  if (message.includes('refresh token')) return 'refresh-token';
  if (message.includes('not configured')) return 'configuration';
  return 'token-exchange';
}

function providerFailureReason(value: unknown): string {
  const error = String(value || '').toLowerCase();
  if (error === 'access_denied') return 'access-denied';
  if (error === 'redirect_uri_mismatch') return 'redirect-uri';
  if (error === 'invalid_client') return 'invalid-client';
  return 'provider-error';
}

function redirectFailure(response: Response, reason: string): void {
  response.redirect(`/settings?google=failed&reason=${encodeURIComponent(reason)}`);
}

export function createGoogleCalendarRouter(): Router {
  const router = Router();
  const storage = new StorageService();

  router.get('/start', async (request, response) => {
    try {
      if (shouldRequirePin(request, await storage.hasMasterPin()) && !sessionManager.isAuthenticated(request)) {
        response.status(401).send('Unlock DOCK before connecting Google Calendar.');
        return;
      }
      response.redirect(await googleCalendarService.authorizationUrl(callbackUrl(request)));
    } catch (error) {
      console.warn(`[Google OAuth] start failed: ${failureReason(error)}`);
      response.redirect('/settings?google=configuration-required');
    }
  });

  router.get('/callback', async (request, response) => {
    try {
      if (request.query.error) {
        redirectFailure(response, providerFailureReason(request.query.error));
        return;
      }
      // SameSite=Strict intentionally prevents the DOCK session cookie from
      // crossing back from Google. The one-time, expiring OAuth state protects
      // this callback; only /start requires an unlocked DOCK session.
      await googleCalendarService.completeAuthorization(
        String(request.query.code || ''),
        String(request.query.state || ''),
        callbackUrl(request),
      );
      response.redirect('/settings?google=connected');
    } catch (error) {
      const reason = failureReason(error);
      console.warn(`[Google OAuth] callback failed: ${reason}`);
      redirectFailure(response, reason);
    }
  });

  return router;
}
