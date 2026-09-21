<template>
  <div class="page">
    <header v-if="state === 'authed'" class="topbar" aria-label="A380后台">
      <span class="brand-mark">A<sup>380</sup></span>
      <span class="brand-copy"><strong>A380 商户工作台</strong><small>经营数据与订单履约</small></span>
      <span v-if="activeContext" class="context-pill" title="A380租户">{{ activeContext.storeName || activeContext.organizationName || '全部门店' }}</span>
    </header>

    <main class="content">
      <div v-if="state === 'loading'" class="empty">验证授权中…</div>
      <div v-else-if="state === 'denied'" class="denied">
        <div class="denied-card">
          <div class="denied-icon">🔐</div>
          <h2>{{ errorTitle }}</h2>
          <p class="denied-title">{{ errorDescription }}</p>
          <p class="denied-hint">如你刚完成授权，请点击“重新检查”；如果仍失败，请联系门店管理员确认运营角色和门店范围。</p>
          <div v-if="availableContexts.length" class="context-list">
            <button v-for="context in availableContexts" :key="context.contextId" class="context-option" :disabled="state === 'loading'" @click="selectContext(context.contextId)">
              <strong>{{ context.storeName || context.organizationName || context.tenantName || '未命名门店' }}</strong>
              <span>{{ context.tenantName }}<template v-if="context.organizationName"> · {{ context.organizationName }}</template></span>
            </button>
          </div>
          <div class="denied-actions">
            <button class="btn ghost" :disabled="state === 'loading'" @click="backToIm">返回 IM</button>
            <button class="btn primary" :disabled="state === 'loading'" @click="reAuth">{{ state === 'loading' ? '检查中…' : '我已授权，重新检查' }}</button>
          </div>
        </div>
      </div>
      <router-view v-else />
    </main>

    <nav v-if="state === 'authed'" class="tabbar">
      <router-link to="/reservations" class="tab" active-class="active">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z"/><path d="m8 14 2 2 5-5"/></svg><span>预约</span>
      </router-link>
      <router-link to="/orders" class="tab" active-class="active">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/></svg><span>订单</span>
      </router-link>
    </nav>
  </div>
</template>

<script setup>
import { ref, onMounted, provide } from 'vue'
import { ensureOperatorAuth } from '@/b-end/oauth'

const state = ref('loading')
const errorTitle = ref('暂未开通运营权限')
const errorDescription = ref('你当前使用的 IM 账号尚未开通 A380 商户端的运营权限。')
const availableContexts = ref([])
const activeContext = ref(null)
provide('activeContext', activeContext)

async function auth(force = false, contextId = null) {
  state.value = 'loading'
  availableContexts.value = []
  try {
    const selected = await ensureOperatorAuth({ force, contextId })
    activeContext.value = selected || null
    state.value = selected ? 'authed' : 'loading' // null = 正在跳转授权
  } catch (e) {
    if (e?.code === 'NO_OPERATOR_ROLE') {
      errorTitle.value = '尚未开通运营权限'
      errorDescription.value = '当前 IM 账号已完成登录，但还没有 A380 商户端的运营角色。'
    } else if (e?.code === 'IM_SESSION_EXPIRED') {
      errorTitle.value = 'IM 登录已失效'
      errorDescription.value = '请返回 IM 重新登录后，再进入 A380后台。'
    } else if (e?.code === 'IM_BRIDGE_AUTH_FAILED') {
      errorTitle.value = '无法完成 IM 授权'
      errorDescription.value = '请返回 IM 后重新进入 A380后台；如持续失败请更新 IM App。'
    } else if (e?.code === 'CONTEXT_SELECTION_REQUIRED') {
      errorTitle.value = '请选择运营门店'
      errorDescription.value = '当前账号可访问多个门店，请选择要进入的运营门店。'
      availableContexts.value = Array.isArray(e.contexts) ? e.contexts : []
    } else if (e?.code === 'PKCE_UNAVAILABLE') {
      errorTitle.value = '当前环境不支持授权'
      errorDescription.value = '请从已更新的 IM App 重新进入 A380后台，或使用 HTTPS / localhost 地址访问。'
    } else {
      // 只有带错误码的业务异常才展示原始 message；其余（网络/未知异常）用统一话术，避免把框架原文弹给运营人员。
      console.error('[a380-b] auth failed', e)
      errorTitle.value = '授权服务暂时不可用'
      errorDescription.value = e?.code ? (e.message || '请稍后重试；如持续失败请联系管理员。')
        : '网络或授权服务异常，请稍后重试；如持续失败请联系管理员。'
    }
    state.value = 'denied'
  }
}

function reAuth() {
  // 强制重新走 B 端 OAuth，覆盖旧的 C 端/无 appId 会话。
  auth(true)
}

function backToIm() {
  // 无权限时可回退 IM 容器（App 内走 GVBridge.exitApp；浏览器走历史/关闭）。
  try {
    if (window.GVBridge && typeof window.GVBridge.exitApp === 'function') {
      window.GVBridge.exitApp().catch(function () {})
      return
    }
  } catch (e) {}
  if (window.GV_SDK && typeof window.GV_SDK.exitApp === 'function') {
    window.GV_SDK.exitApp()
    return
  }
  if (window.history.length > 1) {
    window.history.back()
    return
  }
  window.close()
}

function selectContext(contextId) {
  auth(false, contextId)
}

onMounted(auth)
</script>

<style scoped>
.denied {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  color: #303133;
  background: #f5f6f8;
}
.denied-card {
  width: 100%;
  max-width: 320px;
  background: #fff;
  border-radius: 16px;
  padding: 40px 28px;
  box-shadow: 0 12px 32px rgba(31, 49, 83, 0.08);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.denied-icon { font-size: 52px; margin-bottom: 18px; }
.denied h2 { font-size: 19px; margin-bottom: 12px; font-weight: 700; }
.denied-title { font-size: 14px; color: #606266; margin-bottom: 10px; line-height: 1.6; }
.denied-hint { font-size: 12px; color: #909399; line-height: 1.7; margin-bottom: 24px; }
.denied-actions { width: 100%; display: flex; flex-direction: column; gap: 10px; }
.denied-actions .btn { width: 100%; }
.denied-actions .btn.ghost { background: #fff; color: #606266; border: 1px solid #dcdfe6; }
.context-list { width: 100%; display: flex; flex-direction: column; gap: 10px; margin: 4px 0 24px; }
.context-option { width: 100%; padding: 12px 14px; border: 1px solid #dcdfe6; border-radius: 10px; background: #fff; color: #303133; text-align: left; cursor: pointer; }
.context-option:active { background: #ecf5ff; border-color: #409eff; }
.context-option strong, .context-option span { display: block; }
.context-option strong { font-size: 14px; margin-bottom: 4px; }
.context-option span { color: #909399; font-size: 12px; }
</style>
