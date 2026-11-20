// 系统级设置：system_settings 键值对 + competitors.is_self 唯一标记 + Logo 文件
// 只读接口对访客开放（左上角系统名/Logo 要显示），写操作由路由层 requireAdmin 二次防御。
const fs = require('fs');
const path = require('path');
// 不 require('./db')：db.js 启动时会 require migrate.js -> settings.js，避免循环依赖拿到半初始化导出。
function nowText() {
  return new Date().toLocaleString('sv-SE', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    hour12: false
  });
}

const KEY_SYSTEM_NAME = 'system_name';
const KEY_SELF_ID = 'self_competitor_id';
const KEY_LOGO_ENABLED = 'logo_enabled';
const KEY_LOGO_MIME = 'logo_mime';
const KEY_LOGO_VERSION = 'logo_version';
const DEFAULT_SYSTEM_NAME = 'ChanTion-PMS';
const LOGO_FILE = path.join(__dirname, 'data', 'system-logo');
const LOGO_MAX_BYTES = 512 * 1024;
const LOGO_MIMES = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  webp: 'image/webp'
};

function rawValue(db, key) {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
  return row ? String(row.value || '') : '';
}

/** 对外统一结构；企业名称从 competitors 派生，避免两处名称不一致 */
function getSettings(db) {
  const systemName = rawValue(db, KEY_SYSTEM_NAME) || DEFAULT_SYSTEM_NAME;
  const id = Number(rawValue(db, KEY_SELF_ID) || 0) || 0;
  let selfCompetitorId = 0;
  let selfCompetitorName = '';
  if (id > 0) {
    const row = db.prepare('SELECT id, name FROM competitors WHERE id = ?').get(id);
    if (row) {
      selfCompetitorId = row.id;
      selfCompetitorName = row.name;
    }
  }
  const logoEnabled = rawValue(db, KEY_LOGO_ENABLED) === '1';
  const logoMime = rawValue(db, KEY_LOGO_MIME) || '';
  return {
    systemName: systemName,
    companyName: selfCompetitorName,
    selfCompetitorId: selfCompetitorId,
    selfCompetitorName: selfCompetitorName,
    hasCustomLogo: logoEnabled && !!logoMime && fs.existsSync(LOGO_FILE),
    logoMime: logoMime,
    logoVersion: rawValue(db, KEY_LOGO_VERSION) || '0'
  };
}

/** 迁移末尾调用：只补缺失项，绝不覆盖管理员已保存的值 */
function seedSystemSettings(db) {
  const t = nowText();
  const ins = db.prepare('INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)');
  const a = ins.run(KEY_SYSTEM_NAME, DEFAULT_SYSTEM_NAME, t);
  const b = ins.run(KEY_SELF_ID, '0', t);
  const c = ins.run(KEY_LOGO_ENABLED, '0', t);
  const d = ins.run(KEY_LOGO_MIME, '', t);
  const e = ins.run(KEY_LOGO_VERSION, '0', t);
  return a.changes + b.changes + c.changes + d.changes + e.changes;
}

/** 管理员保存：同一事务内清基准标记 + 设置新本企业 + 写设置项 */
function updateSettings(db, body) {
  const name = String((body && body.systemName) == null ? '' : body.systemName).trim();
  if (!name) return { error: '系统名称不能为空' };
  if (Array.from(name).length > 40) return { error: '系统名称不能超过 40 个字符' };

  const raw = body && Object.prototype.hasOwnProperty.call(body, 'selfCompetitorId')
    ? body.selfCompetitorId : 0;
  let selfId = 0;
  const rawText = raw === null || raw === undefined ? '' : String(raw).trim();
  // 0 / 空字符串 / null 都表示「取消本企业设置」，不是非法 id
  if (rawText && rawText !== '0') {
    selfId = Number(rawText);
    if (!Number.isInteger(selfId) || selfId < 0) return { error: '所属企业不存在' };
    if (selfId > 0 && !db.prepare('SELECT id FROM competitors WHERE id = ?').get(selfId)) return { error: '所属企业不存在' };
  }

  const save = db.transaction(function () {
    db.prepare('UPDATE competitors SET is_self = 0 WHERE is_self = 1').run();
    if (selfId > 0) db.prepare('UPDATE competitors SET is_self = 1 WHERE id = ?').run(selfId);
    const upsert = db.prepare(
      'INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    );
    upsert.run(KEY_SYSTEM_NAME, name, nowText());
    upsert.run(KEY_SELF_ID, String(selfId), nowText());
    return getSettings(db);
  });
  return { data: save() };
}

function upsertSetting(db, key, value) {
  db.prepare(
    'INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  ).run(key, String(value), nowText());
}

function validImage(ext, buf) {
  if (ext === 'png') return buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG';
  if (ext === 'jpeg' || ext === 'jpg') return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (ext === 'webp') return buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

/** 上传 Logo：JSON data URL，避免额外 multipart 依赖；文件统一落在 data/system-logo */
function setLogo(db, dataUrl) {
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!m) return { error: 'Logo 仅支持 PNG / JPG / WebP 图片' };
  const ext = m[1].toLowerCase();
  const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (!buf.length) return { error: 'Logo 文件内容为空' };
  if (buf.length > LOGO_MAX_BYTES) return { error: 'Logo 不能超过 512KB' };
  if (!validImage(ext, buf)) return { error: 'Logo 文件内容与图片格式不符' };
  fs.mkdirSync(path.dirname(LOGO_FILE), { recursive: true });
  const tmp = LOGO_FILE + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, LOGO_FILE);
  const version = String(Date.now());
  const save = db.transaction(function () {
    upsertSetting(db, KEY_LOGO_ENABLED, '1');
    upsertSetting(db, KEY_LOGO_MIME, LOGO_MIMES[ext]);
    upsertSetting(db, KEY_LOGO_VERSION, version);
    return getSettings(db);
  });
  return { data: save() };
}

/** 恢复系统内置 Logo */
function resetLogo(db) {
  try { fs.unlinkSync(LOGO_FILE); } catch (e) { if (e.code !== 'ENOENT') return { error: '删除 Logo 文件失败' }; }
  const save = db.transaction(function () {
    upsertSetting(db, KEY_LOGO_ENABLED, '0');
    upsertSetting(db, KEY_LOGO_MIME, '');
    upsertSetting(db, KEY_LOGO_VERSION, String(Date.now()));
    return getSettings(db);
  });
  return { data: save() };
}

function readLogo(db) {
  const s = getSettings(db);
  if (!s.hasCustomLogo) return null;
  return { mime: s.logoMime, buffer: fs.readFileSync(LOGO_FILE) };
}

module.exports = {
  getSettings, seedSystemSettings, updateSettings,
  setLogo, resetLogo, readLogo,
  DEFAULT_SYSTEM_NAME, KEY_SYSTEM_NAME, KEY_SELF_ID
};
