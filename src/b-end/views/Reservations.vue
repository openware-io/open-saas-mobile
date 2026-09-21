<template>
  <div class="view reservations-view">
    <section class="view-heading">
      <div><span class="eyebrow">RESERVATIONS</span><h1>预约管理</h1><p>{{ priceText || '提前安排资源，减少客户等待' }}</p></div>
    </section>

    <div class="filter-strip" aria-label="预约筛选">
      <button v-for="option in filterOptions" :key="option.value" class="filter-chip" :class="{ active: activeFilter === option.value }" @click="activeFilter = option.value">
        {{ option.label }}<span>{{ option.count }}</span>
      </button>
    </div>

    <div v-if="error" class="notice error-notice">{{ error }}</div>
    <div v-if="loading" class="card-list" aria-label="预约加载中">
      <div v-for="n in 3" :key="n" class="card reservation-card skeleton-card"><i class="skeleton reservation-picture"></i><div><i class="skeleton line-lg"></i><i class="skeleton line-sm"></i></div></div>
    </div>
    <div v-else-if="!filteredRows.length" class="empty-state"><span class="empty-icon">⌁</span><strong>暂无相关预约</strong><p>新的客户预约会显示在这里</p></div>

    <div v-else class="card-list">
      <article v-for="reservation in visibleRows" :key="reservation.id" class="card reservation-card">
        <div class="reservation-image">
          <img :src="reservationImage(reservation)" alt="KTV 环境" @error="useFallbackImage" />
          <span>KTV 预约</span>
        </div>
        <div class="reservation-body">
          <header class="reservation-head">
            <div><h2>{{ storeName }}</h2><p>预约号 {{ reservation.reservationNo || '#' + reservation.id }}</p></div>
            <span class="status-tag" :data-tone="statusType(RESERVATION_STATUS, reservation.status)"><i></i>{{ statusText(RESERVATION_STATUS, reservation.status) }}</span>
          </header>
          <div class="reservation-info">
            <div><small>预约时间</small><strong>{{ fmtTime(reservation.startAt) }}</strong></div>
            <div><small>预约房型</small><strong>{{ roomTypeLabel(reservation) }}<template v-if="priceShort"> · {{ priceShort }}</template></strong></div>
            <div><small>包厢</small><strong>{{ roomAssignLabel(reservation) }}</strong></div>
            <div><small>到店人数</small><strong>{{ reservation.partySize || '—' }} 人</strong></div>
            <div><small>联系人</small><strong>{{ reservation.contact || '—' }}</strong></div>
          </div>
          <div v-if="['PENDING', 'CONFIRMED', 'ARRIVED'].includes(reservation.status)" class="reservation-actions">
            <button v-if="['PENDING', 'CONFIRMED'].includes(reservation.status)" class="btn sm ghost" @click="cancel(reservation)">取消</button>
            <button v-if="canMarkNoShow(reservation)" class="btn sm ghost" @click="noShow(reservation)">未到店</button>
            <button v-if="reservation.status === 'PENDING'" class="btn sm dark" @click="confirm(reservation)">确认预约</button>
            <button v-if="reservation.status === 'CONFIRMED' && !roomAssigned(reservation)" class="btn sm success" @click="arrival(reservation)">确认到店</button>
            <button v-if="canOpenTable(reservation)" class="btn sm dark" @click="openTable(reservation)">立即开台</button>
          </div>
        </div>
      </article>
    </div>

    <div v-if="!loading && filteredRows.length" ref="loadMoreTarget" class="load-more" aria-live="polite">
      <button v-if="hasMore" type="button" @click="loadMore"><i>↑</i>继续上拉加载更多预约</button>
      <span v-else>— 已显示全部 {{ filteredRows.length }} 条预约 —</span>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { listKtvRooms, listReservations, confirmReservation, arrivalReservation, cancelReservation, noShowReservation, openTable as openTableReservation, getKtvPricing } from '@/shared/api/saas'
import { RESERVATION_STATUS, statusText, statusType } from '@/shared/utils/status'
import { formatMoney, fmtTime } from '@/shared/utils/amount'

const PAGE_SIZE = 3
const ktvImages = [
  new URL('../../../c-end/assets/images/ktv-1.png', import.meta.url).href,
  new URL('../../../c-end/assets/images/ktv-2.png', import.meta.url).href,
  new URL('../../../c-end/assets/images/ktv-3.png', import.meta.url).href,
  new URL('../../../c-end/assets/images/ktv-4.png', import.meta.url).href,
]
const activeContext = inject('activeContext', ref(null))
const rows = ref([])
const rooms = ref([])
const loading = ref(false)
const error = ref('')
const activeFilter = ref('ALL')
const visibleCount = ref(PAGE_SIZE)
const loadMoreTarget = ref(null)
let observer

const storeName = computed(() => activeContext.value?.storeName || activeContext.value?.organizationName || 'A380 KTV 门店')
/** 包厢价格（与后台「计价方案」同源），预约卡片展示，运营对客报价用。 */
const ktvPricing = ref(null)
/** 计费单位展示名，与后端 billingUnit 枚举同一口径。 */
function billingUnitLabel(unit) {
  return unit === 'HALF_HOUR' ? '半小时' : unit === 'PACKAGE' ? '套餐' : '小时'
}
/** 生效合计单价（最小货币单位）：优先 combinedUnitPrice（房型 + 服务），缺失时退回房型价。 */
function combinedUnitPrice(pricing) {
  const combined = Number(pricing?.combinedUnitPrice || 0)
  return combined > 0 ? combined : Number(pricing?.roomUnitPrice || 0)
}
/**
 * 价格文案一律本地按**当前币种**渲染结构化单价，不使用后端 displayText：
 * displayText 是后端按当时币种拼好的成串文案，直出会让同一页出现两种符号，切币种也不会跟着变。
 */
const priceShort = computed(() => {
  const pricing = ktvPricing.value
  const combined = combinedUnitPrice(pricing)
  if (!(combined > 0)) return ''
  const text = formatMoney(combined) + '/' + billingUnitLabel(pricing.billingUnit)
  return pricing.roomTypePriceApplied === false ? text + ' · 门店统一价' : text
})
const priceText = computed(() => {
  const pricing = ktvPricing.value
  if (!pricing) return ''
  const room = Number(pricing.roomUnitPrice || 0)
  const server = Number(pricing.serverUnitPrice || 0)
  const combined = combinedUnitPrice(pricing)
  if (!(room > 0) || !(server > 0) || !(combined > 0)) return priceShort.value
  const unit = '/' + billingUnitLabel(pricing.billingUnit)
  return `房型 ${formatMoney(room)}${unit} + 服务 ${formatMoney(server)}${unit} = ${formatMoney(combined)}${unit}（含 1 名服务人员）`
})
const filterOptions = computed(() => [
  { value: 'ALL', label: '全部', count: rows.value.length },
  { value: 'PENDING', label: '待确认', count: rows.value.filter((row) => row.status === 'PENDING').length },
  { value: 'CONFIRMED', label: '待到店', count: rows.value.filter((row) => row.status === 'CONFIRMED').length },
  { value: 'ARRIVED', label: '已到店', count: rows.value.filter((row) => row.status === 'ARRIVED').length },
])
const filteredRows = computed(() => activeFilter.value === 'ALL' ? rows.value : rows.value.filter((row) => row.status === activeFilter.value))
const visibleRows = computed(() => filteredRows.value.slice(0, visibleCount.value))
const hasMore = computed(() => visibleCount.value < filteredRows.value.length)

watch(activeFilter, () => { visibleCount.value = PAGE_SIZE })
watch(loadMoreTarget, setupObserver)

function unwrapList(data) { return Array.isArray(data) ? data : (data?.items || data?.list || data?.rows || data?.records || []) }
function reasonOf(errorValue) { return errorValue?.friendlyMessage || errorValue?.message || '未知错误' }
function reservationImage(reservation) { return ktvImages[Math.abs(Number(reservation.resourceId || reservation.id || 0)) % ktvImages.length] }
function useFallbackImage(event) { event.currentTarget.src = ktvImages[0] }
/** 历史行的旧包厢名（迁移前预约的就是具体包厢，或到店后已分配包厢）。 */
function legacyRoomName(reservation) {
  const room = rooms.value.find((item) => String(item.id) === String(reservation.resourceId))
  return room?.name || room?.resourceCode || (reservation.resourceId ? `包厢 #${reservation.resourceId}` : '')
}
/**
 * 预约按房型（包厢类型）创建：优先 roomTypeName（回退 roomTypeCode）；
 * 历史行只有 resourceId / resourceName，显示旧包厢名并标注「历史预约」——与 C 端口径一致。
 */
function roomTypeLabel(reservation) {
  const typeName = reservation.roomTypeName || reservation.roomTypeCode
  if (typeName) return typeName
  const legacy = reservation.resourceName || legacyRoomName(reservation)
  return legacy ? `${legacy}（历史预约）` : '待分配包厢类型'
}
/** 包厢列：具体包厢到店后由门店分配；只有到店分配（resourceId 有值）后才显示包厢名。 */
function roomAssignLabel(reservation) {
  const assigned = reservation.resourceName || legacyRoomName(reservation)
  return assigned ? `已分配 ${assigned}` : '到店后分配'
}
/** 预约是否已落到具体包厢（resourceId 有值）：开台前置条件，也决定「确认到店」是否还需要单独点。 */
function roomAssigned(reservation) {
  return reservation?.resourceId !== null && reservation.resourceId !== undefined && reservation.resourceId !== ''
}
/**
 * 是否显示「立即开台」：已到店（ARRIVED），或已确认且已分配包厢（CONFIRMED）。
 * 后端 open-table 对 CONFIRMED 会隐含登记到店时间，因此「客人到了、房间也留好了」一次点击即可。
 */
function canOpenTable(reservation) {
  const status = reservation?.status
  if (status === 'ARRIVED') return true
  return status === 'CONFIRMED' && roomAssigned(reservation)
}
/** 已过预约开始时间仍未到店：允许门店标记「未到店」（后端未到点会 409 RESERVATION_NOT_STARTED）。 */
function canMarkNoShow(reservation) {
  const status = reservation?.status
  if (status !== 'PENDING' && status !== 'CONFIRMED') return false
  if (reservation?.orderId) return false
  const startAt = reservation?.startAt ? new Date(reservation.startAt).getTime() : NaN
  return !Number.isNaN(startAt) && startAt <= Date.now()
}
function setupObserver() {
  observer?.disconnect()
  if (!loadMoreTarget.value || typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) loadMore() }, { rootMargin: '180px 0px' })
  observer.observe(loadMoreTarget.value)
}
function loadMore() { if (hasMore.value) visibleCount.value = Math.min(visibleCount.value + PAGE_SIZE, filteredRows.value.length) }
async function load() {
  loading.value = true; error.value = ''
  try {
    const [reservationData, roomData] = await Promise.all([
      listReservations(),
      listKtvRooms().catch(() => []),
      getKtvPricing().then((pricing) => { ktvPricing.value = pricing }).catch(() => { ktvPricing.value = null }),
    ])
    rows.value = unwrapList(reservationData)
    rooms.value = unwrapList(roomData)
    visibleCount.value = PAGE_SIZE
  } catch (loadError) { rows.value = []; error.value = '加载预约失败：' + reasonOf(loadError) }
  finally { loading.value = false }
}
async function run(action) { error.value = ''; try { await action(); await load() } catch (actionError) { error.value = reasonOf(actionError) } }
function confirm(reservation) { return run(() => confirmReservation(reservation.id, reservation.version ?? 0)) }
function arrival(reservation) { return run(() => arrivalReservation(reservation.id)) }
async function cancel(reservation) { const reason = prompt('取消原因（选填）'); return run(() => cancelReservation(reservation.id, reason || null)) }
function openTable(reservation) { return run(() => openTableReservation(reservation.id, 0)) }
async function noShow(reservation) {
  // 用 window.confirm：本文件的 confirm() 是「确认预约」动作，不要被同名函数遮蔽。
  if (!window.confirm('确认客户未到店？该预约将标记为「未到店」。')) return
  return run(() => noShowReservation(reservation.id))
}

onMounted(load)
onBeforeUnmount(() => observer?.disconnect())
</script>
