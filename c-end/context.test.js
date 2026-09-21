import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { expect, test } from 'vitest'

test('only auto-selects a single tenant context', async () => {
  const source = await readFile(new URL('./context.js', import.meta.url), 'utf8')
  const window = {}
  vm.runInNewContext(source, { window })
  expect(window.A380Context.chooseSingle([{ contextId: 'one' }])).toEqual({ contextId: 'one' })
  expect(window.A380Context.chooseSingle([{ contextId: 'one' }, { contextId: 'two' }])).toBeNull()
})

test('C端加项页面 does not expose a free-form price input', async () => {
  const source = await readFile(new URL('./app.js', import.meta.url), 'utf8')
  expect(source).not.toContain('id="item-price"')
  expect(source).not.toContain('自定义加项')
})

test('KTV预约使用自定义选择面板而不是 Android 原生日期和下拉控件', async () => {
  const source = await readFile(new URL('./app.js', import.meta.url), 'utf8')
  const formSource = source.slice(source.indexOf('function renderKtvBookForm'), source.indexOf('function renderVenueReservationSuccess'))
  expect(formSource).toContain('bookingPickerRow')
  expect(formSource).not.toContain('type="date"')
  expect(formSource).not.toContain('<select')
})

test('KTV包厢列表在容纳人数下方显示接口返回的位置', async () => {
  const source = await readFile(new URL('./app.js', import.meta.url), 'utf8')
  const listSource = source.slice(source.indexOf('async function renderKtvBooking'), source.indexOf('function storeTimeAfter'))
  // 列表已改为「选择包厢类型」：卡片主对象是房型，位置按该房型包厢所在区域归并（见 saas.js attachKtvRoomTypeImages）。
  const capacityIndex = listSource.indexOf("roomType.capacity ? '可容纳")
  const areaIndex = listSource.indexOf('class="package-area"')

  expect(capacityIndex).toBeGreaterThan(-1)
  expect(areaIndex).toBeGreaterThan(capacityIndex)
  expect(listSource).toContain('escapeHtml(areaName)')
})

test('A380后台 presents A380 as tenant and KTV store as context, not a peer tab', async () => {
  const source = await readFile(new URL('../src/b-end/App.vue', import.meta.url), 'utf8')
  expect(source).toContain('A380后台')
  expect(source).toContain('A380租户')
  expect(source).not.toContain('to="/stores"')
})
