<template>
  <div>
    <div v-if="loading" class="empty">加载中…</div>
    <div v-else-if="!rows.length" class="empty">暂无门店</div>
    <div v-for="s in rows" :key="s.id" class="card">
      <div class="card-row">{{ s.name || s.code }}</div>
      <!-- 币种不向用户展示裸 'CNY' 码：取 money.js 的 label（人民币 / 美元）；门店币种由租户币种写穿 -->
      <div class="card-sub">{{ s.businessType || '' }} · {{ currencyLabel(s.defaultCurrency || s.currencyCode) }} · {{ s.status || '' }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { listStores } from '@/shared/api/saas'
import { currencyLabel } from '@/shared/utils/amount'

const rows = ref([])
const loading = ref(false)
async function load() {
  loading.value = true
  try {
    const d = await listStores()
    rows.value = Array.isArray(d) ? d : []
  } catch (e) { rows.value = [] }
  finally { loading.value = false }
}
onMounted(load)
</script>
