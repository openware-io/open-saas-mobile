import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

test('C KTV create uses the consumer reservation endpoint', async () => {
  const source = await readFile(new URL('./saas.js', import.meta.url), 'utf8')
  const create = source.slice(source.indexOf('async createReservation'), source.indexOf('async getWallet'))
  expect(create).toContain("'/api/v1/me/reservations'")
  expect(create).not.toContain("'/api/v1/business/reservations'")
})
