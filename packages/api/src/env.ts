export const env = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379'
};
