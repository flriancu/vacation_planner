import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Served from https://concediu.fei.ro/ (NF-1, DESIGN 5.4). Relative asset paths, so the same
  // build also works under a sub-path such as flriancu.github.io/vacation_planner/.
  base: './',
  plugins: [react()],
  test: {
    // Playwright specs live in tests/e2e; private/ exists only on the owner's machine (NF-7).
    include: ['tests/unit/**/*.test.ts', 'private/**/*.test.ts'],
  },
});
