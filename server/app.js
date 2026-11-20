const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const express = require('express');

dotenv.config({ path: path.join(__dirname, '.env') });

// 引入 db 即完成：读环境变量 -> 建目录 -> 打开/创建 SQLite -> 执行建表
const { dbPath } = require('./db');
const { attachUser, guardWrite } = require('./auth');
const projectsRouter = require('./routes/projects');
const archivesRouter = require('./routes/archives');
const statsRouter = require('./routes/stats');
const configRouter = require('./routes/config');
const operationLogsRouter = require('./routes/operationLogs');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const systemRouter = require('./routes/system');
const globalRouter = require('./routes/global');
const exportRouter = require('./routes/export');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

// JSON 请求体上限 2MB：Logo 以 data URL 上传，512KB 图片编码后约 700KB，
// Express 默认 100KB 会直接 413；其余接口仍由业务层做参数校验。
app.use(express.json({ limit: '2mb' }));
// 全局鉴权：先解析 Token（挂 req.user），再统一拦截写操作；业务路由零改动
app.use('/api', attachUser);
app.use('/api', guardWrite);
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/archives', archivesRouter);
app.use('/api/archives', statsRouter);   // 第 10 步：参与项目数据看板（只读聚合）
app.use('/api/config', configRouter);
app.use('/api/system', systemRouter);
app.use('/api/global', globalRouter);
app.use('/api/operation-logs', operationLogsRouter);
app.use('/api/export', exportRouter);

// 第 1 步为开发模式（Vite + Express 两个进程，靠代理打通）。
// 生产形态预留：一旦前端打包出 client/dist，同一个进程即可同源托管页面，天然无跨域。
const distDir = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res) => {
    // 未匹配的接口路径不要兜底成页面，避免前端拿到一段 HTML 却当成数据解析
    if (req.path.indexOf('/api/') === 0) {
      return res.status(404).json({ ok: false, message: '接口不存在' });
    }
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error('[ERROR]', err && err.message ? err.message : err);
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, message: '请求内容过大，Logo 不能超过 512KB' });
  }
  res.status(500).json({ ok: false, message: '服务内部错误' });
});

app.listen(PORT, HOST, () => {
  console.log('====================================================');
  console.log('  ChanTion-PMS  backend is READY');
  console.log('  API      : http://localhost:' + PORT + '/api/projects');
  console.log('  API      : http://localhost:' + PORT + '/api/archives');
  console.log('  Database : ' + dbPath);
  console.log('  Table    : projects + 4 archive tables + users (created / verified)');
  console.log('  Timezone : ' + (process.env.TZ || 'Asia/Shanghai'));
  console.log('====================================================');
});
