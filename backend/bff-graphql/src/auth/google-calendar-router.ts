import { Router, Request } from 'express';
import { sessionManager } from './session';
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

export function createGoogleCalendarRouter(): Router {
  const router = Router();
  const storage = new StorageService();

  router.get('/start', async (request, response) => {
    try {
      if (await storage.hasMasterPin() && !sessionManager.isAuthenticated(request)) {
        response.status(401).send('Unlock JIDIS before connecting Google Calendar.');
        return;
      }
      response.redirect(await googleCalendarService.authorizationUrl(callbackUrl(request)));
    } catch {
      response.redirect('/settings?google=configuration-required');
    }
  });

  router.get('/callback', async (request, response) => {
    try {
      // SameSite=Strict intentionally prevents the JIDIS session cookie from
      // crossing back from Google. The one-time, expiring OAuth state protects
      // this callback; only /start requires an unlocked JIDIS session.
      await googleCalendarService.completeAuthorization(
        String(request.query.code || ''),
        String(request.query.state || ''),
        callbackUrl(request),
      );
      response.redirect('/settings?google=connected');
    } catch {
      response.redirect('/settings?google=failed');
    }
  });

  return router;
}
