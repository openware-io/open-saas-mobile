<template>
  <div class="view hotel-view">
    <section class="view-heading">
      <div>
        <span class="eyebrow">HOTEL FRONT DESK</span>
        <h1>酒店前台</h1>
        <p>{{ hotelName }} · 今日到店、在住与待退房</p>
      </div>
    </section>

    <div v-if="error" class="notice error-notice">{{ error }}</div>
    <div v-if="loading" class="card-list">
      <div v-for="n in 3" :key="n" class="card reservation-card skeleton-card">
        <i class="skeleton line-lg"></i><i class="skeleton line-sm"></i>
      </div>
    </div>
    <div v-else-if="!tasks.length" class="empty-state">
      <span class="empty-icon">⌂</span>
      <strong>暂无前台任务</strong>
      <p>新预订和待入住客人会显示在这里</p>
    </div>

    <div v-else class="card-list">
      <article v-for="task in tasks" :key="task.id" class="card reservation-card hotel-card">
        <div class="reservation-body">
          <header class="reservation-head">
            <div>
              <h2>{{ task.guestName }}</h2>
              <p>{{ task.bookingNo }}</p>
            </div>
            <span class="status-tag" :data-tone="statusTone(task.status)"><i></i>{{ statusText(task.status) }}</span>
          </header>
          <div class="reservation-info">
            <div><small>房型</small><strong>{{ task.roomType || '—' }}</strong></div>
            <div><small>房号</small><strong>{{ task.roomNo || '待分配' }}</strong></div>
            <div><small>入住</small><strong>{{ task.checkInDate }}</strong></div>
            <div><small>离店</small><strong>{{ task.checkOutDate }}</strong></div>
          </div>
          <div class="reservation-actions">
            <button v-if="canCheckIn(task)" class="btn sm success" @click="checkIn(task)">办理入住</button>
            <button v-if="canCheckOut(task)" class="btn sm dark" @click="checkOut(task)">办理退房</button>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, onMounted, ref } from 'vue'
import { checkInHotelBooking, checkOutHotelBooking, listHotelFrontDeskTasks } from '@/shared/api/saas'

const activeContext = inject('activeContext', ref(null))
const tasks = ref([])
const loading = ref(false)
const error = ref('')

const hotelName = computed(() => activeContext.value?.storeName || '当前酒店')
const STATUS = {
  PENDING_DEPOSIT: '待付定金',
  CONFIRMED: '已确认',
  ARRIVAL: '待入住',
  IN_HOUSE: '在住',
  DUE_OUT: '待退房',
  CHECKED_OUT: '已退房',
  CANCELLED: '已取消',
  NO_SHOW: '未到店',
}
function statusText(status) { return STATUS[status] || `未知（${status}）` }
function statusTone(status) {
  if (status === 'IN_HOUSE' || status === 'CHECKED_OUT') return 'success'
  if (status === 'DUE_OUT' || status === 'ARRIVAL' || status === 'PENDING_DEPOSIT') return 'warning'
  return 'neutral'
}
function canCheckIn(task) { return ['CONFIRMED', 'ARRIVAL'].includes(task.status) }
function canCheckOut(task) { return task.hasStay !== false && ['IN_HOUSE', 'DUE_OUT'].includes(task.status) }

function unwrap(data) { return Array.isArray(data) ? data : (data?.items || []) }
function reasonOf(e) { return e?.friendlyMessage || e?.message || '操作失败' }

async function load() {
  loading.value = true
  error.value = ''
  try {
    tasks.value = unwrap(await listHotelFrontDeskTasks()).sort((a, b) => String(a.checkInDate).localeCompare(String(b.checkInDate)))
  } catch (e) {
    error.value = reasonOf(e)
  } finally {
    loading.value = false
  }
}

async function checkIn(task) {
  try {
    await checkInHotelBooking(task.id)
    await load()
  } catch (e) {
    error.value = reasonOf(e)
  }
}

async function checkOut(task) {
  try {
    await checkOutHotelBooking(task.id)
    await load()
  } catch (e) {
    error.value = reasonOf(e)
  }
}

onMounted(load)
</script>

<style scoped>
.hotel-view .hotel-card {
  grid-template-columns: minmax(0, 1fr);
  min-height: 0;
}
.hotel-view .hotel-card .reservation-head h2 {
  font-size: 15px;
}
.hotel-view .hotel-card .reservation-head p {
  font-size: 10px;
}
.hotel-view .hotel-card .reservation-info strong {
  font-size: 13px;
}
</style>
