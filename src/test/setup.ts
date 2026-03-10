import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}

let store: Record<string, string> = {}
const storage = {
  getItem: (key: string) => (key in store ? store[key]! : null),
  setItem: (key: string, value: string) => {
    store[key] = value
  },
  removeItem: (key: string) => {
    delete store[key]
  },
  clear: () => {
    store = {}
  },
  key: (index: number) => Object.keys(store)[index] ?? null,
  get length() {
    return Object.keys(store).length
  },
}

Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: storage,
})
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: storage,
})

afterEach(() => {
  cleanup()
  storage.clear()
})
