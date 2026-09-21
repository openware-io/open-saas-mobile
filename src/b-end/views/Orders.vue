<template>
  <div class="view orders-view">
    <section class="view-heading">
      <div>
        <span class="eyebrow">ORDER FULFILLMENT</span>
        <h1>订单管理</h1>
        <p>商品、数量与金额一目了然</p>
      </div>
      <button class="btn primary heading-action" @click="openCreate"><b>＋</b>开台 / 下单</button>
    </section>

    <div class="filter-strip" aria-label="订单筛选">
      <button v-for="option in filterOptions" :key="option.value" class="filter-chip" :class="{ active: activeFilter === option.value }" @click="activeFilter = option.value">
        {{ option.label }}<span>{{ option.count }}</span>
      </button>
    </div>

    <button v-if="pendingTotal > 0" class="pending-entry" @click="openPendingPanel">
      <span>待确认加项 ×{{ pendingTotal }}</span>
      <small>{{ pendingAmountLabel }}｜集中处理</small>
    </button>

    <div v-if="error" class="notice error-notice">{{ error }}</div>
    <div v-if="loading" class="card-list" aria-label="订单加载中">
      <div v-for="n in 3" :key="n" class="card order-card skeleton-card"><i class="skeleton line-lg"></i><i class="skeleton line-sm"></i><i class="skeleton block"></i></div>
    </div>
    <div v-else-if="!filteredRows.length" class="empty-state">
      <span class="empty-icon">⌁</span><strong>暂无相关订单</strong><p>新订单会在这里展示完整商品明细</p>
    </div>

    <div v-else class="card-list">
      <article v-for="order in visibleRows" :key="order.id" class="card order-card">
        <header class="order-card-head">
          <div><span class="micro-label">订单号</span><strong>{{ order.orderNo || '#' + order.id }}</strong></div>
          <span class="status-tag" :data-tone="statusType(ORDER_STATUS, order.status)"><i></i>{{ statusText(ORDER_STATUS, order.status) }}</span>
        </header>

        <div class="order-meta">
          <span class="meta-icon">♫</span>
          <div><strong>{{ orderScene(order) }}</strong><small>{{ orderSecondary(order) }}</small></div>
        </div>
        <p v-if="roomLine(order)" class="member-summary" style="margin:0 15px 10px">{{ roomLine(order) }}</p>
        <button v-if="pendingCountOf(order.id)" class="pending-badge" @click="openPendingOrder(order)">待确认加项 ×{{ pendingCountOf(order.id) }}</button>

        <section class="item-panel">
          <div class="item-panel-head"><span>消费明细</span><small v-if="!billLoading(order)">{{ itemSummary(order) }}</small></div>
          <div v-if="billLoading(order)" class="bill-loading"><i class="skeleton line-lg"></i><i class="skeleton line-sm"></i></div>
          <template v-else>
            <div v-if="orderBill(order).roomFeeAmount" class="product-row">
              <span class="product-index room">时</span>
              <div class="product-copy"><strong>{{ orderBill(order).roomFeeName }}</strong><small>{{ formatMoney(orderBill(order).roomFeeAmount) }} × 1</small></div>
              <b>{{ formatMoney(orderBill(order).roomFeeAmount) }}</b>
            </div>
            <div v-for="(item, index) in orderBill(order).items" :key="item.id || index" class="product-row">
              <span class="product-index">{{ index + 1 }}</span>
              <div class="product-copy"><strong>{{ itemName(item) }}</strong><small>{{ formatMoney(itemUnitPrice(item)) }} × {{ quantityText(itemQuantity(item)) }}</small></div>
              <b>{{ formatMoney(itemTotal(item)) }}</b>
            </div>
            <div v-if="!orderBill(order).roomFeeAmount && !orderBill(order).items.length" class="no-items"><span>暂无商品明细</span><small>加项后自动展示商品、数量和价格</small></div>
          </template>
          <footer class="order-total"><span>订单合计</span><strong>{{ formatMoney(orderBill(order).totalAmount) }}</strong></footer>
          <p v-if="orderBill(order).paidAmount > 0" class="member-summary" style="margin:0;padding:0 12px 10px">
            已收 现金 {{ formatMoney(orderBill(order).collected.cash) }} · {{ walletBrand }} {{ formatTokens(orderBill(order).collected.walletTokens) }} · {{ formatPoints(orderBill(order).collected.points) }}
            <template v-if="orderBill(order).payableAmount > 0"> · 应收 {{ formatMoney(orderBill(order).payableAmount) }}</template>
          </p>
        </section>

        <div v-if="actionable(order)" class="card-actions">
          <button v-if="order.status === 'DRAFT'" class="btn sm primary" @click="confirm(order)">确认订单</button>
          <button v-if="order.status === 'SERVING'" class="btn sm dark" @click="openDetail(order)">继续点单</button>
          <button v-if="order.status === 'WAITING_SETTLEMENT'" class="btn sm primary" @click="settle(order)">确认结算</button>
          <button v-if="order.status === 'WAITING_PAYMENT'" class="btn sm primary" @click="openCollect(order)">立即收银</button>
        </div>
      </article>
    </div>

    <div v-if="!loading && filteredRows.length" ref="loadMoreTarget" class="load-more" aria-live="polite">
      <button v-if="hasMore" type="button" @click="loadMore"><i>↑</i>继续上拉加载更多订单</button>
      <span v-else>— 已显示全部 {{ filteredRows.length }} 笔订单 —</span>
    </div>

    <div v-if="createVisible" class="mask" @click.self="createVisible = false">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title"><span>开台 / 下单</span><button class="sheet-close" @click="createVisible = false">×</button></div>
        <label class="field">选择包厢<select v-model="createForm.resourceId"><option disabled value="">请选择可用包厢</option><option v-for="room in rooms" :key="room.id" :value="room.id" :disabled="room.available === false">{{ room.name || room.resourceCode }}{{ room.available === false ? '（' + (room.unavailableReason || '不可用') + '）' : '' }}</option></select></label>
        <div v-if="rooms.length" class="room-board">
          <div class="pending-title"><span>房态看板</span><small>空闲可开台 · 清洁中 / 使用中不可开台</small></div>
          <div class="room-board-list">
            <article v-for="room in rooms" :key="room.id" class="room-board-card" :class="{ 'room-board-card-busy': room.available === false }">
              <img
                v-if="roomThumb(room)"
                class="room-thumb"
                :src="roomThumb(room)"
                :alt="room.name || room.resourceCode"
                loading="lazy"
                @error="markRoomImageFailed(room)"
              />
              <span v-else class="room-thumb room-thumb-empty" aria-hidden="true">🎤</span>
              <div class="room-board-copy">
                <strong>{{ room.name || room.resourceCode }}</strong>
                <span class="room-state" :data-tone="roomStateTone(room)"><i></i>{{ roomStateText(room) }}</span>
              </div>
              <button v-if="room.state === 'CLEANING'" class="btn sm success" @click="markRoomCleaned(room)">清洁完成</button>
            </article>
          </div>
        </div>
        <div class="sheet-actions"><button class="btn ghost" @click="createVisible = false">取消</button><button class="btn primary" :disabled="creating" @click="submitCreate">{{ creating ? '开台中…' : '确认开台' }}</button></div>
      </div>
    </div>

    <div v-if="collectVisible" class="mask" @click.self="collectVisible = false">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title"><span>收银 · {{ collectOrder?.orderNo || '#' + collectOrder?.id }}</span><button class="sheet-close" @click="collectVisible = false">×</button></div>
        <div class="collect-payable">
          <div><span>应收</span><small>账单合计 {{ formatMoney(numberOf(collectOrder?.totalAmount)) }} − 已收 {{ formatMoney(numberOf(collectOrder?.paidAmount)) }}</small></div>
          <strong>{{ formatMoney(payableMinor) }}</strong>
        </div>
        <p v-if="collectPendingHint" class="pending-notice">{{ collectPendingHint }}</p>
        <div v-if="collectError" class="notice error-notice">{{ collectError }}</div>
        <p v-if="methodsLoading" class="collect-hint">支付方式加载中…</p>
        <p v-else-if="!allowedMethods.length" class="collect-hint">当前商户没有已开通的支付方式，请先在后台「支付方式」中授权。</p>
        <template v-else>
          <div v-if="memberSelectable" class="member-panel">
            <div class="pending-title"><span>客户</span><small>积分 / {{ walletBrand }} 抵扣需先指定客户</small></div>
            <label class="field">手机号 / 客户号<input v-model="memberKeyword" placeholder="手机号或客户号，回车查询" @keyup.enter="searchMembers" /></label>
            <div class="member-pills">
              <button class="btn sm ghost" :disabled="searchingMembers" @click="searchMembers">{{ searchingMembers ? '查询中…' : '查询会员' }}</button>
              <button v-for="member in memberResults" :key="member.id" class="btn sm" :class="{ primary: selectedMember && selectedMember.id === member.id }" @click="pickMember(member)">{{ member.name || member.phone || member.memberNo }}</button>
            </div>
            <p v-if="selectedMember" class="member-summary">
              已选 {{ selectedMember.name || selectedMember.phone }} · {{ walletBrand }} {{ formatTokens(memberWalletTokens) }} · {{ formatPoints(memberPoints) }}
            </p>
          </div>
          <div class="split-panel">
            <div class="pending-title"><span>支付拆分</span><small>抵扣顺序 {{ POINT_UNIT }} → {{ walletBrand }} → 现金</small></div>
            <label v-for="method in orderedMethods" :key="method.method" class="field">
              {{ methodLabel(method.method) }}<template v-if="!isTokenMethod(method.method)">（{{ currencyLabel() }}）</template>
              <small v-if="tokenAvailableText(method.method)" class="pay-available">可用 {{ tokenAvailableText(method.method) }}</small>
              <input
                type="number"
                min="0"
                :step="legInputStep(method.method)"
                :inputmode="isTokenMethod(method.method) ? 'numeric' : 'decimal'"
                :placeholder="isTokenMethod(method.method) ? '0' : '0.00'"
                v-model="payByLeg[method.method]"
                @change="clampLeg(method.method)"
              />
              <small v-if="isTokenMethod(method.method)" class="pay-available">按数量填写，不带货币符号与单位</small>
            </label>
            <p class="member-summary">
              已填合计 {{ formatMoney(filledMinor) }} · 剩余 {{ formatMoney(remainingMinor) }}
              <template v-if="filledMinor !== payableMinor">（须等于应收，可点「自动抵扣」）</template>
            </p>
            <p class="member-summary">
              合计是金额口径：{{ walletBrand }} / 积分按数量填写，折算后的金额参与「合计 = 应收」校验；
              其中现金类分腿合计 {{ formatMoney(cashLegsMinor) }}（不含 {{ walletBrand }} / 积分数量）
            </p>
            <div class="member-pills">
              <button class="btn sm ghost" @click="autoFill">自动抵扣</button>
              <button class="btn sm ghost" @click="clearLegs">清零</button>
            </div>
          </div>
        </template>
        <div class="sheet-actions"><button class="btn ghost" @click="collectVisible = false">取消</button><button class="btn primary" :disabled="collecting || !allowedMethods.length" @click="submitCollect">{{ collecting ? '收款中…' : '确认收款' }}</button></div>
      </div>
    </div>

    <div v-if="pendingPanelVisible" class="mask" @click.self="closePendingPanel">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title"><span>待确认加项 · 集中处理</span><button class="sheet-close" @click="closePendingPanel">×</button></div>
        <p class="pending-summary">本门店待确认 {{ pendingTotal }} 条 · {{ pendingAmountLabel }}（客户自助加项，确认后计入应收）</p>
        <p v-if="pendingNotice" class="pending-notice">{{ pendingNotice }}</p>
        <div v-for="group in pendingOrders" :key="group.orderId" class="pending-panel">
          <!--
            包厢是第一识别信息（门店必须先看清是「哪间包厢」的需求），订单号退成次要定位；
            服务端 roomName 已按「会话名称 → 编码 → 资源回源」给全，仍缺失时由 pendingRoomLabel 兜底。
          -->
          <div class="pending-title">
            <span>包厢 {{ pendingRoomLabel(group) }}</span>
            <small>{{ group.orderNo || '#' + group.orderId }} · 待确认 ×{{ pendingGroupCount(group) }}</small>
          </div>
          <div v-for="item in group.items || []" :key="item.id" class="pending-row">
            <div><strong>{{ pendingItemName(item) }}</strong><small>× {{ quantityText(pendingItemQuantity(item)) }} · {{ formatMoney(pendingItemAmount(item), pendingItemCurrency(item)) }}</small></div>
            <span><button class="btn sm success" :disabled="pendingBusy" @click="confirmGroupItem(group, item)">确认</button><button class="btn sm danger" :disabled="pendingBusy" @click="rejectGroupItem(group, item)">拒绝</button></span>
          </div>
          <div class="pending-group-actions"><button class="btn sm primary" :disabled="pendingBusy" @click="confirmWholeOrder(group)">本单全部确认</button></div>
        </div>
        <div v-if="!pendingOrders.length" class="no-items"><span>暂无待确认加项</span><small>客户自助加项后会出现在这里</small></div>
        <div class="sheet-actions"><button class="btn ghost" @click="closePendingPanel">关闭</button><button class="btn ghost" :disabled="pendingRefreshing" @click="refreshPendingView(true)">{{ pendingRefreshing ? '刷新中…' : '刷新' }}</button></div>
      </div>
    </div>

    <div v-if="detailVisible" class="mask" @click.self="detailVisible = false">
      <div class="sheet detail-sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title"><span>订单操作 · {{ detailOrder?.orderNo || '#' + detailOrder?.id }}</span><button class="sheet-close" @click="detailVisible = false">×</button></div>
        <div class="detail-status"><span>{{ statusText(ORDER_STATUS, detailOrder?.status) }}</span><small>包厢：{{ detailSession?.status === 'OPEN' ? '计时中' : (detailSession?.status || '—') }}</small></div>
        <!-- 轻提示（409 / 并发下已被别人处理）放在待确认区之外：该区可能因处理完而收起，提示仍需可见 -->
        <p v-if="pendingNotice" class="pending-notice">{{ pendingNotice }}</p>
        <div class="item-panel detail-bill">
          <div v-if="detailBill?.roomFee?.amount" class="product-row"><span class="product-index room">时</span><div class="product-copy"><strong>{{ detailBill.roomFee.name || '包厢费' }}</strong><small>计时消费</small></div><b>{{ formatMoney(detailBill.roomFee.amount) }}</b></div>
          <div v-for="(item, index) in (detailBill?.items || [])" :key="item.id || index" class="product-row"><span class="product-index">{{ index + 1 }}</span><div class="product-copy"><strong>{{ itemName(item) }}</strong><small>{{ formatMoney(itemUnitPrice(item)) }} × {{ quantityText(itemQuantity(item)) }}</small></div><b>{{ formatMoney(itemTotal(item)) }}</b></div>
          <div v-if="!detailBill?.roomFee?.amount && !(detailBill?.items || []).length" class="no-items"><span>暂无明细</span><small>加项后自动汇总</small></div>
          <footer class="order-total"><span>合计</span><strong>{{ formatMoney(detailBill?.totalAmount || 0) }}</strong></footer>
        </div>
        <div v-if="pendingItems.length" ref="pendingPanelTarget" class="pending-panel">
          <div class="pending-title"><span>待确认加项 · 包厢 {{ detailRoomLabel }}</span><small>客户自助提交 · 确认后计入应收</small></div>
          <div v-for="item in pendingItems" :key="item.id" class="pending-row"><div><strong>{{ pendingItemName(item) }}</strong><small>× {{ quantityText(pendingItemQuantity(item)) }} · {{ formatMoney(pendingItemAmount(item), pendingItemCurrency(item)) }}</small></div><span><button class="btn sm success" @click="confirmPending(item)">确认</button><button class="btn sm danger" @click="rejectPending(item)">拒绝</button></span></div>
        </div>
        <template v-if="detailOrder?.status === 'SERVING'">
          <div class="catalog-picker-head"><span>选择加项</span><small>有图看缩略图，售罄/未上架置灰不可点</small></div>
          <div v-if="catalogItems.length" class="catalog-picker" role="listbox" aria-label="选择加项">
            <button v-for="item in catalogItems" :key="item.id" type="button" class="catalog-option"
                    :class="{ active: isPicked(item), off: item.available === false }"
                    :disabled="item.available === false || adding"
                    role="option" :aria-selected="isPicked(item)"
                    @click="pickCatalogItem(item)">
              <img v-if="itemThumb(item)" class="catalog-thumb" :src="itemThumb(item)" :alt="item.name" loading="lazy" @error="markImageFailed(item)" />
              <span v-else class="catalog-thumb catalog-thumb-empty" aria-hidden="true">🧾</span>
              <span class="catalog-option-copy">
                <strong>{{ item.name }}</strong>
                <small>{{ formatMoney(item.unitPrice) }}/{{ item.unit || '份' }}</small>
                <small v-if="item.available === false" class="catalog-off-reason">{{ item.unavailableReason || '不可点' }}</small>
              </span>
            </button>
          </div>
          <p v-else class="member-summary">目录加载中或暂无可点商品/服务</p>
          <div v-if="selectedCatalogItem" class="catalog-selected">
            <img v-if="itemThumb(selectedCatalogItem)" class="catalog-thumb" :src="itemThumb(selectedCatalogItem)" :alt="selectedCatalogItem.name" @error="markImageFailed(selectedCatalogItem)" />
            <span v-else class="catalog-thumb catalog-thumb-empty" aria-hidden="true">🧾</span>
            <div>
              <strong>{{ selectedCatalogItem.name }}</strong>
              <small>{{ formatMoney(selectedCatalogItem.unitPrice) }}/{{ selectedCatalogItem.unit || '份' }} × {{ quantityText(numberOf(itemForm.quantity, 0)) }}</small>
              <!-- 可用库存来自服务端：先在选择阶段提示并限制数量，避免提交时才被库存不足驳回 -->
              <small v-if="selectedStockLimit != null" class="catalog-stock-hint">库存 {{ quantityText(selectedStockLimit) }}</small>
            </div>
          </div>
          <label class="field">数量<input type="number" v-model="itemForm.quantity" min="0.1" step="0.1" :max="selectedStockLimit != null ? selectedStockLimit : undefined" /></label>
          <div class="sheet-actions"><button class="btn primary" :disabled="adding" @click="submitAddItem">{{ adding ? '添加中…' : '确认加项' }}</button><button class="btn success" :disabled="closing" @click="submitClose">{{ closing ? '结台中…' : '结台' }}</button></div>
        </template>
        <div class="sheet-actions"><button class="btn ghost" @click="detailVisible = false">关闭</button><button v-if="detailOrder?.status === 'WAITING_SETTLEMENT'" class="btn success" @click="submitSettle">结算</button></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { listOrders, listKtvRooms, createOrder, openSession, confirmOrder, settleOrder, collect, getBill, getOrderSession, addOrderItem, closeSession, listOrderItems, confirmOrderItem, rejectOrderItem, listCatalogItems, listPaymentMethods, listMembers, getWallet, getMemberPoints, getWalletTokenConfig, setRoomCleaningStatus, getPendingApproval } from '@/shared/api/saas'
import { countOfPendingOrder, isAlreadyProcessed, itemsOfPendingOrder, pendingAmountText, pendingGroupOf, pendingGroups, pendingRoomLabel, removePendingItem } from '@/shared/utils/pending-approval'
import { ORDER_STATUS, statusText, statusType } from '@/shared/utils/status'
import { formatMoney, minorToYuan, yuanToFen, getCurrency, currencyLabel } from '@/shared/utils/amount'
// 储值币（代币）/ 积分是**数量**口径：与金额分开取用，绝不参与金额合计、也绝不带货币符号。
import { formatTokens, formatPoints, tokenCountFromMinor, paymentTotals, isTokenMethod, POINT_UNIT, legInputToMinor, legMinorToInput, legInputStep, legInputExceedsAvailable } from '@/shared/utils/amount'
import { DEFAULT_WALLET_BRAND } from '@/shared/constants/wallet'

const PAGE_SIZE = 3
const rows = ref([])
const rooms = ref([])
const loading = ref(false)
const error = ref('')
const activeFilter = ref('ALL')
const visibleCount = ref(PAGE_SIZE)
const loadMoreTarget = ref(null)
const bills = ref({})
const billStates = ref({})
let observer

const createVisible = ref(false)
const creating = ref(false)
const createForm = ref({ resourceId: '' })
/** 房态看板图片加载失败的包厢：退回占位块，避免破版（键为包厢 id）。 */
const failedRoomImages = ref({})
const collectVisible = ref(false)
const collecting = ref(false)
const collectOrder = ref(null)
const collectError = ref('')
/** 收银打开时拉到的服务端账单：应收/已收分项都以它为准。 */
const collectBill = ref(null)
/** 逐笔分腿输入：现金 / 线上是金额（主单位），储值币 / 积分是**数量**（个数）；提交前统一折成最小货币单位。 */
const payByLeg = ref({})
const methods = ref([])
const methodsLoading = ref(false)
const walletBrand = ref(DEFAULT_WALLET_BRAND)
const walletRatio = ref(100)
const memberKeyword = ref('')
const searchingMembers = ref(false)
const memberResults = ref([])
const selectedMember = ref(null)
const memberWalletMinor = ref(0)
/** 会员储值**代币数量**：服务端 tokenAmount 优先，缺失时为 null（按租户比例换算余额）。 */
const memberWalletTokenAmount = ref(null)
const memberPoints = ref(0)
const detailVisible = ref(false)
const detailOrder = ref(null)
const detailBill = ref(null)
const detailSession = ref(null)
const itemForm = ref({ catalogItemId: '', quantity: 1 })
const catalogItems = ref([])
/** 图片加载失败的目录项：退回占位图，避免破版（键为目录项 id）。 */
const failedImages = ref({})
const selectedCatalogItem = computed(() => catalogItems.value.find((item) => isPicked(item)) || null)
/**
 * 选中项的可用库存上限（服务端 availableQuantity）：null = 该商品不控制库存（不限量）。
 * 用于数量输入框 max 与提交前校验，避免「填了 100 份、提交才被库存不足驳回」。
 */
const selectedStockLimit = computed(() => {
  const value = selectedCatalogItem.value?.availableQuantity
  return value === null || value === undefined || value === '' ? null : Number(value)
})
const pendingItems = ref([])
const adding = ref(false)
const closing = ref(false)

// —— 「客户待确认加项」聚合提醒（C 端自助加项 → 门店确认后才计入应收）——
// 服务端聚合接口一次给出当前门店的待确认总数/总额与按单分组明细；列表卡片角标、顶部集中处理入口
// 与详情「待确认加项」区共用这一份数据，绝不为每张卡片各拉一次 order-items（N+1）。
const PENDING_APPROVAL_POLL_MS = 15000
const pendingView = ref(null)
const pendingPanelVisible = ref(false)
const pendingBusy = ref(false)
const pendingRefreshing = ref(false)
/** 轻提示（409 / 并发下已被别人处理）：不是红色失败，只在集中处理面板与详情待确认区各显示一行。 */
const pendingNotice = ref('')
/** 详情待确认区是否已由聚合视图覆盖：覆盖时以聚合视图为唯一数据源，未覆盖才回退逐单明细。 */
const detailPendingFromView = ref(false)
const pendingPanelTarget = ref(null)
let pendingTimer = null

const pendingTotal = computed(() => numberOf(pendingView.value?.pendingCount))
const pendingOrders = computed(() => pendingGroups(pendingView.value))
const pendingAmountLabel = computed(() => pendingAmountText(pendingView.value))
/**
 * 详情「待确认加项」区的包厢标签：优先用聚合视图里该单的分组（同一份服务端包厢口径），
 * 聚合视图还没覆盖该单时退回详情订单自身带出的包厢字段；都没有才是「未关联包厢」。
 */
const detailRoomLabel = computed(() => {
  const group = pendingGroupOf(pendingView.value, detailOrder.value?.id)
  if (group) return pendingRoomLabel(group)
  return pendingRoomLabel({ roomName: detailOrder.value?.roomName, roomCode: detailOrder.value?.roomCode })
})
const collectPendingHint = computed(() => (collectOrder.value ? pendingBlockHint(collectOrder.value.id) : ''))

const filterOptions = computed(() => [
  { value: 'ALL', label: '全部', count: rows.value.length },
  { value: 'ACTIVE', label: '进行中', count: rows.value.filter((row) => ['DRAFT', 'SERVING'].includes(row.status)).length },
  { value: 'WAITING', label: '待处理', count: rows.value.filter((row) => ['WAITING_SETTLEMENT', 'WAITING_PAYMENT'].includes(row.status)).length },
  { value: 'DONE', label: '已完成', count: rows.value.filter((row) => ['COMPLETED', 'VOIDED', 'CANCELLED'].includes(row.status)).length },
])
const filteredRows = computed(() => rows.value.filter((row) => {
  if (activeFilter.value === 'ALL') return true
  if (activeFilter.value === 'ACTIVE') return ['DRAFT', 'SERVING'].includes(row.status)
  if (activeFilter.value === 'WAITING') return ['WAITING_SETTLEMENT', 'WAITING_PAYMENT'].includes(row.status)
  return ['COMPLETED', 'VOIDED', 'CANCELLED'].includes(row.status)
}))
const visibleRows = computed(() => filteredRows.value.slice(0, visibleCount.value))
const hasMore = computed(() => visibleCount.value < filteredRows.value.length)

watch(activeFilter, () => { visibleCount.value = PAGE_SIZE })
watch(visibleRows, (list) => hydrateBills(list), { immediate: true })
watch(loadMoreTarget, setupObserver)

function unwrapList(data) { return Array.isArray(data) ? data : (data?.items || data?.list || data?.rows || data?.records || []) }
function reasonOf(errorValue) { return errorValue?.friendlyMessage || errorValue?.message || '未知错误' }
function numberOf(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback }
/**
 * 储值币**数量**：服务端 tokenAmount 优先（已按余额 × 比例取整）；
 * 服务端未发布该字段时按租户比例在前端换算（唯一公式 tokenCountFromMinor），比例缺失按默认 100。
 * 金额字段（wallet / amount）原样保留用于对账，只是不再当钱渲染。
 */
function tokenAmountOf(source, ratio) {
  const direct = source?.tokenAmount ?? source?.token_amount
  if (direct !== undefined && direct !== null && direct !== '') return numberOf(direct)
  const minor = source?.wallet ?? source?.availableAmount ?? source?.amount
  return tokenCountFromMinor(numberOf(minor), ratio)
}
function itemName(item) { return item?.name || item?.nameSnapshot || '未命名商品' }
function itemQuantity(item) { return numberOf(item?.quantity, 1) }
function itemTotal(item) { return numberOf(item?.totalAmount ?? item?.amount) }
function itemUnitPrice(item) { const direct = item?.unitPrice ?? item?.unitPriceSnapshot; return direct == null ? Math.round(itemTotal(item) / Math.max(itemQuantity(item), 1)) : numberOf(direct) }
function quantityText(value) { return Number.isInteger(value) ? String(value) : value.toFixed(1) }
// —— 点单目录图片：后端返回的是网关同源相对路径（/api/v1/media-public/...），直接用，不拼域名 ——
// 无图 / 加载失败都退回占位图，保证列表不破版。
function itemThumb(item) {
  if (!item || failedImages.value[item.id]) return ''
  const main = item.mainImageUrl || (Array.isArray(item.imageUrls) && item.imageUrls.length ? item.imageUrls[0] : '')
  return typeof main === 'string' && main.trim() ? main.trim() : ''
}
function markImageFailed(item) { failedImages.value = { ...failedImages.value, [item.id]: true } }
function isPicked(item) { return String(itemForm.value.catalogItemId) === String(item.id) }
function pickCatalogItem(item) { if (item.available === false) return; itemForm.value = { ...itemForm.value, catalogItemId: item.id } }
function orderBill(order) {
  const bill = bills.value[order.id] || {}
  return {
    // 明细名由后端账单给出（新口径「包厢费（含 1 名服务人员）」，历史账单保持「包厢计时费」），前端不硬编码。
    roomFeeName: bill.roomFee?.name || '包厢费',
    roomFeeAmount: numberOf(bill.roomFee?.amount),
    items: Array.isArray(bill.items) ? bill.items : [],
    totalAmount: bill.totalAmount ?? order.totalAmount ?? 0,
    paidAmount: numberOf(bill.paidAmount ?? order.paidAmount),
    payableAmount: numberOf(bill.payableAmount),
    collected: {
      cash: numberOf(bill.collected?.cash),
      wallet: numberOf(bill.collected?.wallet),
      // 已收储值只展示**数量**：服务端 tokenAmount 优先，缺失时按租户比例换算金额
      walletTokens: tokenAmountOf(bill.collected, walletRatio.value),
      points: numberOf(bill.collected?.points),
    },
  }
}
function billLoading(order) { return !billStates.value[order.id] || billStates.value[order.id] === 'loading' }
function itemSummary(order) { const bill = orderBill(order); const count = bill.items.reduce((total, item) => total + itemQuantity(item), 0) + (bill.roomFeeAmount ? 1 : 0); return count ? `共 ${quantityText(count)} 件` : '暂无加项' }
function orderScene(order) { return order.businessType === 'KTV' ? 'KTV 到店消费' : (order.businessType || '到店消费') }
function orderSecondary(order) { return `门店 #${order.storeId || '—'} · 包厢 ${roomLabel(order)}` }
function roomLabel(order) {
  const name = order.roomName || order.roomCode
  if (name) return name
  return order.roomResourceId ? `#${order.roomResourceId}` : '—'
}
const SESSION_STATUS_TEXT = { RESERVED: '待开台', OPEN: '计时中', PAUSED: '已暂停', CLOSED: '已结台', CANCELLED: '已取消' }
/** 包厢运行状态 + 开台中的计时与预估计时费（结台后以账单明细为准）。 */
function roomLine(order) {
  const status = SESSION_STATUS_TEXT[order.sessionStatus]
  const parts = []
  if (status) parts.push(`包厢${status}`)
  if (order.roomElapsedSeconds) parts.push(`已计 ${Math.floor(order.roomElapsedSeconds / 60)} 分钟`)
  if (order.roomEstimatedFee) parts.push(`预估包厢费 ${formatMoney(order.roomEstimatedFee)}`)
  return parts.length ? parts.join(' · ') : ''
}
function actionable(order) { return ['DRAFT', 'SERVING', 'WAITING_SETTLEMENT', 'WAITING_PAYMENT'].includes(order.status) }

// —— 待确认加项：聚合视图派生、乐观移除、并发收敛与轮询 ——
/** 指定订单的待确认条数（卡片角标；未知订单 0）。 */
function pendingCountOf(orderId) { return countOfPendingOrder(pendingView.value, orderId) }
function pendingGroupCount(group) { return Math.max(numberOf(group?.pendingCount), Array.isArray(group?.items) ? group.items.length : 0) }
function pendingItemName(item) { return item?.name || item?.nameSnapshot || '未命名加项' }
function pendingItemQuantity(item) { return numberOf(item?.quantity, 1) }
function pendingItemAmount(item) { return numberOf(item?.totalAmount ?? item?.amount) }
/**
 * 单条加项的展示币种：记录自带 currencyCode 优先；聚合视图混币种时不给兜底（交由展示层的当前币种），
 * 避免把明细里的一条拼成不属于它的币种。
 */
function pendingItemCurrency(item) {
  if (item?.currencyCode) return item.currencyCode
  const view = pendingView.value
  return view && view.mixedCurrency === true ? undefined : view?.currencyCode
}
function hasPendingGroup(orderId) { return pendingGroupOf(pendingView.value, orderId) !== null }
/** 结台/结算/收款前的阻塞语义文案：待确认加项未处理前不计入本单应收。 */
function pendingBlockHint(orderId) {
  const count = pendingCountOf(orderId)
  return count > 0 ? '还有 ' + count + ' 条待确认加项未处理，处理前不计入本单应收。' : ''
}
/** 轻提示：只作提示，不弹失败框。 */
function notifyPending(message) { pendingNotice.value = message }
/** 拉聚合视图；`force=false` 且 revision 未变时不重渲染（避免角标闪烁与无用的 watch 更新）。 */
async function refreshPendingView(force = false) {
  pendingRefreshing.value = true
  try {
    const next = (await getPendingApproval()) || null
    if (!force && next && pendingView.value && Number(next.revision) === Number(pendingView.value.revision)) return pendingView.value
    pendingView.value = next
    if (detailVisible.value) syncDetailPending(detailOrder.value?.id)
    return pendingView.value
  } catch {
    // 提醒链路失败不打断主流程：沿用已有视图，等下一个轮询周期自愈
    return pendingView.value
  } finally { pendingRefreshing.value = false }
}
/** 详情待确认区与聚合视图对齐：视图覆盖该单时以它为准（可能已被处理为空）。 */
function syncDetailPending(orderId) {
  if (!detailPendingFromView.value) return
  if (orderId === null || orderId === undefined || String(detailOrder.value?.id) !== String(orderId)) return
  pendingItems.value = itemsOfPendingOrder(pendingView.value, orderId)
}
/** 本地乐观移除一条：卡片角标、集中处理分组与详情待确认区同步收敛，交互零等待。 */
function applyPendingRemoval(orderId, itemId) {
  pendingView.value = removePendingItem(pendingView.value, orderId, itemId)
  pendingItems.value = pendingItems.value.filter((item) => String(item.id) !== String(itemId))
  syncDetailPending(orderId)
}
/**
 * 确认/拒绝一条待确认加项：先乐观移除，再调服务端，写后强制重拉聚合视图。
 * 409（并发下已被别人处理）与幂等的「已是目标状态」都以服务端为准静默收敛 + 轻提示，不报红色失败。
 */
async function decidePendingItem(orderId, item, action) {
  pendingBusy.value = true
  notifyPending('')
  applyPendingRemoval(orderId, item.id)
  try {
    if (action === 'reject') await rejectOrderItem(orderId, item.id)
    else await confirmOrderItem(orderId, item.id)
    await refreshPendingView(true)
    return true
  } catch (actionError) {
    await refreshPendingView(true)
    notifyPending(isAlreadyProcessed(actionError)
      ? '该加项已被处理，已为你刷新最新数据'
      : (action === 'reject' ? '拒绝失败：' : '确认失败：') + reasonOf(actionError))
    return false
  } finally { pendingBusy.value = false }
}
function openPendingPanel() {
  notifyPending('')
  pendingPanelVisible.value = true
  refreshPendingView()
}
function closePendingPanel() { pendingPanelVisible.value = false; notifyPending('') }
async function confirmGroupItem(group, item) {
  if (!window.confirm('确认该客户自助加项生效？')) return
  if (await decidePendingItem(group.orderId, item, 'confirm')) await load()
}
async function rejectGroupItem(group, item) {
  if (!window.confirm('拒绝该客户自助加项？')) return
  if (await decidePendingItem(group.orderId, item, 'reject')) await load()
}
/** 本单全部确认：逐条串行（服务端每条独立条件更新，已被处理的不阻断其余条），最后统一以服务端为准重拉。 */
async function confirmWholeOrder(group) {
  const items = Array.isArray(group?.items) ? group.items.slice() : []
  if (!items.length) return
  if (!window.confirm('确认本单 ' + items.length + ' 条待确认加项全部生效？')) return
  pendingBusy.value = true
  notifyPending('')
  let missed = 0
  try {
    for (const item of items) {
      applyPendingRemoval(group.orderId, item.id)
      try { await confirmOrderItem(group.orderId, item.id) } catch { missed += 1 }
    }
    await refreshPendingView(true)
    if (missed) notifyPending('有 ' + missed + ' 条已被处理，已为你刷新最新数据')
  } finally { pendingBusy.value = false }
  await load()
}
/** 卡片角标直达该单详情里的「待确认加项」区（不再为列表每张卡片各拉一次 order-items）。 */
async function openPendingOrder(order) {
  await openDetail(order)
  await nextTick()
  pendingPanelTarget.value?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
function startPendingApprovalPolling() {
  if (pendingTimer) return
  refreshPendingView()
  pendingTimer = window.setInterval(() => {
    // 页面不可见（后台标签页 / 息屏）时暂停轮询；回到前台由 visibilitychange 立即补拉
    if (document.hidden) return
    refreshPendingView()
  }, PENDING_APPROVAL_POLL_MS)
  document.addEventListener('visibilitychange', onPendingVisibilityChange)
}
function onPendingVisibilityChange() {
  if (!document.hidden) refreshPendingView()
}
function stopPendingApprovalPolling() {
  if (pendingTimer) { window.clearInterval(pendingTimer); pendingTimer = null }
  document.removeEventListener('visibilitychange', onPendingVisibilityChange)
}

async function hydrateBills(list) {
  await Promise.allSettled(list.map(async (order) => {
    if (billStates.value[order.id]) return
    billStates.value = { ...billStates.value, [order.id]: 'loading' }
    try { bills.value = { ...bills.value, [order.id]: (await getBill(order.id)) || {} }; billStates.value = { ...billStates.value, [order.id]: 'done' } }
    catch { bills.value = { ...bills.value, [order.id]: {} }; billStates.value = { ...billStates.value, [order.id]: 'error' } }
  }))
}
function setupObserver() {
  observer?.disconnect()
  if (!loadMoreTarget.value || typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) loadMore() }, { rootMargin: '180px 0px' })
  observer.observe(loadMoreTarget.value)
}
function loadMore() { if (hasMore.value) visibleCount.value = Math.min(visibleCount.value + PAGE_SIZE, filteredRows.value.length) }
async function load() {
  loading.value = true; error.value = ''; bills.value = {}; billStates.value = {}
  try { rows.value = unwrapList(await listOrders()); visibleCount.value = PAGE_SIZE; await nextTick(); hydrateBills(visibleRows.value) }
  catch (loadError) { rows.value = []; error.value = '订单加载失败：' + reasonOf(loadError) }
  finally { loading.value = false }
}
async function openCreate() {
  createVisible.value = true
  await refreshRooms()
}
/** 拉取包厢列表（业务接口已返回主图/多图/描述，用同源相对路径，不拼域名）。 */
async function refreshRooms() {
  try { rooms.value = unwrapList(await listKtvRooms()) } catch { rooms.value = [] }
}
/** 图片加载失败的包厢：退回占位块，保证房态看板不破版。 */
function markRoomImageFailed(room) { failedRoomImages.value = { ...failedRoomImages.value, [room.id]: true } }
/**
 * 包厢主图：主图必须属于图片列表，缺失/不合法时按后端规则退回第一张；
 * 历史数据（迁移前创建）无图 → 空串，模板走占位块。
 */
function roomThumb(room) {
  if (!room || failedRoomImages.value[room.id]) return ''
  const urls = Array.isArray(room.imageUrls) ? room.imageUrls.filter((url) => typeof url === 'string' && url.trim()) : []
  const main = typeof room.mainImageUrl === 'string' ? room.mainImageUrl.trim() : ''
  if (main && (urls.length === 0 || urls.includes(main))) return main
  return urls.length ? urls[0] : ''
}
/** 房态：清洁中 / 使用中（含已预订占用）/ 空闲；与后端 ResourceView.state 对齐。 */
function roomStateText(room) {
  if (room.state === 'CLEANING') return '清洁中'
  if (room.state === 'OCCUPIED') return '使用中'
  if (room.available === false) return room.unavailableReason || '不可用'
  return '空闲'
}
function roomStateTone(room) {
  if (room.state === 'CLEANING') return 'cleaning'
  if (room.available === false) return 'busy'
  return 'idle'
}
async function markRoomCleaned(room) {
  try {
    await setRoomCleaningStatus(room.id, false)
    await refreshRooms()
    await load()
  } catch (actionError) { alert('操作失败：' + reasonOf(actionError)) }
}
async function submitCreate() {
  if (!createForm.value.resourceId) return alert('请选择包厢')
  creating.value = true
  // 开台落单币种 = 全局当前租户币种（服务端不再兜底默认值，写错会把订单永久锁死旧币种）
  try { const order = await createOrder({ businessType: 'KTV', currencyCode: getCurrency(), resourceId: createForm.value.resourceId }); if (order?.sessionId) await openSession(order.sessionId, 0); createVisible.value = false; await load() }
  catch (submitError) { alert('开台失败：' + reasonOf(submitError)) }
  finally { creating.value = false }
}
async function confirm(order) { try { await confirmOrder(order.id); await load() } catch (actionError) { alert('确认失败：' + reasonOf(actionError)) } }
async function settle(order) {
  const hint = pendingBlockHint(order.id)
  if (hint && !window.confirm('确认结算？' + hint)) return false
  try { await settleOrder(order.id, order.version ?? 0); await load(); return true } catch (actionError) { alert('结算失败：' + reasonOf(actionError)); return false }
}
async function openDetail(order) {
  detailOrder.value = order; detailBill.value = null; detailSession.value = null; itemForm.value = { catalogItemId: '', quantity: 1 }; failedImages.value = {}; detailVisible.value = true; detailPendingFromView.value = false; pendingItems.value = []; notifyPending('')
  try { catalogItems.value = unwrapList(await listCatalogItems(order.storeId)) } catch { catalogItems.value = [] }
  await loadDetail(order.id)
}
async function loadDetail(orderId) { try { detailBill.value = await getBill(orderId) } catch { detailBill.value = null }; try { detailSession.value = await getOrderSession(orderId) } catch { detailSession.value = null }; await loadPendingItems(orderId) }
/** 聚合视图覆盖该单时以它为准（与卡片角标同一份数据）；未覆盖才回退逐单明细（避免 N+1）。 */
async function loadPendingItems(orderId) {
  detailPendingFromView.value = hasPendingGroup(orderId)
  if (detailPendingFromView.value) { pendingItems.value = itemsOfPendingOrder(pendingView.value, orderId); return }
  try { pendingItems.value = unwrapList(await listOrderItems(orderId)).filter((item) => item.status === 'PENDING_APPROVAL') } catch { pendingItems.value = [] }
}
async function confirmPending(item) { if (!window.confirm('确认该客户自助加项生效？')) return; if (await decidePendingItem(detailOrder.value.id, item, 'confirm')) { await loadDetail(detailOrder.value.id); await load() } }
async function rejectPending(item) { if (!window.confirm('拒绝该客户自助加项？')) return; if (await decidePendingItem(detailOrder.value.id, item, 'reject')) await loadDetail(detailOrder.value.id) }
async function submitAddItem() {
  const quantity = Number(itemForm.value.quantity)
  if (!itemForm.value.catalogItemId) return alert('请选择目录项')
  if (!(quantity > 0)) return alert('数量需大于 0')
  // 提交前按服务端可用库存拦一次（服务端原子扣减仍是最终事实：不足会返回库存不足）。
  const limit = selectedStockLimit.value
  if (limit != null && quantity > limit) return alert('「' + (selectedCatalogItem.value?.name || '该商品') + '」可用库存仅 ' + quantityText(limit) + '，请减少数量或先补货')
  adding.value = true
  try { await addOrderItem(detailOrder.value.id, { catalogItemId: Number(itemForm.value.catalogItemId), quantity, source: 'MERCHANT' }); itemForm.value = { catalogItemId: '', quantity: 1 }; await loadDetail(detailOrder.value.id); await load() }
  catch (actionError) { alert('加项失败：' + reasonOf(actionError)) }
  finally { adding.value = false }
}
async function submitClose() {
  if (!detailSession.value?.id) return alert('未找到包厢会话，无法结台')
  if (!window.confirm('确认结台？结台后按计时计算包厢费，不可再加项。' + pendingBlockHint(detailOrder.value?.id))) return
  closing.value = true
  try { await closeSession(detailSession.value.id); detailVisible.value = false; await load() } catch (actionError) { alert('结台失败：' + reasonOf(actionError)) }
  finally { closing.value = false }
}
async function submitSettle() { if (await settle(detailOrder.value)) detailVisible.value = false }

// —— 收银：组合支付（KTV_BUSINESS_01 §7.2 / SAAS_PLATFORM_06 §组合收款舍入口径）——
// 金额全程最小货币单位整数；抵扣顺序固定「积分 → 储值 → 现金补差额」，每笔 ≤ 剩余应收；
// 支付方式一律取后台授权口径（未开通不显示），储值展示名取租户配置 wallet_brand_name（非硬编码）。
const METHOD_LABELS = { CASH: '现金', POINT: '积分', ALIPAY: '支付宝', WECHAT: '微信支付', STRIPE: '银行卡' }
const DEDUCTION_PRIORITY = { POINT: 0, WALLET: 1, CASH: 2, ALIPAY: 2, WECHAT: 2, STRIPE: 2 }

function methodLabel(method) { return method === 'WALLET' ? walletBrand.value : (METHOD_LABELS[method] || method) }
/**
 * 可用支付方式 = 租户已授权 **且** 支持当前币种。
 * USD 租户下微信/支付宝不可用：能提前拿到的能力字段就先过滤掉，避免运营填完金额、
 * 走到渠道下单才失败（服务端仍会二次校验并返回错误码，由 api-errors 翻成中文）。
 */
const allowedMethods = computed(() => methods.value.filter((method) => {
  if (!method.tenantAllowed) return false
  const currency = getCurrency()
  const supported = method.supportedCurrencies || method.currencies
  if (Array.isArray(supported) && supported.length && !supported.includes(currency)) return false
  if (method.currencyCode && method.currencyCode !== currency) return false
  return true
}))
const orderedMethods = computed(() => allowedMethods.value.slice()
  .sort((a, b) => (DEDUCTION_PRIORITY[a.method] ?? 9) - (DEDUCTION_PRIORITY[b.method] ?? 9)))
const memberSelectable = computed(() => allowedMethods.value.some((method) => method.method === 'POINT' || method.method === 'WALLET'))
/** 应收 = 服务端账单 payableAmount，缺省时退回 账单合计 − 已收（服务端会校验 payable）。 */
const payableMinor = computed(() => {
  const bill = collectBill.value
  if (bill?.payableAmount != null) return Math.max(0, numberOf(bill.payableAmount))
  return Math.max(0, numberOf(collectOrder.value?.totalAmount) - numberOf(collectOrder.value?.paidAmount))
})
const filledMinor = computed(() => orderedMethods.value
  .reduce((sum, method) => sum + legInputToMinor(method.method, payByLeg.value[method.method], walletRatio.value), 0))
const remainingMinor = computed(() => Math.max(0, payableMinor.value - filledMinor.value))
/** 会员储值可用**数量**：服务端 tokenAmount 优先，缺失时按租户比例换算余额。 */
const memberWalletTokens = computed(() => (memberWalletTokenAmount.value === null
  ? tokenCountFromMinor(memberWalletMinor.value, walletRatio.value)
  : memberWalletTokenAmount.value))
/**
 * 组合支付的**金额合计**只由现金类分腿构成：储值币 / 积分是数量口径，绝不并进金额合计
 * （`已填合计`仍是「这笔钱」的合计 —— 数量腿先按各自口径折成最小货币单位再相加，与应收同口径）。
 */
const cashLegsMinor = computed(() => paymentTotals(orderedMethods.value.map((method) => ({
  method: method.method,
  amount: legInputToMinor(method.method, payByLeg.value[method.method], walletRatio.value),
  tokenAmount: isTokenMethod(method.method) ? numberOf(payByLeg.value[method.method]) : undefined,
}))).moneyMinor)
/** 组合支付里储值币 / 积分的可用数量文案（只出数字：不带货币符号、品牌名与「积分」单位）。 */
function tokenAvailableText(method) {
  if (!selectedMember.value) return ''
  if (method === 'WALLET') return formatTokens(memberWalletTokens.value)
  if (method === 'POINT') return formatPoints(memberPoints.value)
  return ''
}

async function loadPaymentMethods() {
  methodsLoading.value = true
  try { methods.value = unwrapList(await listPaymentMethods('admin')) } catch { methods.value = [] } finally { methodsLoading.value = false }
}
/** 储值展示名与比例取租户配置（服务端按上下文取租户，账单/支付/充值各端同源，KTV_BUSINESS_01 §7.1）。 */
async function loadWalletConfig() {
  try {
    const cfg = await getWalletTokenConfig()
    if (cfg?.brandName) walletBrand.value = cfg.brandName
    if (cfg?.ratio) walletRatio.value = Number(cfg.ratio)
  } catch { /* 读取失败用默认展示名 */ }
}
async function searchMembers() {
  const keyword = (memberKeyword.value || '').trim()
  if (!keyword) return alert('请输入手机号或客户号')
  searchingMembers.value = true
  try {
    memberResults.value = unwrapList(await listMembers(keyword))
    if (!memberResults.value.length) alert('未找到客户')
  } catch (searchError) { memberResults.value = []; alert('查询客户失败：' + reasonOf(searchError)) }
  finally { searchingMembers.value = false }
}
async function pickMember(member) {
  selectedMember.value = member
  memberWalletMinor.value = 0
  memberWalletTokenAmount.value = null
  memberPoints.value = 0
  try {
    const wallet = await getWallet(member.id)
    memberWalletMinor.value = numberOf(wallet?.availableAmount)
    // 服务端已按比例算好数量时以它为准（未发布时留 null，展示层按比例换算）
    const direct = wallet?.tokenAmount ?? wallet?.token_amount
    memberWalletTokenAmount.value = direct === undefined || direct === null || direct === ''
      ? null
      : numberOf(direct)
  } catch { /* 余额读取失败不阻塞，收款时以服务端校验为准 */ }
  try { const points = await getMemberPoints(member.id); memberPoints.value = numberOf(points?.account?.availablePoints ?? points?.availablePoints) } catch { /* 同上 */ }
  autoFill()
}
/**
 * 按抵扣顺序用可用积分 / 储值填满应收，余额由现金兜底。
 * 储值币 / 积分分腿回填的是**数量**（储值币按租户比例折算、积分是 1:1 的个数），金额腿回填主单位金额。
 */
function autoFill() {
  let left = payableMinor.value
  const next = {}
  for (const method of orderedMethods.value) {
    let amount = 0
    if (method.method === 'POINT') amount = Math.min(left, selectedMember.value ? memberPoints.value : 0)
    else if (method.method === 'WALLET') amount = Math.min(left, selectedMember.value ? memberWalletMinor.value : 0)
    else if (method.method === 'CASH') amount = left
    next[method.method] = legMinorToInput(method.method, amount, walletRatio.value)
    left -= amount
  }
  payByLeg.value = next
}
function clearLegs() {
  const next = {}
  for (const method of orderedMethods.value) next[method.method] = 0
  payByLeg.value = next
}
/** 单笔不得超过「应收 − 其他方式已填」，数量腿同时不得超过会员可用数量（从源头避免超收 / 超用）。 */
function clampLeg(method) {
  const others = orderedMethods.value
    .filter((item) => item.method !== method)
    .reduce((sum, item) => sum + legInputToMinor(item.method, payByLeg.value[item.method], walletRatio.value), 0)
  let max = Math.max(0, payableMinor.value - others)
  // 可用额度也是金额口径：储值传余额（最小货币单位），积分可用个数 1:1
  if (method === 'WALLET' && selectedMember.value) max = Math.min(max, memberWalletMinor.value)
  if (method === 'POINT' && selectedMember.value) max = Math.min(max, memberPoints.value)
  const filled = legInputToMinor(method, payByLeg.value[method], walletRatio.value)
  // 数量腿回写整数个数、金额腿回写两位小数金额（`precision` 口径，避免把小数个数留在输入框里）
  const capped = Math.min(Math.max(0, filled), max)
  payByLeg.value = { ...payByLeg.value, [method]: legMinorToInput(method, capped, walletRatio.value) }
}
function openCollect(order) {
  collectOrder.value = order
  collectError.value = ''
  memberKeyword.value = ''
  memberResults.value = []
  selectedMember.value = null
  memberWalletMinor.value = 0
  memberWalletTokenAmount.value = null
  memberPoints.value = 0
  payByLeg.value = {}
  collectVisible.value = true
  if (!methods.value.length) loadPaymentMethods()
  // 应收一律以服务端账单为准（payableAmount），避免用列表里的旧快照
  collectBill.value = null
  getBill(order.id)
    .then((bill) => {
      if (bill) {
        collectBill.value = bill
        collectOrder.value = { ...order, totalAmount: bill.totalAmount, paidAmount: bill.paidAmount }
      }
    })
    .catch(() => { /* 读取失败退回列表快照，收款时服务端仍会校验 */ })
    .finally(() => { clearLegs(); autoFill() })
}
async function submitCollect() {
  const payable = payableMinor.value
  if (payable <= 0) { collectError.value = '该订单没有应收金额（可能已收讫）'; return }
  // 提交给服务端的 amount 恒为最小货币单位整数：数量腿先按各自口径折回金额（收款 wire contract 不变）
  const payments = orderedMethods.value
    .map((method) => ({ method: method.method, amount: legInputToMinor(method.method, payByLeg.value[method.method], walletRatio.value) }))
    .filter((payment) => payment.amount > 0)
  if (!payments.length) { collectError.value = '请至少填写一种支付方式的数量或金额'; return }
  const total = payments.reduce((sum, payment) => sum + payment.amount, 0)
  if (total !== payable) { collectError.value = `已填合计 ${formatMoney(total)} 与应收 ${formatMoney(payable)} 不一致`; return }
  const usesMember = payments.some((payment) => payment.method === 'WALLET' || payment.method === 'POINT')
  if (usesMember && !selectedMember.value) { collectError.value = '积分 / 储值抵扣需要先选择客户'; return }
  // 数量不得超过可用：WALLET 按比例折回余额比，POINT 的 amount 就是积分个数本身
  if (legInputExceedsAvailable('WALLET', payByLeg.value.WALLET, memberWalletMinor.value, walletRatio.value)) {
    collectError.value = `${walletBrand.value}数量超过可用（可用 ${formatTokens(memberWalletTokens.value)}）`
    return
  }
  if (legInputExceedsAvailable('POINT', payByLeg.value.POINT, memberPoints.value, walletRatio.value)) {
    collectError.value = `积分数量超过可用（可用 ${formatPoints(memberPoints.value)}）`
    return
  }
  collectError.value = ''
  collecting.value = true
  try {
    await collect(collectOrder.value.id, {
      customerId: selectedMember.value ? selectedMember.value.id : null,
      // 收款币种 = 全局当前租户币种（服务端校验「收款币种 = 订单币种」）
      currencyCode: getCurrency(),
      payable,
      payments,
    })
    collectVisible.value = false
    await load()
  } catch (actionError) { collectError.value = '收款失败：' + reasonOf(actionError) }
  finally { collecting.value = false }
}

onMounted(() => { load(); loadPaymentMethods(); loadWalletConfig(); startPendingApprovalPolling() })
onBeforeUnmount(() => { observer?.disconnect(); stopPendingApprovalPolling() })
</script>
