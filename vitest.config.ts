import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { include: ['src/**/*.test.{ts,tsx}', 'shared/**/*.test.{ts,tsx}', 'server/**/*.test.{ts,tsx}'] },
})
