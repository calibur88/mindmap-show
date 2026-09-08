import { defineConfig } from 'vitest/config';

/**
 * @module vitest.config
 * @description core 层纯逻辑单测配置，environment 为 node 以保证零 DOM 依赖
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    reporters: ['default'],
  },
});
