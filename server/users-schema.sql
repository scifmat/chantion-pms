-- 第 9 步：用户系统与权限控制
-- 单一定义源：由 migrate.js 的 008 执行，CREATE TABLE IF NOT EXISTS 幂等。
-- 密码只存 bcryptjs 哈希，任何接口都不返回 password_hash。
-- role: admin（全局唯一，系统初始化生成，不开放注册）/ user（管理员创建）。
-- pwd_version: 改密或重置密码后 +1，并写入 JWT（pv 声明），用于让旧 Token 立即失效。

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  pwd_version   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  last_login_at TEXT    NOT NULL DEFAULT ''
);

-- 管理员全局唯一：部分唯一索引保证任何时刻最多只有一个 admin 行。
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_admin ON users(role) WHERE role = 'admin';
