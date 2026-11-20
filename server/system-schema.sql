-- 第 16 步：系统级键值对设置（单一值，区别于 config_options 的下拉选项列表）
-- 由 migrate.js 的 009 幂等执行；全新库与已有库共用同一份 DDL。
-- 本企业标识用 competitors.is_self（009 补列）+ 部分唯一索引约束全局最多一条。

CREATE TABLE IF NOT EXISTS system_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_competitors_self
  ON competitors(is_self) WHERE is_self = 1;
