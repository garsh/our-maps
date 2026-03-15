import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock crypto.randomUUID
if (!global.crypto) {
  (global as any).crypto = {};
}
if (!global.crypto.randomUUID) {
  (global.crypto as any).randomUUID = () => Math.random().toString(36).substring(2);
}

// Mock fetch
global.fetch = vi.fn();
