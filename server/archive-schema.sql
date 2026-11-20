-- 第 6 步：独立信息档案（只读，4 张表）
-- 单一定义源：db.js 与 migrate.js 的 004 都执行本文件，全部 CREATE TABLE IF NOT EXISTS，重复启动无副作用。
-- name_norm = 去所有空白 + 全半角归一 + 小写，与前端 validation.js 的 normPkg 同口径；表内 UNIQUE 去重。
-- 中标单位与竞争对手共用 competitors（用户已确认）；judges 额外存「组长 / 业主」两属性。

CREATE TABLE IF NOT EXISTS buyers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  name_norm         TEXT    NOT NULL UNIQUE,
  attribute         TEXT    NOT NULL DEFAULT '',
  phone             TEXT    NOT NULL DEFAULT '',
  email             TEXT    NOT NULL DEFAULT '',
  address           TEXT    NOT NULL DEFAULT '',
  source_project_no TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS agencies (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  name_norm         TEXT    NOT NULL UNIQUE,
  attribute         TEXT    NOT NULL DEFAULT '',
  phone             TEXT    NOT NULL DEFAULT '',
  email             TEXT    NOT NULL DEFAULT '',
  address           TEXT    NOT NULL DEFAULT '',
  source_project_no TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS competitors (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  name_norm         TEXT    NOT NULL UNIQUE,
  attribute         TEXT    NOT NULL DEFAULT '',
  phone             TEXT    NOT NULL DEFAULT '',
  email             TEXT    NOT NULL DEFAULT '',
  address           TEXT    NOT NULL DEFAULT '',
  source_project_no TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS judges (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  name_norm         TEXT    NOT NULL UNIQUE,
  leader            INTEGER NOT NULL DEFAULT 0,
  owner             INTEGER NOT NULL DEFAULT 0,
  source_project_no TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);
