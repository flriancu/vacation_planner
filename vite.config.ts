import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Served from https://flriancu.github.io/vacation_planner/ (NF-1).
  base: '/vacation_planner/',
  plugins: [react()],
  test: {
    // Playwright specs live in tests/e2e; private/ exists only on the owner's machine (NF-7).
    include: ['tests/unit/**/*.test.ts', 'private/**/*.test.ts'],
  },
});
