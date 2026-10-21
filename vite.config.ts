import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Served from https://concediu.floriniancu.ro/ (NF-1). Relative asset paths, so the same build
  // also works under a sub-path (the old flriancu.github.io/vacation_planner/ address).
  base: './',
  plugins: [react()],
  test: {
    // Playwright specs live in tests/e2e; private/ exists only on the owner's machine (NF-7).
    include: ['tests/unit/**/*.test.ts', 'private/**/*.test.ts'],
  },
});
