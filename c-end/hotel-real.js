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

async function renderRealHotelList() {
  app.innerHTML = pageHead('酒店', '<button class="head-action" data-route="my-orders">订单</button>') +
    '<section class="list" id="real-hotel-list"><p class="empty">酒店加载中…</p></section>';
  try {
    var hotels = await hotelApi('/business/hotel/catalog/hotels');
    if (!routeIsCurrent('service/hotel')) return;
    var list = document.querySelector('#real-hotel-list');
    if (!list) return;
    if (!hotels || !hotels.length) {
      list.innerHTML = emptyState('🏨', '暂无可预订酒店', '酒店正在准备房态，请稍后再来');
      return;
    }
    list.innerHTML = hotels.map(function (hotel) {
      return '<article class="venue-card" data-real-hotel="' + hotel.id + '">' +
        '<div class="hotel-cover">🏨</div>' +
        '<div class="venue-copy"><h3>' + escapeHtml(hotel.name) + '</h3>' +
        '<p><span class="rating">★ 4.9</span> · 真实房态</p>' +
        '<p class="ellipsis">' + escapeHtml(hotel.address || '') + ' · ' + escapeHtml(hotel.timezone || '') + '</p>' +
        '<div class="tag-row"><span>即时确认</span><span>到店付</span><span>免费取消</span></div>' +
        '<p><span class="hotel-link">查看房型</span></p></div></article>';
    }).join('');
  } catch (error) {
    var list = document.querySelector('#real-hotel-list');
    if (list) list.innerHTML = emptyState('🏨', '酒店加载失败', error.message || '请稍后重试');
  }
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
    root.innerHTML =
      '<section class="detail-card merchant"><div class="hotel-detail-head"><div class="hotel-cover small">🏨</div><div><h2>' + escapeHtml(hotel.name) + '</h2>' +
      '<p>' + escapeHtml(hotel.address || '') + '</p></div></div>' +
      '<div class="tag-row"><span>即时确认</span><span>到店付</span><span>免费取消</span></div>' +
      '<p>入住 ' + escapeHtml(hotel.checkInTime || '') + ' · 退房 ' + escapeHtml(hotel.checkOutTime || '') + '</p></section>' +
      '<section class="form-card"><h2>选择房型与日期</h2>' +
      '<label>房型<select id="hotel-room-type">' + roomTypes.map(function (type) {
        return '<option value="' + type.id + '">' + escapeHtml(type.name) + ' · ' + (type.areaSqm || '') + '㎡</option>';
      }).join('') + '</select></label>' +
      '<label>价格计划<select id="hotel-rate-plan">' + ratePlans.map(function (plan) {
        return '<option value="' + plan.id + '">' + escapeHtml(plan.name) + ' · ' + hotelMoney(plan.basePriceMinor, plan.currency) + '</option>';
      }).join('') + '</select></label>' +
      '<label>入住<input id="hotel-check-in" type="date" min="' + dateOffset(0) + '" value="' + dateOffset(1) + '"></label>' +
      '<label>退房<input id="hotel-check-out" type="date" min="' + dateOffset(1) + '" value="' + dateOffset(2) + '"></label>' +
      '<label>房间数<input id="hotel-rooms" type="number" min="1" max="5" value="1"></label>' +
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
    list.innerHTML = orders.map(function (order) {
      return '<article class="venue-card"><div class="venue-copy"><h3>' + escapeHtml(order.bookingNo) + '</h3>' +
        '<p>' + escapeHtml(order.roomType || '') + ' · ' + escapeHtml(order.roomNo || '待分配') + '</p>' +
        '<p>' + escapeHtml(order.checkInDate) + ' ~ ' + escapeHtml(order.checkOutDate) + '</p>' +
        '<div class="tag-row"><span>' + escapeHtml(order.status) + '</span></div>' +
        '<p><span class="price">' + hotelMoney(order.amountMinor, order.currency) + '</span></p></div>' + (order.status === 'PENDING_PAYMENT' ? '<button class="ghost-button" data-cancel-booking="' + escapeHtml(order.id) + '">取消预订</button>' : '') + '</article>';
    }).join('');
  } catch (error) {
    var list = document.querySelector('#real-hotel-orders');
    if (list) list.innerHTML = emptyState('🏨', '订单加载失败', error.message || '请稍后重试');
  }
}
document.addEventListener('click', async function (event) {
  var button = event.target.closest('[data-cancel-booking]');
  if (!button) return;
  event.preventDefault();
  if (!window.confirm('取消该酒店预订？')) return;
  try {
    await hotelApi('/business/hotel/bookings/' + encodeURIComponent(button.getAttribute('data-cancel-booking')) + '/cancel', { method: 'POST' });
    showToast('预订已取消');
    await renderRealHotelOrders();
  } catch (error) {
    showToast(error.message || '取消失败');
  }
});