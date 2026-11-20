const express = require('express');
const { db } = require('../db');
const { authenticate, changePassword, publicUser, getRawById } = require('../users');
const { sign, requireLogin } = require('../auth');

const router = express.Router();

// POST /api/auth/login —— 公开：校验账号密码，成功签发 JWT
router.post('/login', (req, res) => {
  const username = String((req.body && req.body.username) || '').trim();
  const password = String((req.body && req.body.password) || '');
  if (!username || !password) {
    return res.status(400).json({ ok: false, message: '请输入用户名和密码' });
  }
  const row = authenticate(db, username, password);
  if (!row) return res.status(401).json({ ok: false, message: '用户名或密码不正确' });
  res.json({
    ok: true,
    data: { token: sign(row), user: publicUser(row) }
  });
});

// GET /api/auth/me —— 刷新页面后用 Token 恢复登录态
router.get('/me', requireLogin, (req, res) => {
  res.json({ ok: true, data: { user: publicUser(getRawById(db, req.user.id)) } });
});

// POST /api/auth/change-password —— 修改自己的密码；成功后签发新 Token（旧 Token 因 pv+1 失效）
router.post('/change-password', requireLogin, (req, res) => {
  const r = changePassword(
    db, req.user.id,
    (req.body && req.body.oldPassword) || '',
    (req.body && req.body.newPassword) || ''
  );
  if (r.error) return res.status(400).json({ ok: false, message: r.error });
  res.json({ ok: true, data: { token: sign(getRawById(db, req.user.id)) } });
});

module.exports = router;
