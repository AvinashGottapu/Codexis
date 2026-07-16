import { prisma } from './config/db.js';
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

const redisClient = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
});

const mockUsers = [
  { id: 'mock_user_1', username: 'AlgoWizard', points: 180, avatar: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=AlgoWizard' },
  { id: 'mock_user_2', username: 'ByteNinja', points: 150, avatar: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=ByteNinja' },
  { id: 'mock_user_3', username: 'DockerKing', points: 130, avatar: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=DockerKing' },
  { id: 'mock_user_4', username: 'StackMaster', points: 110, avatar: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=StackMaster' },
  { id: 'mock_user_5', username: 'CompilerChief', points: 90, avatar: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=CompilerChief' },
  { id: 'mock_user_6', username: 'QueueCommander', points: 80, avatar: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=QueueCommander' },
  { id: 'mock_user_7', username: 'CacheQueen', points: 70, avatar: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=CacheQueen' },
  { id: 'mock_user_8', username: 'DbDrifter', points: 60, avatar: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=DbDrifter' },
  { id: 'mock_user_9', username: 'KernelGuru', points: 50, avatar: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=KernelGuru' },
  { id: 'mock_user_10', username: 'LogicLinker', points: 40, avatar: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=LogicLinker' },
  { id: 'mock_user_11', username: 'BugBuster', points: 30, avatar: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=BugBuster' },
  { id: 'mock_user_12', username: 'LoopLegend', points: 20, avatar: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=LoopLegend' },
  { id: 'mock_user_13', username: 'ArrayAce', points: 15, avatar: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=ArrayAce' },
  { id: 'mock_user_14', username: 'PointerPro', points: 10, avatar: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=PointerPro' },
  { id: 'mock_user_15', username: 'BitShifter', points: 10, avatar: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=BitShifter' }
];

async function seed() {
  console.log('--- 🚀 STARTING LEADERBOARD SYNC SEEDING ---');
  try {
    // 1. Delete existing mock users from PostgreSQL and Redis (to allow re-running clean)
    const existingMocks = await prisma.user.findMany({
      where: { email: { endsWith: '@codexis-mock.com' } },
      select: { id: true }
    });

    const mockIds = existingMocks.map(u => u.id);
    if (mockIds.length > 0) {
      console.log(`[Clean] Removing ${mockIds.length} existing mock users from PostgreSQL...`);
      await prisma.user.deleteMany({
        where: { id: { in: mockIds } }
      });

      console.log(`[Clean] Removing existing mock users from Redis Leaderboard...`);
      await redisClient.zrem('leaderboard:global', ...mockIds);
    }

    // 2. Create the mock users inside PostgreSQL and Redis ZSET
    console.log('[Seed] Seeding 15 mock competitive programmers...');
    for (const mock of mockUsers) {
      // Create user in PostgreSQL
      await prisma.user.create({
        data: {
          id: mock.id,
          username: mock.username,
          email: `${mock.username.toLowerCase()}@codexis-mock.com`,
          imageUrl: mock.avatar,
          points: mock.points
        }
      });

      // Insert points into Redis Sorted Set (ZSET)
      await redisClient.zadd('leaderboard:global', mock.points, mock.id);
    }

    console.log('[Seed] Seeding completed successfully!');

    // 3. Print the top of the Redis leaderboard to verify
    const topLeaderboard = await redisClient.zrevrange('leaderboard:global', 0, 4, 'WITHSCORES');
    console.log('\n--- 🏆 TOP 5 LEADERBOARD IN REDIS ---');
    for (let i = 0; i < topLeaderboard.length; i += 2) {
      const rank = Math.floor(i / 2) + 1;
      const userId = topLeaderboard[i];
      const score = topLeaderboard[i + 1];
      console.log(`${rank}. User: ${userId} -> Score: ${score} pts`);
    }

  } catch (error) {
    console.error('CRITICAL SEED ERROR:', error);
  } finally {
    // Safely disconnect
    await prisma.$disconnect();
    redisClient.quit();
    console.log('\n[Disconnect] Database and Redis connections closed.');
    console.log('--- 🎉 SEEDING PROCESS FINISHED ---');
  }
}

seed();
