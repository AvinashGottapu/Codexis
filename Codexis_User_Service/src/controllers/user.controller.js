import dotenv from 'dotenv';
import * as userModel from '../models/user.model.js';

dotenv.config();

/**
 * Handle Clerk Webhook Events (user.created, user.updated, user.deleted)
 * Assumes signature verification occurred in the `verifyClerkWebhook` middleware.
 */
export const handleClerkWebhook = async (req, res) => {
  const { type, data } = req.webhookEvent;
  console.log(`[User Controller] Received Clerk Webhook event: ${type}`);

  try {
    if (type === 'user.created' || type === 'user.updated') {
      const id = data.id;
      const email = data.email_addresses?.[0]?.email_address;
      
      // Fallback for username if not set in Clerk profile
      const username = data.username || email.split('@')[0] || `user_${id.substring(5, 12)}`;
      const imageUrl = data.image_url || data.profile_image_url;

      await userModel.upsertUser({
        id,
        email,
        username,
        imageUrl,
      });

      console.log(`[User Controller] Synced user ${id} (${username}) successfully`);
      return res.status(200).json({ success: true, message: 'User synced successfully' });
    }

    if (type === 'user.deleted') {
      const id = data.id;
      await userModel.deleteUser(id);
      console.log(`[User Controller] Deleted user ${id} successfully`);
      return res.status(200).json({ success: true, message: 'User deleted successfully' });
    }

    // Default response for unhandled events
    return res.status(200).json({ message: `Ignored event: ${type}` });

  } catch (dbErr) {
    console.error('[User Controller] Database Sync Error:', dbErr);
    return res.status(500).json({ error: 'Database sync failure' });
  }
};


