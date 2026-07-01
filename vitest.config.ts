import { defineConfig } from 'vitest/config';

// Analytics/unit tests only. These run OUTSIDE the Next build (test files are
// excluded from tsconfig) so adding Vitest never affects the production bundle.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
});
