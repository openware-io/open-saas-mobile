/**
 * C 端日期时间工具（原生 JS，挂 window.A380DateTime；与 context.js/auth-errors.js 同一加载方式，可被 vitest 直接加载）。
 *
 * 两套时间口径必须分清，不能互相代替：
 * - 设备本地日期（localDateString / dateOffset）：日期选择器「今天+N」按设备本地时区取，
 *   禁止 toISOString()（UTC）——东八区本地 00:00–07:59 会被写成前一天。
 * - 门店营业时间（storeOffsetDateTime / formatStoreDateTime）：后端 ord_reservation.start_at
 *   存的是「门店营业本地时间」的墙上时间（ReservationApplicationService.toBusinessLocal
 *   把 OffsetDateTime 入参统一换算到 +08:00 后落库），所以：
 *   入参按带 +08:00 偏移的 OffsetDateTime 序列化，出参（LocalDateTime，无时区）按字面量展示，
 *   不得用 new Date() 按设备时区重新解释，也不得用 toISOString() 序列化。
 */
(function (root) {
  'use strict';

  /** 门店营业时区固定为北京时间 UTC+8，与后端 toBusinessLocal 的 ZoneOffset.ofHours(8) 对齐。 */
  var STORE_OFFSET_MINUTES = 8 * 60;

  /** 时区偏移串（Z 或 ±HH:MM / ±HHMM）——用于区分「带时区的 ISO 串」与「门店本地 LocalDateTime 串」。 */
  var OFFSET_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/;
  /** 门店本地时间串：YYYY-MM-DDTHH:mm(:ss)。 */
  var LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

  function pad2(value) { return String(value).padStart(2, '0'); }

  /** 设备本地时区的 YYYY-MM-DD。 */
  function localDateString(date) {
    var d = (date === undefined || date === null) ? new Date() : new Date(date);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** 今天 + days 的设备本地日期（now 为可选注入，便于测试固定时钟）。 */
  function dateOffset(days, now) {
    var d = (now === undefined || now === null) ? new Date() : new Date(now);
    d.setDate(d.getDate() + Number(days || 0));
    return localDateString(d);
  }

  /** '19:30' / '19:30:00' -> 'HH:mm'。 */
  function normalizeTime(time) {
    var parts = String(time === undefined || time === null ? '' : time).split(':');
    var hour = Number(parts[0]);
    var minute = Number(parts[1]);
    if (!Number.isFinite(hour)) hour = 0;
    if (!Number.isFinite(minute)) minute = 0;
    return pad2(Math.min(23, Math.max(0, Math.trunc(hour)))) + ':' + pad2(Math.min(59, Math.max(0, Math.trunc(minute))));
  }

  /**
   * 门店营业时间入参：'YYYY-MM-DDTHH:mm:ss+08:00'（后端 CreateReservationRequest 的 startAt/endAt 是 OffsetDateTime）。
   * 用 UTC 算术做「墙上时间 + N 小时」，结果与设备时区无关，也不会出现 Z 结尾的 UTC 串。
   */
  function storeOffsetDateTime(dateStr, timeStr, addHours) {
    var date = String(dateStr === undefined || dateStr === null ? '' : dateStr).split('-');
    var time = normalizeTime(timeStr).split(':');
    var base = Date.UTC(Number(date[0]), Number(date[1]) - 1, Number(date[2]),
      Number(time[0]), Number(time[1]), 0) + Number(addHours || 0) * 3600000;
    var d = new Date(base);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate())
      + 'T' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':00+08:00';
  }

  /**
   * 门店营业时间出参展示「M月D日 HH:mm」：
   * - 无时区串（后端 LocalDateTime，门店本地）按字面量取用，不按设备时区平移；
   * - 带时区串（Z / ±HH:MM）先换算到门店时区（UTC+8）再展示。
   */
  function formatStoreDateTime(value) {
    if (value === null || value === undefined || value === '') return '—';
    var text = String(value);
    if (OFFSET_SUFFIX.test(text)) {
      var shifted = new Date(new Date(text).getTime() + STORE_OFFSET_MINUTES * 60000);
      if (isNaN(shifted.getTime())) return text;
      return (shifted.getUTCMonth() + 1) + '月' + shifted.getUTCDate() + '日 '
        + pad2(shifted.getUTCHours()) + ':' + pad2(shifted.getUTCMinutes());
    }
    var parts = LOCAL_DATE_TIME.exec(text);
    if (!parts) return text;
    return Number(parts[2]) + '月' + Number(parts[3]) + '日 ' + pad2(parts[4]) + ':' + pad2(parts[5]);
  }

  root.A380DateTime = {
    STORE_OFFSET_MINUTES: STORE_OFFSET_MINUTES,
    localDateString: localDateString,
    dateOffset: dateOffset,
    storeOffsetDateTime: storeOffsetDateTime,
    formatStoreDateTime: formatStoreDateTime
  };
})(window);
