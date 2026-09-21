window.A380_DATA = {
  services: [
    { id: 'hotel', name: '酒店', icon: '🏨', kind: 'venue' },
    { id: 'ktv', name: 'KTV 业务', icon: '🎤', kind: 'business' },
    { id: 'bar', name: '酒吧', icon: '🍸', kind: 'venue' },
    { id: 'billiards', name: '台球厅', icon: '🎱', kind: 'venue' },
    { id: 'food', name: '美食', icon: '🍽️', kind: 'catalog' },
    { id: 'delivery', name: '外卖', icon: '🛵', kind: 'catalog' },
    { id: 'flash', name: '限时购', icon: '⚡', kind: 'catalog' },
    { id: 'foot', name: '足浴按摩', icon: '♨️', kind: 'venue' },
    { id: 'flights', name: '机票', icon: '✈️', kind: 'travel' },
    { id: 'taxi', name: '打车', icon: '🚕', kind: 'travel' },
  ],
  ledgers: {
    coin: {
      // 储值币是**数量**口径（不是钱）：balance 仍是「这笔钱」的最小货币单位（对账用），
      // tokenAmount 是代币个数 = balance ÷ 100 × 租户比例（默认 100）；展示走 SAAS.formatTokens，不带货币符号。
      title: 'A380币', balance: 888000, tokenAmount: 888000,
      records: [
        ['充值到账', '+2,000', '今天 09:26'], ['A380酒店消费', '-368', '昨天 21:08'],
        ['活动奖励', '+188', '08月25日 18:30'], ['A380 KTV消费', '-298', '08月23日 22:15'],
      ],
    },
    points: {
      title: '积分', balance: 12680,
      records: [
        ['每日签到', '+20', '今天 08:12'], ['订单奖励', '+368', '昨天 21:09'],
        ['兑换优惠券', '-500', '08月25日 15:20'], ['邀请好友奖励', '+1,000', '08月22日 11:06'],
      ],
    },
  },
  venues: {
    hotel: {
      title: '酒店', noun: '酒店', search: '搜索酒店、商圈或地标', images: ['hotel-1.jpg','hotel-2.jpg','hotel-3.jpg','hotel-4.jpg'],
      names: ['A380酒店中心店', 'A380酒店机场店', 'A380酒店会展店', 'A380酒店滨江店'],
      tags: ['近地铁', '免费早餐', '延迟退房'], address: '深圳市南山区科技南一路 A380 服务中心',
      packages: [
        { name: '豪华大床房', desc: '1张1.8米大床 · 2份早餐 · 35㎡', price: 368, stock: 8 },
        { name: '景观双床房', desc: '2张1.2米单床 · 高层景观 · 38㎡', price: 428, stock: 5 },
        { name: '行政套房', desc: '独立客厅 · 行政礼遇 · 65㎡', price: 688, stock: 3 },
      ],
      slots: ['1间', '2间', '3间'], arrivalLabel: '预计到店时间', dateLabel: '入住日期',
    },
    ktv: {
      title: 'KTV', noun: 'KTV', search: '搜索KTV、商圈或套餐', images: ['ktv-1.png','ktv-2.png','ktv-3.png','ktv-4.png'],
      names: ['A380 KTV壹号店', 'A380 KTV欢乐店', 'A380 KTV星光店', 'A380 KTV派对店'],
      tags: ['音响升级', '免费停车', '可订包厢'], address: '深圳市福田区星河路 A380 娱乐广场',
      packages: [
        { name: '小包欢唱套餐', desc: '4小时欢唱 · 果盘1份 · 软饮6瓶', price: 298, stock: 6 },
        { name: '中包聚会套餐', desc: '4小时欢唱 · 啤酒12瓶 · 小吃2份', price: 498, stock: 4 },
        { name: '豪华派对套餐', desc: '6小时欢唱 · 啤酒24瓶 · 双果盘', price: 888, stock: 2 },
      ],
      slots: ['小包 K03', '中包 K08', '大包 K12'], arrivalLabel: '到场时间', dateLabel: '到场日期',
    },
    bar: {
      title: '酒吧', noun: '酒吧', search: '搜索酒吧、商圈或套餐', images: ['bar-1.jpg','bar-2.jpg','bar-3.jpg','bar-4.jpg','bar-5.jpg','bar-6.jpg'],
      names: ['A380酒吧中心店', 'A380酒吧海岸店', 'A380酒吧云端店', 'A380酒吧音乐店'],
      tags: ['现场音乐', '散台可订', '卡座套餐'], address: '深圳市南山区海德三道 A380 潮流街区',
      packages: [
        { name: '散台畅饮套餐', desc: '散台1桌 · 精酿4杯 · 小吃1份', price: 268, stock: 10 },
        { name: '卡座欢聚套餐', desc: '卡座1桌 · 啤酒18瓶 · 果盘2份', price: 688, stock: 5 },
        { name: 'VIP卡座套餐', desc: 'VIP卡座 · 洋酒1套 · 软饮8瓶', price: 1288, stock: 2 },
      ],
      slots: ['散台 A01', '散台 A06', '卡座 C03', 'VIP V02'], arrivalLabel: '到场时间', dateLabel: '到场日期',
    },
    billiards: {
      title: '台球厅', noun: '台球厅', search: '搜索台球厅、球台或商圈', images: ['billiards-1.png','billiards-2.png','billiards-3.png'],
      names: ['A380台球厅中心店', 'A380台球厅竞技店', 'A380台球厅星牌店', 'A380台球厅欢乐店'],
      tags: ['专业球台', '免费停车', '饮品供应'], address: '深圳市罗湖区人民南路 A380 运动中心',
      packages: [
        { name: '标准球台2小时', desc: '美式球台 · 含球杆2支 · 饮品2杯', price: 108, stock: 9 },
        { name: '精品球台3小时', desc: '星牌球台 · 专属灯光 · 饮品4杯', price: 188, stock: 5 },
        { name: '陪练体验套餐', desc: '专业陪练1小时 · 球台2小时', price: 238, stock: 3 },
      ],
      slots: ['美式 A03', '美式 A06', '斯诺克 S02', '精品 P01'], arrivalLabel: '到场时间', dateLabel: '到场日期',
    },
    foot: {
      title: '足浴按摩', noun: '足浴', search: '搜索足浴、按摩或商圈', images: ['foot-1.png','foot-2.png','foot-3.png','foot-4.png'],
      names: ['A380足浴中心店', 'A380足浴养生店', 'A380足浴滨河店', 'A380足浴静享店'],
      tags: ['专业技师', '安静包厢', '到店即用'], address: '深圳市宝安区创业一路 A380 健康生活馆',
      packages: [
        { name: '经典足浴70分钟', desc: '草本泡足 · 足底舒缓 · 肩颈放松', price: 128, stock: 12 },
        { name: '泰式舒缓90分钟', desc: '泰式拉伸 · 全身舒缓 · 热敷', price: 198, stock: 8 },
        { name: '双人养生套餐', desc: '双人独立包厢 · 足浴90分钟', price: 358, stock: 4 },
      ],
      slots: ['大厅 06号', '静享包厢 F08', '双人包厢 F12'], arrivalLabel: '到场时间', dateLabel: '到场日期',
    },
  },
  catalogs: {
    food: {
      title: '美食', action: '立即预约', tags: ['推荐', '双人餐', '下午茶', '夜宵'],
      items: [
        ['A380臻选双人餐', '主厨热菜4道 · 小吃2份 · 饮品2杯', 168, 'food-1.png', 1286],
        ['A380下午茶套餐', '甜品拼盘 · 手作饮品2杯', 88, 'food-2.png', 956],
        ['炙烤牛排单人餐', '谷饲牛排 · 沙拉 · 例汤', 98, 'food-3.png', 731],
        ['城市夜宵分享餐', '烧烤拼盘 · 精酿4杯', 138, 'food-4.png', 528],
      ],
    },
    delivery: {
      title: '外卖', action: '加入购物车', tags: ['附近', '销量', '最快送达', '满减'],
      items: [
        ['元气能量便当', '鸡腿肉 · 时蔬 · 温泉蛋', 32, 'food-3.png', 2036],
        ['招牌手作奶茶', '鲜奶茶底 · 少糖去冰可选', 18, 'food-2.png', 1868],
        ['轻食沙拉套餐', '低脂鸡胸 · 牛油果 · 时蔬', 36, 'food-1.png', 928],
        ['暖心夜宵套餐', '炒饭 · 小吃 · 冰饮', 42, 'food-4.png', 816],
      ],
    },
    flash: {
      title: '限时购', action: '马上抢', tags: ['今日特价', '酒店', '娱乐', '养生'],
      items: [
        ['酒店豪华房通兑券', '周日至周四可用 · 含双早', 299, 'hotel-2.jpg', 326],
        ['KTV四小时欢唱券', '中小包通用 · 节假日加价', 199, 'ktv-2.png', 582],
        ['足浴经典项目代金券', '到店即用 · 不限时段', 99, 'foot-2.png', 869],
        ['台球畅玩2小时券', '美式球台 · 需提前预约', 79, 'billiards-2.png', 428],
      ],
    },
  },
  flights: [
    { id: 'ZH9327', airline: '深圳航空', model: '空客 A320', start: '06:25', end: '08:35', duration: '2小时10分', from: '宝安T3', to: '江北T3', price: 603, direct: true },
    { id: 'CZ3455', airline: '南方航空', model: '波音 737-800', start: '09:40', end: '12:05', duration: '2小时25分', from: '宝安T3', to: '江北T3', price: 638, direct: true },
    { id: 'MF8382', airline: '厦门航空', model: '波音 737-800', start: '20:20', end: '23:55', duration: '3小时35分', from: '宝安T3', to: '江北T3', price: 558, direct: false },
  ],
  rides: [
    { id: 'comfort', name: '舒适型', car: '比亚迪汉EV', wait: '约8分钟', seats: '可乘4人', price: 86, icon: '🚙' },
    { id: 'business', name: '商务型', car: '别克GL8', wait: '约12分钟', seats: '可乘6人', price: 128, icon: '🚐' },
    { id: 'premium', name: '豪华型', car: '奔驰E级', wait: '约15分钟', seats: '可乘4人', price: 188, icon: '🚘' },
  ],
};
