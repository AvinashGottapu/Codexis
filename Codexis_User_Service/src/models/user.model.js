import { prisma } from '../config/db.js';

/**
 * Creates or updates a user profile synced from Clerk
 */
export const upsertUser = async ({ id, email, username, imageUrl }) => {
  return await prisma.user.upsert({
    where: { id },
    update: {
      email,
      username,
      imageUrl,
    },
    create: {
      id,
      email,
      username,
      imageUrl,
    },
  });
};


/**
 * Delete a user from our database
 */
export const deleteUser = async (id) => {
  try {
    return await prisma.user.delete({
      where: { id },
    });
  } catch (err) {
    // If user already deleted or doesn't exist, ignore
    console.warn(`[User Model] User ${id} already deleted:`, err.message);
    return null;
  }
};
