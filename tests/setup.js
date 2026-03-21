import { vi } from "vitest";

// Minimal Chrome API mock for unit tests
globalThis.chrome = {
  storage: {
    local: {
      get: vi.fn((_keys, cb) => { if (cb) cb({}); return Promise.resolve({}); }),
      set: vi.fn((_data, cb) => { if (cb) cb(); }),
    },
    onChanged: { addListener: vi.fn() },
  },
  runtime: {
    id: "test-extension-id",
    sendMessage: vi.fn(),
    getManifest: vi.fn(() => ({ version: "2.3" })),
  },
  action: {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
  },
};
