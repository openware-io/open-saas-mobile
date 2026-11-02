/* 真实酒店：C 端目录/详情/报价/下单，数据来自 /business/hotel API。 */
function hotelMoney(minor, currency) {
  return window.SaasMoney ? window.SaasMoney.formatMoney(minor, currency) : '-';
}

/**
 * 酒店 API 统一出口：同源 fetch + 结构化错误（status/code/payload 供 api-errors.js 翻译中文）。
 *
 * <p>客户端超时只套在**读请求（GET）**上：写请求（提交预订 / 取消）若被客户端判超时，
 * 服务端可能其实已经成功，前端再报「失败」会诱导顾客重复提交；写请求因此不设客户端超时，
 * 结果以「我的酒店订单」页的最终状态为准。读请求超时由 SaasPageLoad.withTimeout 兜底，
 * 接口挂住不会让页面永远停在「加载中…」。
 */
async function hotelApi(path, options) {
  var pending = fetch('/api/v1' + path, Object.assign({
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  }, options || {})).then(async function (response) {
    var payload = null;
    try { payload = await response.json(); } catch (e) {}
    if (!response.ok) {
      var error = new Error((payload && payload.message) || ('HTTP ' + response.status));
      error.status = response.status;
      error.code = payload && payload.code;
      error.payload = payload;
      throw error;
    }
    return payload;
  });
  var method = String((options && options.method) || 'GET').toUpperCase();
  var withTimeout = method === 'GET' && window.SaasPageLoad
    && typeof window.SaasPageLoad.withTimeout === 'function';
  return withTimeout ? window.SaasPageLoad.withTimeout(pending) : pending;
}

// 「我的」页要复用酒店订单；只暴露只读列表，不复制订单渲染逻辑。
window.SaasHotelBookings = {
  list: function () { return hotelApi('/business/hotel/bookings'); }
};

function bindHotelCoverFallback(root) {
  if (!root) return;
  root.querySelectorAll('img.hotel-cover-img').forEach(function (img) {
    img.addEventListener('error', function () {
      var cover = document.createElement('div');
      cover.className = img.classList.contains('small') ? 'hotel-cover small' : 'hotel-cover';
      cover.textContent = '🏨';
      img.replaceWith(cover);
    });
  });
}

var hotelListCache = [];

function hotelCards(hotels) {
  return hotels.map(function (hotel) {
    return '<article class="venue-card" data-real-hotel="' + hotel.id + '">' +
      '<img class="hotel-cover-img" src="' + escapeHtml(hotel.coverImageUrl || './assets/hotel-cover.svg') + '" alt="' + escapeHtml(hotel.name) + ' 封面">' +
      '<div class="venue-copy"><h3>' + escapeHtml(hotel.name) + '</h3>' +
      '<p><span class="rating">★ 4.9</span> · 真实房态</p>' +
      '<p class="ellipsis">' + escapeHtml(hotel.address || '') + ' · ' + escapeHtml(hotel.timezone || '') + '</p>' +
      '<div class="tag-row"><span>即时确认</span><span>到店付</span><span>免费取消</span></div>' +
      '<p><span class="hotel-link">查看房型</span></p></div></article>';
  }).join('');
}

async function renderRealHotelList() {
  app.innerHTML = pageHead('酒店', '<button class="head-action" data-route="my-hotel-orders">我的酒店订单</button>') +
    '<section class="list" id="real-hotel-list"><p class="empty">酒店加载中…</p></section>';
  var list = document.querySelector('#real-hotel-list');
  if (list && hotelListCache.length) { list.innerHTML = hotelCards(hotelListCache); bindHotelCoverFallback(list); }
  try {
    var hotels = await hotelApi('/business/hotel/catalog/hotels');
    if (!routeIsCurrent('service/hotel')) return;
    list = document.querySelector('#real-hotel-list');
    if (!list) return;
    if (!hotels || !hotels.length) {
      hotelListCache = [];
      list.innerHTML = emptyState('🏨', '暂无可预订酒店', '酒店正在准备房态，请稍后再来');
      return;
    }
    hotelListCache = hotels;
    list.innerHTML = hotelCards(hotels);
    bindHotelCoverFallback(list);
  } catch (error) {
    list = document.querySelector('#real-hotel-list');
    if (!list) return;
    if (hotelListCache.length) {
      list.innerHTML = hotelCards(hotelListCache);
      bindHotelCoverFallback(list);
      showToast('网络不稳定，已显示上次结果');
      return;
    }
    list.innerHTML = emptyState('🏨', '酒店加载失败', apiErrorText(error, '请稍后重试')) +
      '<button class="retry-button" type="button" data-retry="service/hotel">重新加载</button>';
  }
}

var hotelPickerOptions = {};

function hotelPickerTitle(name) {
  return { roomType: '选择房型', ratePlan: '选择价格计划', checkIn: '选择入住日期', checkOut: '选择退房日期', rooms: '选择房间数' }[name] || '请选择';
}

function hotelDateOptions(startOffset, count) {
  var options = [];
  for (var i = 0; i < count; i++) {
    var offset = startOffset + i;
    var value = dateOffset(offset);
    options.push({ value: value, label: bookingDateLabel(value, offset), hint: value.replace(/-/g, '/') });
  }
  return options;
}

function hotelDateShort(value, offset) {
  var prefix = offset === 0 ? '今天' : offset === 1 ? '明天' : offset === 2 ? '后天' : '周' + ['日','一','二','三','四','五','六'][new Date(value + 'T00:00:00').getDay()];
  return prefix + ' ' + value.slice(5).replace('-', '/');
}

function hotelPickerField(id, label, value, display) {
  return '<label>' + label +
    '<input id="' + id + '" name="' + id + '" type="hidden" value="' + escapeHtml(String(value)) + '">' +
    '<button type="button" class="booking-picker-row" data-hotel-picker="' + id + '">' +
      '<span class="booking-field-copy"><strong data-picker-display="' + id + '">' + escapeHtml(display) + '</strong></span>' +
      '<span class="booking-chevron">›</span>' +
    '</button></label>';
}

async function renderRealHotelDetail(hotelId) {
  app.innerHTML = pageHead('酒店详情', '<span></span>') + '<section id="real-hotel-detail"><p class="empty">加载中…</p></section>';
  try {
    var hotel = await hotelApi('/business/hotel/catalog/hotels/' + encodeURIComponent(hotelId));
    if (!routeIsCurrent('real-hotel/' + hotelId)) return;
    var root = document.querySelector('#real-hotel-detail');
    if (!root) return;
    var roomTypes = hotel.roomTypes || [];
    var ratePlans = hotel.ratePlans || [];
    hotelPickerOptions.roomType = roomTypes.map(function (type) {
      return { value: String(type.id), label: type.name + (type.areaSqm ? ' · ' + type.areaSqm + '㎡' : ''), hint: '' };
    });
    hotelPickerOptions.ratePlan = ratePlans.map(function (plan) {
      return { value: String(plan.id), label: plan.name + ' · ' + hotelMoney(plan.basePriceMinor, plan.currency), hint: '' };
    });
    hotelPickerOptions.checkIn = hotelDateOptions(1, 14);
    hotelPickerOptions.checkOut = hotelDateOptions(2, 14);
    hotelPickerOptions.rooms = [1, 2, 3, 4, 5].map(function (n) {
      return { value: String(n), label: n + ' 间', hint: '' };
    });
    root.innerHTML =
      '<section class="detail-card merchant"><div class="hotel-detail-head"><img class="hotel-cover-img small" src="' + escapeHtml(hotel.coverImageUrl || './assets/hotel-cover.svg') + '" alt="' + escapeHtml(hotel.name) + ' 封面"><div><h2>' + escapeHtml(hotel.name) + '</h2>' +
      '<p>' + escapeHtml(hotel.address || '') + '</p></div></div>' +
      '<div class="tag-row"><span>即时确认</span><span>到店付</span><span>免费取消</span></div>' +
      '<p>入住 ' + escapeHtml(hotel.checkInTime || '') + ' · 退房 ' + escapeHtml(hotel.checkOutTime || '') + '</p></section>' +
      '<section class="form-card" id="hotel-booking-form"><h2>选择房型与日期</h2>' +
      '<label>房型<input id="hotel-room-type" name="hotel-room-type" type="hidden" value="' + (roomTypes[0] ? roomTypes[0].id : '') + '">' +
      '<button type="button" class="booking-picker-row" data-hotel-picker="roomType"><span class="booking-field-copy"><strong data-picker-display="roomType">' + escapeHtml(roomTypes[0] ? roomTypes[0].name + (roomTypes[0].areaSqm ? ' · ' + roomTypes[0].areaSqm + '㎡' : '') : '选择房型') + '</strong></span><span class="booking-chevron">›</span></button></label>' +
      '<label>价格计划<input id="hotel-rate-plan" name="hotel-rate-plan" type="hidden" value="' + (ratePlans[0] ? ratePlans[0].id : '') + '">' +
      '<button type="button" class="booking-picker-row" data-hotel-picker="ratePlan"><span class="booking-field-copy"><strong data-picker-display="ratePlan">' + escapeHtml(ratePlans[0] ? ratePlans[0].name + ' · ' + hotelMoney(ratePlans[0].basePriceMinor, ratePlans[0].currency) : '选择价格计划') + '</strong></span><span class="booking-chevron">›</span></button></label>' +
      hotelPickerField('hotel-check-in', '入住', dateOffset(1), hotelDateShort(dateOffset(1), 1)) +
      hotelPickerField('hotel-check-out', '退房', dateOffset(2), hotelDateShort(dateOffset(2), 2)) +
      hotelPickerField('hotel-rooms', '房间数', 1, '1 间') +
      '<button class="primary-button" data-hotel-quote>查询实时价格</button></section>' +
      '<section id="hotel-quote"></section>' +
      '<section class="form-card"><h2>入住人</h2>' +
      '<label>姓名<input id="hotel-guest-name" placeholder="请输入入住人姓名"></label>' +
      '<label>手机号<input id="hotel-guest-phone" inputmode="tel" placeholder="用于接收确认"></label>' +
      '<label>积分抵扣（可选）<input id="hotel-points" inputmode="numeric" placeholder="输入使用积分数"></label>' +
      '<button class="primary-button" data-hotel-book>提交预订</button></section>';
  } catch (error) {
    var root = document.querySelector('#real-hotel-detail');
    if (root) root.innerHTML = emptyState('🏨', '酒店加载失败', apiErrorText(error, '请稍后重试'));
  }
}

async function quoteRealHotel(hotelId) {
  var roomTypeId = Number((document.querySelector('#hotel-room-type') || {}).value || 0);
  var ratePlanId = Number((document.querySelector('#hotel-rate-plan') || {}).value || 0);
  var checkIn = (document.querySelector('#hotel-check-in') || {}).value;
  var checkOut = (document.querySelector('#hotel-check-out') || {}).value;
  var rooms = Number((document.querySelector('#hotel-rooms') || {}).value || 1);
  var target = document.querySelector('#hotel-quote');
  if (!roomTypeId || !checkIn || !checkOut) return;
  if (target) target.innerHTML = '<p class="empty">报价中…</p>';
  try {
    var quote = await hotelApi('/business/hotel/quotes', {
      method: 'POST',
      body: JSON.stringify({ roomTypeId: roomTypeId, ratePlanId: ratePlanId, checkInDate: checkIn, checkOutDate: checkOut, rooms: rooms }),
    });
    if (!routeIsCurrent('real-hotel/' + hotelId)) return;
    if (target) target.innerHTML = quote.available
      ? '<section class="detail-card"><h3>实时报价</h3><p>总价 <strong>' + hotelMoney(quote.totalMinor, quote.currency) + '</strong> · ' + quote.nights.length + ' 晚 · ' + rooms + ' 间</p></section>'
      : emptyState('🏨', '所选日期无房', '请调整日期或房型');
  } catch (error) {
    if (target) target.innerHTML = emptyState('🏨', '报价失败', apiErrorText(error, '请稍后重试'));
  }
}

async function bookRealHotel(hotelId) {
  var roomTypeId = Number((document.querySelector('#hotel-room-type') || {}).value || 0);
  var ratePlanId = Number((document.querySelector('#hotel-rate-plan') || {}).value || 0);
  var checkIn = (document.querySelector('#hotel-check-in') || {}).value;
  var checkOut = (document.querySelector('#hotel-check-out') || {}).value;
  var rooms = Number((document.querySelector('#hotel-rooms') || {}).value || 1);
  var guestName = (document.querySelector('#hotel-guest-name') || {}).value || '';
  var guestPhone = (document.querySelector('#hotel-guest-phone') || {}).value || '';
  if (!guestName.trim() || !guestPhone.trim()) { showToast('请填写入住人姓名和手机号'); return; }
  try {
    // 先初始化 C 会员档案：后端 ord_order.customer_id 是「我的订单」的唯一归属键，
    // 不能等用户首次打开资产页才懒创建，否则会生成查不到的酒店订单。
    await SAAS.getWallet();
    var booking = await hotelApi('/business/hotel/bookings', {
      method: 'POST',
      body: JSON.stringify({ roomTypeId: roomTypeId, ratePlanId: ratePlanId, checkInDate: checkIn, checkOutDate: checkOut, rooms: rooms, guestName: guestName, guestPhone: guestPhone, pointsUsed: Number((document.querySelector('#hotel-points') || {}).value || 0), note: 'C H5' }),
    });
    if (!routeIsCurrent('real-hotel/' + hotelId)) return;
    app.innerHTML = pageHead('预订成功', '<span></span>') +
      '<section class="success"><div>✓</div><h1>预订已提交</h1><p>' + escapeHtml(booking.bookingNo) + '</p>' +
      '<p>应付 ' + hotelMoney(booking.amountMinor, booking.currency) + ' · 状态 ' + escapeHtml(hotelOrderStatus(booking.status)[0]) + '</p></section>' +
      '<div class="submit-spacer"></div><footer class="action-bar"><button class="primary-button" data-route="my-hotel-orders">查看订单</button></footer>';
  } catch (error) {
    showToast(apiErrorText(error, '预订失败，请稍后重试'));
  }
}

/**
 * 酒店预订状态映射：当前服务端闭集为 PENDING_CONFIRM / CONFIRMED / CHECKED_IN /
 * CHECKED_OUT / DUE_OUT / CANCELLED / NO_SHOW；任何状态都翻译成中文，绝不把英文枚举展示给顾客。
 * PENDING / COMPLETED 是历史数据兼容值（只读展示；COMPLETED 不出现取消按钮），
 * 避免库里的旧记录重新露出英文；已废弃的待支付/待付定金状态不再返回，也不在本表恢复。
 */
var HOTEL_ORDER_STATUS = {
  PENDING: ['待确认', 'pending'],
  PENDING_CONFIRM: ['待确认', 'pending'],
  CONFIRMED: ['已确认', 'confirmed'],
  CHECKED_IN: ['已入住', 'confirmed'],
  CHECKED_OUT: ['已退房', 'completed'],
  DUE_OUT: ['待退房', 'pending'],
  CANCELLED: ['已取消', 'cancelled'],
  NO_SHOW: ['未到店', 'no-show'],
  COMPLETED: ['已完成', 'completed']
};

function hotelOrderStatus(status) {
  return HOTEL_ORDER_STATUS[status] || [status ? String(status) : '处理中', 'default'];
}

/** 取消判据与服务端一致（HotelBookingApplicationService.cancel 仅拒绝 CANCELLED / CHECKED_OUT）。 */
function canCancelHotelOrder(status) {
  return status !== 'CANCELLED' && status !== 'CHECKED_OUT' && status !== 'COMPLETED';
}

/** 单张酒店订单卡片（入住/退房日期走 SaasDateTime 的日期出口：M月D日）。 */
function hotelOrderCard(order) {
  var status = hotelOrderStatus(order.status);
  var checkIn = order.checkInDate ? SaasDateTime.formatStoreDate(order.checkInDate) : '待确认';
  var checkOut = order.checkOutDate ? SaasDateTime.formatStoreDate(order.checkOutDate) : '待确认';
  return '<article class="hotel-order-card">' +
    '<header class="hotel-order-head"><div><h3>' + escapeHtml(order.bookingNo || ('#' + order.id)) + '</h3>' +
      '<p>' + escapeHtml(order.roomType || '房型待确认') + ' · ' + escapeHtml(order.roomNo || '待分配') + '</p></div>' +
      '<span class="hotel-order-status is-' + status[1] + '">' + escapeHtml(status[0]) + '</span></header>' +
    '<div class="hotel-order-dates"><div><small>入住</small><strong>' + escapeHtml(checkIn) + '</strong></div>' +
      '<div><small>退房</small><strong>' + escapeHtml(checkOut) + '</strong></div></div>' +
    '<footer class="hotel-order-foot"><span class="hotel-order-price">' + hotelMoney(order.amountMinor, order.currency) + '</span>' +
      (canCancelHotelOrder(order.status) ? '<button class="hotel-order-cancel" data-cancel-booking="' + escapeHtml(order.id) + '">取消预订</button>' : '') +
    '</footer></article>';
}

/** 列表绘制（SaasPageLoad.renderPage 的 render 出口；首屏与重试共用）。 */
function paintHotelOrderList(orders) {
  var list = Array.isArray(orders) ? orders : [];
  var html = pageHead('我的酒店订单', '<button class="head-action" data-route="service/hotel">继续预订</button>') +
    (list.length
      ? '<section class="list">' + list.map(hotelOrderCard).join('') + '</section>'
      : emptyState('🏨', '暂无酒店订单', '去酒店页选择房型并提交预订'));
  if (app.innerHTML === html) return;
  app.innerHTML = html;
}

/**
 * 「我的酒店订单」：加载/超时/失败统一走 SaasPageLoad（错误态带 data-retry 可重试），
 * 不再手写加载中占位；错误文案走 api-errors（不把内部权限文案直出给顾客）。
 */
async function renderRealHotelOrders() {
  var route = 'my-hotel-orders';
  await SaasPageLoad.renderPage({
    name: route,
    retryRoute: route,
    errorTitle: '酒店订单加载失败',
    isCurrent: function () { return routeIsCurrent(route); },
    mount: function (html) {
      app.innerHTML = pageHead('我的酒店订单', '<button class="head-action" data-route="service/hotel">继续预订</button>') + html;
    },
    load: function () { return window.SaasHotelBookings.list(); },
    render: paintHotelOrderList,
  });
}
document.addEventListener('click', function (event) {
  var button = event.target.closest('[data-hotel-picker]');
  if (!button || !window.SaasPicker) return;
  event.preventDefault();
  var name = button.getAttribute('data-hotel-picker');
  var key = name === 'hotel-check-in' ? 'checkIn' : name === 'hotel-check-out' ? 'checkOut' : name === 'hotel-rooms' ? 'rooms' : name;
  var options = hotelPickerOptions[key] || [];
  if (!options.length) return;
  window.SaasPicker.open('#hotel-booking-form', name, hotelPickerTitle(key), options);
});
document.addEventListener('click', async function (event) {
  var button = event.target.closest('[data-cancel-booking]');
  if (!button) return;
  event.preventDefault();
  if (!(await showConfirm('取消酒店预订', '取消后不可恢复。', { confirmText: '确认取消', cancelText: '再想想' }))) return;
  try {
    await hotelApi('/business/hotel/bookings/' + encodeURIComponent(button.getAttribute('data-cancel-booking')) + '/cancel', { method: 'POST' });
    showToast('预订已取消');
    await renderRealHotelOrders();
  } catch (error) {
    showToast(apiErrorText(error, '取消失败，请稍后重试'));
  }
});
