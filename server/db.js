const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const Database = require('better-sqlite3');

// 环境变量只在入口处读取，不散落在业务代码里（防坑 K-7）
dotenv.config({ path: path.join(__dirname, '.env') });

const rawPath = process.env.DB_PATH || './data/chantion.db';
const dbPath = path.isAbsolute(rawPath) ? rawPath : path.join(__dirname, rawPath);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');      // 多人同时读写更稳
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

// 建表 + 幂等迁移：全新库按 schema.sql 建全字段；已有库只补缺列，数据不丢（防坑 K-11）
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);
require('./migrate').runMigrations(db);

// 统一时间口径：年-月-日 时:分:秒 文本，不存带时区时间戳（防坑 K-5）
function nowText() {
  return new Date().toLocaleString('sv-SE', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    hour12: false
  });
}

module.exports = { db, dbPath, nowText };
