-- 第 8 步：独立操作记录（事件级：何时 / 谁 / 何项目 / 做了什么 / 摘要）
-- 单一定义源，由 migrate.js 的 006 执行，CREATE TABLE IF NOT EXISTS 幂等。
-- source_key 仅用于启动回填去重；事务内实时写入为 NULL（SQLite UNIQUE 允许多个 NULL）。
-- 本轮不做字段级 diff，详情不展示删除/清空记录，只在操作记录页查看。

CREATE TABLE IF NOT EXISTS operation_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_no   TEXT    NOT NULL,
  project_name TEXT    NOT NULL DEFAULT '',
  op_type      TEXT    NOT NULL,
  summary      TEXT    NOT NULL DEFAULT '',
  operator     TEXT    NOT NULL DEFAULT '当前操作人',
  source_key   TEXT,
  created_at   TEXT    NOT NULL,
  UNIQUE (source_key)
);
