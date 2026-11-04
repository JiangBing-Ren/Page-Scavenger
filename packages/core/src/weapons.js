// 武器注册表。这是「框架」：定义每种武器的身份、输入方式与实现状态。
// 新增武器时需要：
//   1. 在这里补一条定义（implemented: false → true）
//   2. 在 engine 里按 input 类型接对应输入（drag / click / hold / drop）
//   3. 实现它的命中与表现，复用 spawnDOMFragments / reslicePiece / spawnSparks
//
// input 约定：
//   drag  —— 按住左键拖动（贯穿判定）
//   click —— 单击触发一次
//   hold  —— 按住持续生效（射速/光束）
//   drop  —— 点击放置或投掷，落地/延时后生效

export const WEAPONS = Object.freeze([
  {
    id: 'blade',
    name: '刀',
    group: 'melee',
    input: 'drag',
    implemented: true,
    desc: '按住左键划过，贯穿后切断。当前版本唯一的武器。',
  },
  {
    id: 'spear',
    name: '枪',
    group: 'melee',
    input: 'drag',
    implemented: false,
    desc: '直线突刺，一次刺穿路径上的所有目标。',
  },
  {
    id: 'sword',
    name: '剑',
    group: 'melee',
    input: 'drag',
    implemented: false,
    desc: '更宽的挥砍，覆盖扇形范围而非一条线。',
  },
  {
    id: 'cannon',
    name: '炮',
    group: 'heavy',
    input: 'click',
    implemented: true,
    desc: '点击处产生范围爆破，按半径摧毁目标。',
  },
  {
    id: 'pistol',
    name: '手枪',
    group: 'gun',
    input: 'click',
    implemented: true,
    desc: '单发点射，只打中光标下的一个目标，留下小洞。',
  },
  {
    id: 'machinegun',
    name: '机枪',
    group: 'gun',
    input: 'hold',
    implemented: false,
    desc: '按住连续射击，射速与散布可调。',
  },
  {
    id: 'laser',
    name: '激光炮',
    group: 'heavy',
    input: 'hold',
    implemented: false,
    desc: '持续光束，沿光标扫过的路径切割。',
  },
  {
    id: 'grenade',
    name: '手雷',
    group: 'throwable',
    input: 'drop',
    implemented: false,
    desc: '投掷后延时爆炸，范围摧毁。',
  },
  {
    id: 'shell',
    name: '榴弹',
    group: 'throwable',
    input: 'drop',
    implemented: false,
    desc: '抛射后弹跳，落地触发爆炸。',
  },
  {
    id: 'snake',
    name: '贪吃蛇',
    group: 'special',
    input: 'drag',
    implemented: false,
    desc: '沿路径吞噬元素，越长越难控制。',
  },
  {
    id: 'blackhole',
    name: '黑洞',
    group: 'special',
    input: 'drop',
    implemented: false,
    desc: '放置后持续吸附并销毁周围元素。',
  },
]);

export const WEAPON_GROUPS = Object.freeze({
  melee: '近战',
  gun: '枪械',
  heavy: '重火力',
  throwable: '投掷物',
  special: '特殊',
});

export function getWeapon(id) {
  for (const weapon of WEAPONS) {
    if (weapon.id === id) return weapon;
  }
  return null;
}

export function implementedWeapons() {
  return WEAPONS.filter((weapon) => weapon.implemented);
}

// 爆破采样点：圆心 + 一圈环点。用于在点击处收集范围内的目标，
// 避免遍历整棵 DOM。返回 [{ x, y }]。
export function blastSamplePoints(cx, cy, radius, ringCount) {
  const count = Math.max(4, Math.floor(Number(ringCount) || 8));
  const r = Math.max(0, Number(radius) || 0);
  const points = [{ x: cx, y: cy }];

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    points.push({
      x: cx + Math.cos(angle) * r * 0.7,
      y: cy + Math.sin(angle) * r * 0.7,
    });
  }

  return points;
}
