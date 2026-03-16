import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock crypto.randomUUID
if (!window.crypto) {
  (window as any).crypto = {};
}
if (!window.crypto.randomUUID) {
  (window.crypto as any).randomUUID = () => Math.random().toString(36).substring(2);
}

// Mock fetch
window.fetch = vi.fn();
