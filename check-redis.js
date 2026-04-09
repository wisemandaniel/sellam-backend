const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);

async function check() {
  await redis.set('test', 'ok');
  const value = await redis.get('test');
  console.log('Redis test:', value === 'ok' ? '✅ working' : '❌ failed');
  process.exit(0);
}
check().catch(err => { console.error('Redis error:', err.message); process.exit(1); });