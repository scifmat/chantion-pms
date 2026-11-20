const express = require('express');
const { db } = require('../db');
const { listUsers, createUser, resetPassword, deleteUser } = require('../users');
const { requireAdmin } = require('../auth');
const { writeLog } = require('../operation');

const router = express.Router();

// 二次防御：即使全局 guardWrite 被绕过，本组接口仍要求管理员
router.use(requireAdmin);

// GET /api/users —— 用户列表（不含密码哈希）
router.get('/', (req, res) => {
  res.json({ ok: true, data: listUsers(db) });
});

// POST /api/users —— 管理员创建普通用户
router.post('/', (req, res) => {
  const r = createUser(db, req.body);
  if (r.error) return res.status(r.conflict ? 409 : 400).json({ ok: false, message: r.error });
  writeLog(db, {
    project_no: 'system_user', project_name: '新增用户：' + r.data.username, op_type: '系统设置',
    operator: req.user && req.user.username, summary: '管理员创建用户（角色：普通用户）'
  });
  res.status(201).json({ ok: true, data: r.data });
});

// POST /api/users/:id/reset-password —— 重置普通用户密码
router.post('/:id/reset-password', (req, res) => {
  const target = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.id);
  const r = resetPassword(db, req.params.id, (req.body && req.body.password) || '');
  if (r.error) return res.status(r.notFound ? 404 : 400).json({ ok: false, message: r.error });
  writeLog(db, {
    project_no: 'system_user', project_name: '重置密码：' + (target ? target.username : req.params.id), op_type: '系统设置',
    operator: req.user && req.user.username, summary: '管理员重置用户密码，该用户旧登录态已失效（不记录新密码）'
  });
  res.json({ ok: true, data: r.data });
});

// DELETE /api/users/:id —— 删除普通用户
router.delete('/:id', (req, res) => {
  const target = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.id);
  const r = deleteUser(db, req.params.id);
  if (r.error) return res.status(r.notFound ? 404 : 400).json({ ok: false, message: r.error });
  writeLog(db, {
    project_no: 'system_user', project_name: '删除用户：' + (target ? target.username : req.params.id), op_type: '系统设置',
    operator: req.user && req.user.username, summary: '管理员删除用户，该用户无法再登录'
  });
  res.json({ ok: true, data: r.data });
});

module.exports = router;
