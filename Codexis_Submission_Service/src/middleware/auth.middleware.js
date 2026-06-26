import { verifyToken, createClerkClient } from '@clerk/backend';
import { prisma } from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const clerkClient = createClerkClient({ secretKey: CLERK_SECRET_KEY });

/**
 * Fastify preHandler hook to authenticate requests using Clerk JWT Session Tokens
 */
export const authenticate = async (request, reply) => {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Authentication token required (Bearer)' });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify the JWT token cryptographically (resolves JWKS automatically)
    const decoded = await verifyToken(token, {
      secretKey: CLERK_SECRET_KEY,
      clockSkewInMs: 30000, // 30 seconds buffer to prevent clock skew validation failures
    });

    const userId = decoded.sub;

    // Check if the user already exists in the local database
    let localUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!localUser) {
      console.log(`[Clerk Auth Middleware] User ${userId} not found in database. Auto-syncing from Clerk API...`);
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
        console.log(`[Clerk Auth Middleware] Auto-synced user ${userId} successfully.`);
      } catch (clerkErr) {
        console.error(`[Clerk Auth Middleware] Clerk API fetch failed:`, clerkErr.message);
        // Fallback: insert a shell user record so database query doesn't crash on foreign key constraint
        localUser = await prisma.user.upsert({
          where: { id: userId },
          update: {},
          create: {
            id: userId,
            email: `temp-${userId}@codexis.local`,
            username: `user_${userId.substring(5, 12)}`,
          },
        });
        console.log(`[Clerk Auth Middleware] Fallback user created locally for ID: ${userId}`);
      }
    }

    // Attach decoded user info to request object to maintain compatibility with existing controllers
    request.user = {
      userId: localUser.id,
    };
  } catch (error) {
    console.error('[Clerk Auth Middleware] Token Verification Failed:', error.message);
    return reply.status(401).send({ error: 'Invalid or expired authentication token' });
  }
};

