import { defineConfig } from 'vitest/config';

/**
 * @module vitest.config
 * @description 单测配置。environment 固定为 node：core／render 层零宿主依赖，
 * ui 层的 DOM 依赖由 test/helpers/dom-stub.ts 的最小替身提供，不引 jsdom
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    reporters: ['default'],
  },
});
