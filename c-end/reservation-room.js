/**
 * C 端「我的预约」房型/包厢展示口径（window.A380ReservationRoom）。
 *
 * 预约预约的是**房型**（包厢类型），具体包厢到店后由门店分配：
 *  - 新数据：显示 roomTypeName，回退 roomTypeCode；未分配包厢时提示「到店后由门店分配包厢」；
 *  - 历史数据（迁移前只有 resourceId，或已到店分配了包厢）：显示包厢名并**标注「历史预约」**，
 *    到店分配后才有的 resourceId / resourceName 只在该分支出现，不参与新预约的创建。
 *
 * 纯展示逻辑单独成文件，便于用单测锁死「历史行回退」与「不得再出现包厢号选择」的文案口径。
 */
(function (root) {
  'use strict';

  /** 未分配包厢时的提示（与后端提示同一口径：具体包厢到店后由门店分配）。 */
  var ASSIGN_HINT = '具体包厢到店后由门店分配';
  /** 预约卡片上「包厢分配」列的待分配文案。 */
  var PENDING_TEXT = '到店后由门店分配包厢';
  /** 历史预约标注（迁移前按具体包厢创建、或到店已分配包厢的单据）。 */
  var HISTORICAL_TEXT = '历史预约';

  function textOf(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /** 关联到的包厢（/business/resources 缓存），仅在历史行/已分配时才有意义。 */
  function roomNameOf(room) {
    if (!room) return '';
    return textOf(room.name) || textOf(room.resourceCode);
  }

  /**
   * 预约对应的「预约房型」展示。
   * @returns {{ text: string, historical: boolean }}
   *   text 为房型名（回退房型编码）；历史行回退到旧包厢名并置 historical=true。
   */
  function roomTypeLabel(reservation, room) {
    var r = reservation || {};
    var typeName = textOf(r.roomTypeName);
    if (typeName) return { text: typeName, historical: false };
    var typeCode = textOf(r.roomTypeCode);
    if (typeCode) return { text: typeCode, historical: false };
    // 历史行：只有 resourceId/resourceName（迁移前预约的就是具体包厢）
    var legacy = textOf(r.resourceName) || roomNameOf(room);
    if (legacy) return { text: legacy, historical: true };
    var resourceId = numberOrNull(r.resourceId);
    if (resourceId !== null) return { text: '包厢 #' + resourceId, historical: true };
    return { text: '待分配包厢类型', historical: false };
  }

  /** 包厢分配情况：到店分配后（resourceId/resourceName 有值）显示已分配包厢，否则提示门店分配。 */
  function allocationText(reservation, room) {
    var r = reservation || {};
    var assigned = textOf(r.resourceName) || roomNameOf(room);
    if (assigned) return '已分配：' + assigned;
    if (numberOrNull(r.resourceId) !== null) return '已分配：包厢 #' + r.resourceId;
    return PENDING_TEXT;
  }

  /** 是否历史预约（无房型字段）：页面据此打「历史预约」标注。 */
  function isHistorical(reservation) {
    return roomTypeLabel(reservation).historical;
  }

  root.A380ReservationRoom = {
    ASSIGN_HINT: ASSIGN_HINT,
    PENDING_TEXT: PENDING_TEXT,
    HISTORICAL_TEXT: HISTORICAL_TEXT,
    roomTypeLabel: roomTypeLabel,
    allocationText: allocationText,
    isHistorical: isHistorical
  };
})(typeof window !== 'undefined' ? window : globalThis);
