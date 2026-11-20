// 界面导航状态的本地持久化：让刷新后停留在原来的页面/子视图，而不是回到首页。
// 只存轻量的导航标识（current / view / dashboard），不存查询条件与结果（那些由各组件常驻管理）。
// 权限合法性由 App.vue 校验（本模块不依赖 auth，避免循环依赖）。
const STORAGE_KEY = 'chantion_ui_state'

function readUiState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return null
    return {
      current: typeof obj.current === 'string' ? obj.current : '',
      view: ['list', 'advanced', 'detail'].indexOf(obj.view) >= 0 ? obj.view : 'list',
      dashboard: obj.dashboard && typeof obj.dashboard === 'object' ? obj.dashboard : null
    }
  } catch (e) {
    return null
  }
}

function saveUiState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      current: state.current || '项目列表',
      view: state.view || 'list',
      dashboard: state.dashboard || null
    }))
  } catch (e) { /* 隐私模式下 localStorage 不可用时静默降级 */ }
}

function clearUiState() {
  try { localStorage.removeItem(STORAGE_KEY) } catch (e) {}
}

export { readUiState, saveUiState, clearUiState }
