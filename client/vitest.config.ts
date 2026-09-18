import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

const sharedAlias = {
  '@shared': path.resolve(__dirname, '../shared'),
}

const sharedTest = {
  environment: 'jsdom' as const,
  globals: true,
  setupFiles: './src/test-setup.ts',
  css: false,
}

// All test files except the one that imports jsdom directly
const mainInclude = ['src/**/__tests__/**/*.{test,spec}.{ts,tsx}']

export default defineConfig({
  plugins: [react()],
  test: {
    silent: true,
    projects: [
      {
        // kmlUtils imports jsdom directly; jsdom's @exodus/bytes dep is
        // ESM-in-CJS and cannot load under vmThreads. Run in forks instead.
        plugins: [react()],
        test: {
          name: 'forks',
          ...sharedTest,
          pool: 'forks',
          include: ['src/utils/__tests__/kmlUtils.test.ts'],
        },
        resolve: { alias: sharedAlias },
      },
      {
        plugins: [react()],
        test: {
          name: 'vmThreads',
          ...sharedTest,
          pool: 'vmThreads',
          include: mainInclude,
          exclude: ['src/utils/__tests__/kmlUtils.test.ts'],
        },
        resolve: { alias: sharedAlias },
      },
    ],
  },
})
