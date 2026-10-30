import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

test('C availability API and default time are contract-driven', async () => {
  const saas = await readFile(new URL('./saas.js', import.meta.url), 'utf8')
  const app = await readFile(new URL('./app.js', import.meta.url), 'utf8')
  expect(saas).toContain("'/api/v1/me/reservations/availability?roomTypeId='")
  expect(app).toContain('async function loadKtvAvailability')
  expect(app).toContain('await loadKtvAvailability(roomTypeId, defaultDate, 3)')
  expect(app).toContain('原时段已满，已改选')
})
