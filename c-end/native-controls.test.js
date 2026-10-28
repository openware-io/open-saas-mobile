import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

test('C 端表单不使用 Android 原生日期/时间/下拉/确认框', async () => {
  for (const file of ['./app.js', './hotel-real.js']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    expect(source).not.toMatch(/<select\b/)
    expect(source).not.toMatch(/type="(date|time|datetime-local|month|week)"/)
    expect(source).not.toMatch(/window\.(confirm|alert|prompt)\s*\(/)
  }
})
