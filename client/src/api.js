// 统一走 /api 前缀：开发时由 Vite 代理转发到后端，生产时与页面同源。
// 页面上永远不出现后端地址，避免跨域与地址写死（防坑 K-7 / 方案 5.1）。
import { auth, clearSession, showLogin } from './store/auth.js'
import { bumpDataVersion } from './store/dataVersion.js'
import { toastError } from './utils/toast.js'

async function request(path, options = {}) {
  // silent401：刷新页面校验会话时用，失败只抛错不弹全局登录框（由调用方静默清态）
  const { silent401, ...fetchOptions } = options
  const headers = { 'Content-Type': 'application/json' }
  if (auth.token) headers['Authorization'] = 'Bearer ' + auth.token
  if (fetchOptions.headers) Object.assign(headers, fetchOptions.headers)
  const res = await fetch('/api' + path, { ...fetchOptions, headers })
  let data = {}
  try { data = await res.json() } catch (e) { data = {} }
  if (!res.ok || !data.ok) {
    // 401 统一处理：清登录态 + 唤起登录框。登录接口自身的 401（账号/密码错）除外，
    // 且 silent401 场景（页面刷新静默校验）交给调用方处理。
    // 注意：此处只对 401 生效，409 并发冲突 / 500 异常的错误对象结构完全不变，
    // 各视图依赖的 err.message / err.status / err.fields 均原样抛出，不会被误伤。
    if (res.status === 401 && path !== '/auth/login' && !silent401) {
      clearSession()
      showLogin.value = true
    }
    const err = new Error(data.message || ('请求失败（' + res.status + '）'))
    err.status = res.status
    err.fields = data.fields || []
    throw err
  }
  // 项目 / 档案 / 回收站的写操作成功后统一递增全局版本号：
  // 常驻页面（如档案页）watch 它即可静默刷新引用数，不必重新挂载组件。
  const method = String(fetchOptions.method || 'GET').toUpperCase();
  const purePath = String(path || '').split('?')[0];
  if (method !== 'GET' && /^\/(projects|archives|recycle)(\/|$)/.test(purePath)) bumpDataVersion();
  return data.data
}

const QUERY_KEYS = ['status', 'name', 'region', 'timeStart', 'timeEnd']

// 首页普通查询：只把有值的条件拼进查询字符串，空条件不传给后端
export function getProjects(params = {}) {
  const q = new URLSearchParams()
  QUERY_KEYS.forEach(function (k) {
    const v = params[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') q.set(k, String(v).trim())
  })
  const s = q.toString()
  return request('/projects' + (s ? '?' + s : ''))
}

/**
 * 通用文件流下载（Excel 导出底座）：带 Token 的 POST -> Blob -> 触发浏览器下载。
 * 与 request() 分离：request() 强制 res.json()，无法处理二进制文件流。
 *
 * 重点处理：
 *  - 401 Token 过期：清登录态 + 唤起登录框（与 request() 同口径），并弹 Toast 告知
 *  - 非 2xx 错误：响应体是 JSON（不是文件），解析出 message 弹 Toast 并抛错
 *  - 截断提示：读 X-Export-Truncated / X-Export-Matched 响应头，返回给调用方展示
 *  - 文件名：优先取 Content-Disposition（RFC5987），回退到传入 filename
 *
 * @param {object} payload { queryType, conditions, fields, filename }
 * @returns {Promise<{truncated:boolean, matched:number, rows:number}>}
 */
/** 拉取导出字段字典（后端权威来源，前端只渲染） */
export function getExportFields(queryType) {
  return request('/export/fields?queryType=' + encodeURIComponent(queryType || 'advanced'))
}

export async function downloadExcel(payload) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth.token) headers['Authorization'] = 'Bearer ' + auth.token

  let res
  try {
    res = await fetch('/api/export/excel', {
      method: 'POST', headers, body: JSON.stringify(payload || {})
    })
  } catch (e) {
    toastError('网络异常，导出失败：' + (e.message || '请检查网络'))
    throw e
  }

  // 二进制响应里的错误分支：解析错误 JSON，弹 Toast，401 额外清态唤起登录框
  if (!res.ok) {
    let data = {}
    try { data = await res.json() } catch (e) { data = {} }
    if (res.status === 401) {
      clearSession()
      showLogin.value = true
      toastError('登录已过期，请重新登录后再导出')
    } else {
      toastError(data.message || ('导出失败（' + res.status + '）'))
    }
    const err = new Error(data.message || ('导出失败（' + res.status + '）'))
    err.status = res.status
    throw err
  }

  // 成功：读响应头 -> Blob -> 触发下载
  const truncated = res.headers.get('X-Export-Truncated') === '1'
  const matched = Number(res.headers.get('X-Export-Matched') || 0)
  const rows = Number(res.headers.get('X-Export-Rows') || 0)

  let filename = (payload && payload.filename) || '导出数据'
  const disp = res.headers.get('Content-Disposition') || ''
  const m = /filename\*=UTF-8''([^;]+)/i.exec(disp)
  if (m) {
    try { filename = decodeURIComponent(m[1]) } catch (e) { /* 保留回退名 */ }
  }
  if (!/\.xlsx$/i.test(filename)) filename += '.xlsx'

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 延迟释放，避免部分浏览器在 click 尚未开始时 URL 已失效
  setTimeout(function () { URL.revokeObjectURL(url) }, 1500)

  return { truncated, matched, rows }
}

// 第 5 步高级查询：金额参数已是「整数分」字符串（前端 BigInt 换算），
// type / winner 允许逗号分隔多个关键字，后端在同一字段内按 OR 处理。
export const ADV_QUERY_KEYS = [
  'status', 'type', 'region', 'no', 'name', 'buyer', 'agency', 'method', 'period',
  'bidFrom', 'bidTo', 'winner',
  'budgetMinFen', 'budgetMaxFen', 'ceilingMinFen', 'ceilingMaxFen', 'amountMinFen', 'amountMaxFen'
]

export function advancedQuery(params = {}) {
  const q = new URLSearchParams()
  ADV_QUERY_KEYS.forEach(function (k) {
    const v = params[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') q.set(k, String(v).trim())
  })
  const s = q.toString()
  return request('/projects/advanced' + (s ? '?' + s : ''))
}

// 第 6 步独立信息档案：候选搜索（signal 用于 AbortController 取消过期请求）
// exact=true 时按 name_norm 精确命中，供「选中单位名称后」的关联字段焦点候选使用
export function searchArchives(type, q, signal, exact = false) {
  const u = new URLSearchParams()
  u.set('type', type)
  u.set('q', String(q == null ? '' : q).trim())
  if (exact) u.set('exact', '1')
  return request('/archives/search?' + u.toString(), signal ? { signal: signal } : {})
}

// 只读档案列表页（含引用次数）
export function getArchives(type, q = '', attribute = '') {
  const u = new URLSearchParams()
  u.set('type', type)
  const s = String(q == null ? '' : q).trim()
  const a = String(attribute == null ? '' : attribute).trim()
  if (s) u.set('q', s)
  if (a) u.set('attribute', a)
  return request('/archives?' + u.toString())
}

// 档案编辑：名称改动会由后端在同一事务内同步所有关联项目
export function updateArchive(type, id, payload) {
  return request('/archives/' + encodeURIComponent(type) + '/' + encodeURIComponent(id), {
    method: 'PUT', body: JSON.stringify(payload)
  })
}

// 档案删除：后端严格校验引用数，被引用时返回 409 并给出提示
export function deleteArchive(type, id) {
  return request('/archives/' + encodeURIComponent(type) + '/' + encodeURIComponent(id), {
    method: 'DELETE'
  })
}

// 第 16 步系统配置：GET 公开（ Logo 需要），PUT 仅管理员
export function getSystemSettings() {
  return request('/system/settings', { silent401: true })
}
export function saveSystemSettings(payload) {
  return request('/system/settings', { method: 'PUT', body: JSON.stringify(payload) })
}
export function uploadSystemLogo(dataUrl) {
  return request('/system/logo', { method: 'PUT', body: JSON.stringify({ dataUrl }) })
}
export function resetSystemLogo() {
  return request('/system/logo', { method: 'DELETE' })
}

// 第 7 步业务配置：读取全部选项 + 金额单位倍率；保存某一分组
export function getConfigOptions() {
  return request('/config/options')
}
export function saveConfigOptions(group, items) {
  return request('/config/options/' + encodeURIComponent(group), { method: 'PUT', body: JSON.stringify({ items: items }) })
}

// 编辑回显：单条完整项目（含全量表单 detail 与 version）
export function getProject(id) {
  return request('/projects/' + id)
}

export function createProject(payload) {
  return request('/projects', { method: 'POST', body: JSON.stringify(payload) })
}

// 保存编辑：payload 内必须带 version，服务端据此做并发防覆盖（K-3）
export function updateProject(id, payload) {
  return request('/projects/' + id, { method: 'PUT', body: JSON.stringify(payload) })
}

// 第 8 步：软删除（同样带 version 防并发覆盖，服务端在同一事务内写操作记录）
export function deleteProject(id, version) {
  return request('/projects/' + id, { method: 'DELETE', body: JSON.stringify({ version: version }) })
}

// 011 回收站：列表 / 恢复 / 彻底删除（彻底删除仅管理员，后端二次校验）
export function getRecycleItems(params = {}) {
  const u = new URLSearchParams()
  Object.keys(params).forEach(function (k) {
    const v = params[k]
    if (v !== '' && v !== null && v !== undefined) u.set(k, String(v))
  })
  return request('/recycle?' + u.toString())
}
export function restoreRecycleItem(type, id) {
  return request('/recycle/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '/restore', { method: 'POST' })
}
export function purgeRecycleItem(type, id) {
  return request('/recycle/' + encodeURIComponent(type) + '/' + encodeURIComponent(id), { method: 'DELETE' })
}

// 第 8 步：只读操作记录（事件级）
// 操作类型下拉：从后端取所有实际出现过的类型，自动跟随数据（含系统设置等非项目操作）
export function getOperationLogTypes() {
  return request('/operation-logs/types')
}

export function getOperationLogs(params = {}) {
  const q = new URLSearchParams()
  ;['type', 'no', 'keyword', 'from', 'to'].forEach(function (k) {
    const v = params[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') q.set(k, String(v).trim())
  })
  const s = q.toString()
  return request('/operation-logs' + (s ? '?' + s : ''))
}

// 第 9 步：用户系统与权限控制 ------------------------------------------------
export function login(username, password) {
  return request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
}
export function getMe() {
  return request('/auth/me', { silent401: true })
}
export function changePassword(oldPassword, newPassword) {
  return request('/auth/change-password', {
    method: 'POST', body: JSON.stringify({ oldPassword, newPassword })
  })
}
export function getUsers() {
  return request('/users')
}
export function createUser(payload) {
  return request('/users', { method: 'POST', body: JSON.stringify(payload) })
}
export function resetUserPassword(id, password) {
  return request('/users/' + encodeURIComponent(id) + '/reset-password', {
    method: 'POST', body: JSON.stringify({ password })
  })
}
export function deleteUser(id) {
  return request('/users/' + encodeURIComponent(id), { method: 'DELETE' })
}

// 第 17 步：系统级全局数据看板（战略驾驶舱）
export function getGlobalStats(year, refresh) {
  const q = new URLSearchParams()
  if (year) q.set('year', String(year))
  if (refresh) q.set('refresh', '1')
  const s = q.toString()
  return request('/global/stats' + (s ? '?' + s : ''))
}

// 第 10 步：参与项目数据看板（只读聚合）
export function getArchiveStats(type, id, year) {
  const q = year ? '?year=' + encodeURIComponent(year) : ''
  return request('/archives/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '/stats' + q)
}
