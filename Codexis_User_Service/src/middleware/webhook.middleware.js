import { Webhook } from 'svix';
import dotenv from 'dotenv';

dotenv.config();

const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

/**
 * Express middleware to verify Svix signatures for incoming Clerk Webhook requests.
 * Parses and verifies the payload, attaching the secure event object to `req.webhookEvent`.
 */
export const verifyClerkWebhook = (req, res, next) => {
  if (!CLERK_WEBHOOK_SECRET || CLERK_WEBHOOK_SECRET === 'clerk_webhook_secret_placeholder') {
    console.error('[Webhook Middleware] Missing or placeholder CLERK_WEBHOOK_SECRET');
    return res.status(500).json({ error: 'Webhook secret is not configured' });
  }

  const headers = req.headers;
  const payload = req.body;

  const svix_id = headers['svix-id'];
  const svix_timestamp = headers['svix-timestamp'];
  const svix_signature = headers['svix-signature'];

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return res.status(400).json({ error: 'Missing svix headers' });
  }

  try {
    const wh = new Webhook(CLERK_WEBHOOK_SECRET);
    const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
    
    const evt = wh.verify(rawBody, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    });

    // Attach verified event payload to the request object
    req.webhookEvent = evt;
    next();
  } catch (err) {
    console.error('[Webhook Middleware] Webhook verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }
};
