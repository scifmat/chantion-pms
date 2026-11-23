/**
 * 用户系统与权限控制的纯数据层。
 * 只依赖 better-sqlite3 模块本身，不 require ./db，避免 db -> migrate -> users -> db 循环。
 * 所有密码只以 bcryptjs 哈希落库；对外函数一律不返回 password_hash。
 */
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;
const ROLE_ADMIN = 'admin';
const ROLE_USER = 'user';

function nowText() {
  return new Date().toLocaleString('sv-SE', { timeZone: process.env.TZ || 'Asia/Shanghai', hour12: false });
}
function text(v) { return String(v == null ? '' : v).trim(); }

function hashPassword(plain) { return bcrypt.hashSync(String(plain == null ? '' : plain), SALT_ROUNDS); }
function verifyPassword(plain, hash) {
  try { return bcrypt.compareSync(String(plain == null ? '' : plain), String(hash || '')); }
  catch (e) { return false; }
}

/** 供 JWT 校验：取当前用户（含哈希与版本），只用于服务端内部 */
function getRawById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
}
function getRawByUsername(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(text(username));
}

/** 对外安全视图：绝不带 password_hash */
function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at || ''
  };
}

/** 首次启动生成唯一管理员：已存在则什么都不做（改过的密码不会被覆盖） */
function seedAdmin(db) {
  const n = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
  if (n > 0) return 0;
  const username = text(process.env.ADMIN_USER) || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const now = nowText();
  db.prepare(
    'INSERT INTO users (username, password_hash, role, pwd_version, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)'
  ).run(username, hashPassword(password), ROLE_ADMIN, now, now);
  console.log('[SEED 008] admin account created: ' + username + ' (default password, change it after login)');
  return 1;
}

/** 登录校验：成功返回带哈希的原始行（由路由据此签发 JWT），失败返回 null */
function authenticate(db, username, password) {
  const row = getRawByUsername(db, username);
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowText(), row.id);
  return row;
}

function listUsers(db) {
  // 全局默认排序：最近更新的用户在前；同秒更新用 id 兜底
  return db.prepare('SELECT id, username, role, created_at, updated_at, last_login_at FROM users ORDER BY updated_at DESC, id DESC').all();
}

function validateUsername(username) {
  const u = text(username);
  if (u.length < 2 || u.length > 32) return '用户名长度须为 2 到 32 个字符';
  return null;
}
function validatePassword(password) {
  const p = String(password == null ? '' : password);
  if (p.length < 6 || p.length > 128) return '密码长度须为 6 到 128 个字符';
  return null;
}

/** 管理员创建用户；role 只允许 user（管理员全局唯一，不开放注册） */
function createUser(db, payload) {
  const username = text(payload && payload.username);
  const password = String((payload && payload.password) || '');
  const role = text(payload && payload.role) || ROLE_USER;
  if (validateUsername(username)) return { error: validateUsername(username) };
  if (validatePassword(password)) return { error: validatePassword(password) };
  if (role !== ROLE_USER) return { error: '角色只能是普通用户（管理员全局唯一，不可创建）' };
  if (getRawByUsername(db, username)) return { error: '用户名已存在', conflict: true };
  const now = nowText();
  try {
    const info = db.prepare(
      'INSERT INTO users (username, password_hash, role, pwd_version, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)'
    ).run(username, hashPassword(password), ROLE_USER, now, now);
    return { data: publicUser(getRawById(db, info.lastInsertRowid)) };
  } catch (e) {
    return { error: '用户名已存在', conflict: true };
  }
}

/** 修改自己的密码：校验旧密码，成功后 pwd_version + 1 使旧 Token 失效 */
function changePassword(db, id, oldPassword, newPassword) {
  const row = getRawById(db, id);
  if (!row) return { error: '用户不存在', notFound: true };
  if (!verifyPassword(oldPassword, row.password_hash)) return { error: '原密码不正确' };
  const err = validatePassword(newPassword);
  if (err) return { error: err };
  if (verifyPassword(newPassword, row.password_hash)) return { error: '新密码不能与原密码相同' };
  db.prepare('UPDATE users SET password_hash = ?, pwd_version = pwd_version + 1, updated_at = ? WHERE id = ?')
    .run(hashPassword(newPassword), nowText(), row.id);
  return { data: { changed: true } };
}

/** 管理员重置他人密码：同样 pwd_version + 1 */
function resetPassword(db, id, newPassword) {
  const row = getRawById(db, id);
  if (!row) return { error: '用户不存在', notFound: true };
  if (row.role === ROLE_ADMIN) return { error: '不能重置管理员密码，请使用管理员自己的「修改密码」' };
  const err = validatePassword(newPassword);
  if (err) return { error: err };
  db.prepare('UPDATE users SET password_hash = ?, pwd_version = pwd_version + 1, updated_at = ? WHERE id = ?')
    .run(hashPassword(newPassword), nowText(), row.id);
  return { data: { reset: true } };
}

/** 删除用户：管理员与普通用户本人均不可删 */
function deleteUser(db, id) {
  const row = getRawById(db, id);
  if (!row) return { error: '用户不存在', notFound: true };
  if (row.role === ROLE_ADMIN) return { error: '管理员账号不可删除' };
  db.prepare('DELETE FROM users WHERE id = ?').run(row.id);
  return { data: { deleted: true } };
}

module.exports = {
  ROLE_ADMIN, ROLE_USER, SALT_ROUNDS,
  hashPassword, verifyPassword, seedAdmin, authenticate,
  listUsers, publicUser, createUser, changePassword, resetPassword, deleteUser,
  getRawById
};
