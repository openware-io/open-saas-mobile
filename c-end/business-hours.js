/**
 * C 端营业时间工具（原生 JS，挂 window.A380BusinessHours；与 datetime.js/money.js 同一 IIFE 加载方式，可被 vitest 直接加载）。
 *
 * 服务端只读接口：GET /api/v1/business/reservations/business-hours
 *   → 200 { storeId, openTime: '18:00', closeTime: '05:00', source: 'DEFAULT',
 *           crossesMidnight: true, allDay: false, displayText: '18:00 – 次日 05:00' }
 *
 * 语义（与 platform-order-service 一致）：
 * - 营业时段左闭右开 [open, close)：open 时刻本身算营业中，close 时刻已打烊；
 * - close < open 表示跨自然日（18:00–05:00 覆盖当天 18:00 到次日 05:00）；
 * - open == close 表示全天营业。
 *
 * 本模块只负责「别让客人选到必然被拒的时段」：真正的准入校验仍在服务端
 * （越界返回 422 RESERVATION_OUT_OF_BUSINESS_HOURS），所以这里的读路径**绝不抛异常**，
 * 任何缺失 / 非法响应都回退默认营业时间，宁可少拦一次也不让预约页打不开。
 */
(function (root) {
  'use strict';

  /** 服务端默认营业时间（与 platform-order-service 的默认配置同源）。 */
  var DEFAULT_BUSINESS_HOURS = {
    openTime: '18:00',
    closeTime: '05:00',
    crossesMidnight: true,
    allDay: false,
    displayText: '18:00 – 次日 05:00',
    source: 'DEFAULT'
  };

  /** 合法营业时刻：HH:mm 或 HH:mm:ss（小时 00–23、分钟/秒 00–59），不接受 '9:00' / '25:00' 这类写法。 */
  var TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

  function pad2(value) { return String(value).padStart(2, '0'); }

  /** 默认营业时间的新副本（每次返回新对象，调用方改写不会污染常量）。 */
  function defaultBusinessHours() {
    return {
      openTime: DEFAULT_BUSINESS_HOURS.openTime,
      closeTime: DEFAULT_BUSINESS_HOURS.closeTime,
      crossesMidnight: DEFAULT_BUSINESS_HOURS.crossesMidnight,
      allDay: DEFAULT_BUSINESS_HOURS.allDay,
      displayText: DEFAULT_BUSINESS_HOURS.displayText,
      source: DEFAULT_BUSINESS_HOURS.source
    };
  }

  /** 'HH:mm' / 'HH:mm:ss' -> 当日零点起的分钟数；非法返回 null（不抛异常）。 */
  function parseTimeToMinutes(value) {
    if (typeof value !== 'string') return null;
    var matched = TIME_PATTERN.exec(value.trim());
    if (!matched) return null;
    return Number(matched[1]) * 60 + Number(matched[2]);
  }

  /**
   * 接口响应 -> 内部营业时段结构；字段缺失 / 时间格式非法 / openTime 与 closeTime 相同以外的
   * 异常情况一律回退默认值。读路径绝不抛异常。
   */
  function parseBusinessHours(json) {
    try {
      if (!json || typeof json !== 'object') return defaultBusinessHours();
      var openTime = typeof json.openTime === 'string' ? json.openTime.trim() : '';
      var closeTime = typeof json.closeTime === 'string' ? json.closeTime.trim() : '';
      var open = parseTimeToMinutes(openTime);
      var close = parseTimeToMinutes(closeTime);
      // open == close 是合法的「全天营业」；其余任何一格读不出来都回退默认
      if (open === null || close === null) return defaultBusinessHours();
      var allDay = json.allDay === true || open === close;
      var crossesMidnight = !allDay && open > close;
      var hours = {
        openTime: openTime,
        closeTime: closeTime,
        crossesMidnight: crossesMidnight,
        allDay: allDay,
        displayText: '',
        source: typeof json.source === 'string' && json.source ? json.source : DEFAULT_BUSINESS_HOURS.source
      };
      // 展示文案由结构化字段现算，不直接信任服务端文本（老接口可能不返回 displayText）
      hours.displayText = businessHoursText(hours);
      return hours;
    } catch (e) {
      return defaultBusinessHours();
    }
  }

  /**
   * 到店时刻是否落在营业时段内（左闭右开）：
   * - 全天营业恒 true；
   * - 跨自然日 t >= open || t < close；同一天 open <= t < close；
   * - timeStr 非法 / hours 缺失时返回 false（按「未确认在营业时间内」处理，提交前拦下）。
   */
  function isWithinBusinessHours(timeStr, hours) {
    var current = parseTimeToMinutes(timeStr);
    if (current === null) return false;
    var normalized = parseBusinessHours(hours);
    if (normalized.allDay) return true;
    var open = parseTimeToMinutes(normalized.openTime);
    var close = parseTimeToMinutes(normalized.closeTime);
    if (open === null || close === null) return false;
    if (normalized.crossesMidnight || open > close) return current >= open || current < close;
    return current >= open && current < close;
  }

  /** 展示文案：跨自然日带「次日」，全天营业写「全天营业」，其余为「open – close」。 */
  function businessHoursText(hours) {
    var normalized = parseBusinessHours(hours);
    if (normalized.allDay) return '全天营业';
    return normalized.openTime + ' – ' + (normalized.crossesMidnight ? '次日 ' : '') + normalized.closeTime;
  }

  root.A380BusinessHours = {
    DEFAULT_BUSINESS_HOURS: DEFAULT_BUSINESS_HOURS,
    parseBusinessHours: parseBusinessHours,
    isWithinBusinessHours: isWithinBusinessHours,
    businessHoursText: businessHoursText
  };
})(typeof window !== 'undefined' ? window : this);
