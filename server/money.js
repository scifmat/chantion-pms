/**
 * 金额换算（防坑 K-1 / 需求 10.1、10.2 / 第 7 步业务配置）：
 *  - setAmountUnits：单位 -> 换算到「元」的倍率由业务配置表驱动（内置元/万元/亿元保底），
 *    支持任意正整数倍率，后续扩展单位无需改代码。
 *  - normalizeAmount：把「带单位金额」精确换算成「元」十进制文本（BigInt 定点，不经浮点），
 *    再由 yuanToFen 得出整数分。纯数字默认单位为「元」。
 *  - 元值保留全部小数位，不截断；只有整数分才四舍五入到分。
 *
 * 例：2553.23万元      -> yuan "25532300"      / fen 2553230000
 *     2553.2333333万元 -> yuan "25532333.333" / fen 2553233333
 *     10000            -> yuan "10000"        / fen 1000000
 */
let AMOUNT_UNITS = { '元': 1, '万元': 10000, '亿元': 100000000 };
let AMOUNT_PATTERN = '亿元|万元|元';

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function rebuildPattern() {
  // 长单位优先，避免「万元」被「元」抢先匹配
  AMOUNT_PATTERN = Object.keys(AMOUNT_UNITS)
    .sort(function (a, b) { return b.length - a.length })
    .map(escapeRe).join('|');
}

function setAmountUnits(map) {
  const next = { '元': 1, '万元': 10000, '亿元': 100000000 };   // 内置保底，配置不能把单位清空
  if (map && typeof map === 'object') {
    Object.keys(map).forEach(function (k) {
      const name = String(k).trim();
      const f = Number(map[k]);
      if (name && Number.isSafeInteger(f) && f > 0) next[name] = f;
    });
  }
  AMOUNT_UNITS = next;
  rebuildPattern();
}
function getAmountUnits() { return Object.assign({}, AMOUNT_UNITS); }

// 十进制字符串 × 任意正整数倍率：BigInt 定点运算，小数位如实保留
function scaleDecimal(s, factor) {
  const parts = s.split('.');
  const dec = parts[1] || '';
  const scale = 10n ** BigInt(dec.length);
  const n = BigInt(parts[0]) * scale + BigInt(dec || '0');
  const prod = n * BigInt(factor);
  const intPart = prod / scale;
  const rem = prod % scale;
  if (rem === 0n) return intPart.toString();
  return intPart.toString() + '.' + rem.toString().padStart(dec.length, '0').replace(/0+$/, '');
}

function yuanToFen(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const parts = s.split('.');
  const intPart = parts[0];
  const dec = parts[1] || '';
  if (dec.length === 0) return Number(BigInt(intPart) * 100n);
  const frac = BigInt(dec);
  const pow = 10n ** BigInt(dec.length);
  const numerator = frac * 100n;
  let fen = BigInt(intPart) * 100n + numerator / pow;
  if ((numerator % pow) * 2n >= pow) fen += 1n;
  return Number(fen);
}

// 返回 { yuan: '元'的精确文本, fen: 整数分, unit }；无法识别返回 null
function normalizeAmount(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/,/g, '');
  if (!s) return null;
  const m = new RegExp('^(\\d+(?:\\.\\d+)?)\\s*(' + AMOUNT_PATTERN + ')?$').exec(s);
  if (!m) return null;
  const unit = m[2] || '元';
  const yuan = scaleDecimal(m[1], AMOUNT_UNITS[unit] || 1);
  return { yuan: yuan, fen: yuanToFen(yuan), unit: unit };
}

module.exports = { yuanToFen, normalizeAmount, scaleDecimal, setAmountUnits, getAmountUnits };
