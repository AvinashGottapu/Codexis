import { verifyToken, createClerkClient } from '@clerk/backend';
import { prisma } from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const clerkClient = createClerkClient({ secretKey: CLERK_SECRET_KEY });

/**
 * Express middleware to authenticate requests using Clerk JWT Session Tokens.
 * Verifies tokens cryptographically, ensures the user exists locally (self-healing),
 * and mounts the verified user ID to `req.auth.userId`.
 */
export const authenticateClerk = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing or invalid token format' });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify the JWT token cryptographically (resolves JWKS automatically)
    const decoded = await verifyToken(token, {
      secretKey: CLERK_SECRET_KEY,
      clockSkewInMs: 30000, // 30 seconds clock skew buffer for local development
    });

    const userId = decoded.sub;

    // Self-healing database check (pull from Clerk and sync locally if missing)
    let localUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!localUser) {
      console.log(`[User Service Auth] User ${userId} not found in database. Auto-syncing from Clerk API...`);
      try {
        const clerkUser = await clerkClient.users.getUser(userId);
        const email = clerkUser.emailAddresses?.[0]?.emailAddress || `temp-${userId}@codexis.local`;
        const username = clerkUser.username || email.split('@')[0] || `user_${userId.substring(5, 12)}`;
        const imageUrl = clerkUser.imageUrl || clerkUser.profileImageUrl;

        localUser = await prisma.user.upsert({
          where: { id: userId },
          update: { email, username, imageUrl },
          create: { id: userId, email, username, imageUrl },
        });
        console.log(`[User Service Auth] Auto-synced user ${userId} successfully.`);
      } catch (clerkErr) {
        console.error(`[User Service Auth] Clerk API fetch failed:`, clerkErr.message);
        // Fallback user record
        localUser = await prisma.user.upsert({
          where: { id: userId },
          update: {},
          create: {
            id: userId,
            email: `temp-${userId}@codexis.local`,
            username: `user_${userId.substring(5, 12)}`,
          },
        });
      }
    }

    // Attach user auth metadata to request for controllers
    req.auth = {
      userId: localUser.id,
    };

    next();
  } catch (error) {
    console.error('[Clerk Auth Middleware] Token verification failed:', error.message);
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
};
