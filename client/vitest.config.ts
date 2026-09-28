import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

function mockPwaRegister(): Plugin {
  return {
    name: 'mock-pwa-register',
    resolveId(id) {
      if (id === 'virtual:pwa-register') return '\0virtual:pwa-register'
    },
    load(id) {
      if (id === '\0virtual:pwa-register') {
        return 'export const registerSW = () => () => {};'
      }
    },
  }
}

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
  plugins: [react(), mockPwaRegister()],
  optimizeDeps: {
    exclude: ['virtual:pwa-register'],
  },
  test: {
    silent: true,
    projects: [
      {
        // kmlUtils imports jsdom directly; jsdom's @exodus/bytes dep is
        // ESM-in-CJS and cannot load under vmThreads. Run in forks instead.
        plugins: [react(), mockPwaRegister()],
        test: {
          name: 'forks',
          ...sharedTest,
          pool: 'forks',
          include: ['src/utils/__tests__/kmlUtils.test.ts'],
        },
        resolve: { alias: sharedAlias },
      },
      {
        plugins: [react(), mockPwaRegister()],
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
