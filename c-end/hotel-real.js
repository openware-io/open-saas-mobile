/* 真实酒店：C 端目录/详情/报价/下单，数据来自 /business/hotel API。 */
function hotelMoney(minor, currency) {
  return window.A380Money ? window.A380Money.formatMoney(minor, currency) : '-';
}

async function hotelApi(path, options) {
  var response = await fetch('/api/v1' + path, Object.assign({
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  }, options || {}));
  var payload = null;
  try { payload = await response.json(); } catch (e) {}
  if (!response.ok) {
    var error = new Error((payload && payload.message) || ('HTTP ' + response.status));
    error.code = payload && payload.code;
    throw error;
  }
  return payload;
}

// 「我的」页要复用酒店订单；只暴露只读列表，不复制订单渲染逻辑。
window.A380HotelBookings = {
  list: function () { return hotelApi('/business/hotel/bookings'); }
};

var hotelListCache = [];

function hotelCards(hotels) {
  return hotels.map(function (hotel) {
    return '<article class="venue-card" data-real-hotel="' + hotel.id + '">' +
      '<div class="hotel-cover">🏨</div>' +
      '<div class="venue-copy"><h3>' + escapeHtml(hotel.name) + '</h3>' +
      '<p><span class="rating">★ 4.9</span> · 真实房态</p>' +
      '<p class="ellipsis">' + escapeHtml(hotel.address || '') + ' · ' + escapeHtml(hotel.timezone || '') + '</p>' +
      '<div class="tag-row"><span>即时确认</span><span>到店付</span><span>免费取消</span></div>' +
      '<p><span class="hotel-link">查看房型</span></p></div></article>';
  }).join('');
}

async function renderRealHotelList() {
  app.innerHTML = pageHead('酒店', '<button class="head-action" data-route="my-hotel-orders">订单</button>') +
    '<section class="list" id="real-hotel-list"><p class="empty">酒店加载中…</p></section>';
  var list = document.querySelector('#real-hotel-list');
  if (list && hotelListCache.length) list.innerHTML = hotelCards(hotelListCache);
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
  } catch (error) {
    list = document.querySelector('#real-hotel-list');
    if (!list) return;
    if (hotelListCache.length) {
      list.innerHTML = hotelCards(hotelListCache);
      showToast('网络不稳定，已显示上次结果');
      return;
    }
    list.innerHTML = emptyState('🏨', '酒店加载失败', error.message || '请稍后重试') +
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
      '<section class="detail-card merchant"><div class="hotel-detail-head"><div class="hotel-cover small">🏨</div><div><h2>' + escapeHtml(hotel.name) + '</h2>' +
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
      '<button class="primary-button" data-hotel-book>提交预订</button></section>';
  } catch (error) {
    var root = document.querySelector('#real-hotel-detail');
    if (root) root.innerHTML = emptyState('🏨', '酒店加载失败', error.message || '请稍后重试');
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
    if (target) target.innerHTML = emptyState('🏨', '报价失败', error.message || '请稍后重试');
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
    var booking = await hotelApi('/business/hotel/bookings', {
      method: 'POST',
      body: JSON.stringify({ roomTypeId: roomTypeId, ratePlanId: ratePlanId, checkInDate: checkIn, checkOutDate: checkOut, rooms: rooms, guestName: guestName, guestPhone: guestPhone, note: 'C H5' }),
    });
    if (!routeIsCurrent('real-hotel/' + hotelId)) return;
    app.innerHTML = pageHead('预订成功', '<span></span>') +
      '<section class="success"><div>✓</div><h1>预订已提交</h1><p>' + escapeHtml(booking.bookingNo) + '</p>' +
      '<p>应付 ' + hotelMoney(booking.amountMinor, booking.currency) + ' · 状态 ' + escapeHtml(booking.status) + '</p></section>' +
      '<div class="submit-spacer"></div><footer class="action-bar"><button class="primary-button" data-route="my-hotel-orders">查看订单</button></footer>';
  } catch (error) {
    showToast(error.message || '预订失败');
  }
}

async function renderRealHotelOrders() {
  app.innerHTML = pageHead('我的酒店订单', '<button class="head-action" data-route="service/hotel">继续预订</button>') +
    '<section class="list" id="real-hotel-orders"><p class="empty">订单加载中…</p></section>';
  try {
    var orders = await hotelApi('/business/hotel/bookings');
    if (!routeIsCurrent('my-hotel-orders')) return;
    var list = document.querySelector('#real-hotel-orders');
    if (!list) return;
    if (!orders || !orders.length) {
      list.innerHTML = emptyState('🏨', '暂无酒店订单', '去酒店页选择房型并提交预订');
      return;
    }
    var statusLabels = {
      PENDING_PAYMENT: ['待支付', 'pending'],
      CONFIRMED: ['已确认', 'confirmed'],
      CANCELLED: ['已取消', 'cancelled'],
      COMPLETED: ['已完成', 'completed'],
      NO_SHOW: ['未到店', 'no-show']
    };
    list.innerHTML = orders.map(function (order) {
      var status = statusLabels[order.status] || [order.status, 'default'];
      return '<article class="hotel-order-card">' +
        '<header class="hotel-order-head"><div><h3>' + escapeHtml(order.bookingNo) + '</h3>' +
          '<p>' + escapeHtml(order.roomType || '房型待确认') + ' · ' + escapeHtml(order.roomNo || '待分配') + '</p></div>' +
          '<span class="hotel-order-status is-' + status[1] + '">' + escapeHtml(status[0]) + '</span></header>' +
        '<div class="hotel-order-dates"><div><small>入住</small><strong>' + escapeHtml(order.checkInDate) + '</strong></div>' +
          '<div><small>退房</small><strong>' + escapeHtml(order.checkOutDate) + '</strong></div></div>' +
        '<footer class="hotel-order-foot"><span class="hotel-order-price">' + hotelMoney(order.amountMinor, order.currency) + '</span>' +
          (order.status === 'PENDING_PAYMENT' ? '<button class="hotel-order-cancel" data-cancel-booking="' + escapeHtml(order.id) + '">取消预订</button>' : '') +
        '</footer></article>';
    }).join('');
  } catch (error) {
    var list = document.querySelector('#real-hotel-orders');
    if (list) list.innerHTML = emptyState('🏨', '订单加载失败', error.message || '请稍后重试');
  }
}
document.addEventListener('click', function (event) {
  var button = event.target.closest('[data-hotel-picker]');
  if (!button || !window.A380Picker) return;
  event.preventDefault();
  var name = button.getAttribute('data-hotel-picker');
  var key = name === 'hotel-check-in' ? 'checkIn' : name === 'hotel-check-out' ? 'checkOut' : name === 'hotel-rooms' ? 'rooms' : name;
  var options = hotelPickerOptions[key] || [];
  if (!options.length) return;
  window.A380Picker.open('#hotel-booking-form', name, hotelPickerTitle(key), options);
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
    showToast(error.message || '取消失败');
  }
});