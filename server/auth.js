/**
 * 第 9 步：全局鉴权中间件。
 * 设计要点：只拦写操作（POST / PUT / PATCH / DELETE），所有 GET 一律放行供访客浏览。
 * 挂在 app.js 的 express.json() 之后、业务路由之前，因此现有四个业务路由文件零改动。
 *
 * 校验链路：解析 Bearer Token -> jwt.verify -> 查 users 核对 pwd_version（改密后旧 Token 立即失效）
 *          -> 挂 req.user = { id, username, role } -> 按路径映射检查最低角色。
 */
const jwt = require('jsonwebtoken');
const { db } = require('./db');
const { getRawById, ROLE_ADMIN } = require('./users');

const SECRET = process.env.JWT_SECRET || 'chantion-pms-dev-secret-change-me-in-production';
const EXPIRES = '12h';

// 写操作白名单：登录接口本身必须公开
const PUBLIC_WRITE = new Set(['/auth/login']);

function sign(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, pv: user.pwd_version || 0 },
    SECRET,
    { expiresIn: EXPIRES }
  );
}

/** 解析并校验 Token；失败返回 null，绝不抛异常打断请求 */
function parseUser(token) {
  let payload;
  try { payload = jwt.verify(token, SECRET); }
  catch (e) { return null; }
  if (!payload || !payload.sub) return null;
  const row = getRawById(db, payload.sub);
  if (!row) return null;
  // 密码变更/重置后 pwd_version +1，旧 Token 立刻作废
  if (Number(payload.pv || 0) !== Number(row.pwd_version || 0)) return null;
  // 角色以库里为准，防止 Token 里的旧角色越权
  return { id: row.id, username: row.username, role: row.role };
}

/** 前置：尝试解析 Token 并挂 req.user；无 Token / 解析失败都不拦截，交给后续判断 */
function attachUser(req, res, next) {
  req.user = null;
  const header = String(req.headers.authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (m) req.user = parseUser(m[1].trim());
  next();
}

/** 路径 -> 最低角色。集中在此，业务路由无需感知鉴权 */
function requiredRole(path) {
  if (PUBLIC_WRITE.has(path)) return null;         // 公开
  if (path.indexOf('/users') === 0) return ROLE_ADMIN;   // 用户管理：仅管理员
  if (path.indexOf('/config') === 0) return ROLE_ADMIN;  // 业务配置写操作：仅管理员
  return 'user';                                   // 项目 / 档案等：登录即可（user 或 admin）
}

function unauthorized(res) {
  return res.status(401).json({ ok: false, message: '登录状态已失效，请重新登录' });
}
function forbidden(res) {
  return res.status(403).json({ ok: false, message: '没有权限执行此操作' });
}

/** 全局写操作守卫：未登录 401，角色不足 403 */
function guardWrite(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].indexOf(req.method) >= 0) return next();
  const need = requiredRole(req.path);
  if (need === null) return next();                       // 白名单
  if (!req.user) return unauthorized(res);
  if (need === ROLE_ADMIN && req.user.role !== ROLE_ADMIN) return forbidden(res);
  next();
}

/** 路由级守卫（用户管理路由内二次防御） */
function requireAdmin(req, res, next) {
  if (!req.user) return unauthorized(res);
  if (req.user.role !== ROLE_ADMIN) return forbidden(res);
  next();
}
function requireLogin(req, res, next) {
  if (!req.user) return unauthorized(res);
  next();
}

module.exports = { sign, attachUser, guardWrite, requireAdmin, requireLogin, SECRET, EXPIRES };
