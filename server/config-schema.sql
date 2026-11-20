-- 第 7 步：业务配置项（可配置下拉选项）集中维护
-- 单一定义源：由 migrate.js 的 005 执行，CREATE TABLE IF NOT EXISTS 幂等。
-- enabled=0 表示「停用」而非删除：历史项目原值保留，且查询仍可按关键字检索。
-- extra 存 JSON，金额单位组用它保存换算到「元」的倍率 factor。

CREATE TABLE IF NOT EXISTS config_options (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  group_key    TEXT    NOT NULL,
  option_value TEXT    NOT NULL,
  sort_no      INTEGER NOT NULL DEFAULT 0,
  enabled      INTEGER NOT NULL DEFAULT 1,
  extra        TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL,
  UNIQUE (group_key, option_value)
);
