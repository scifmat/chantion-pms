// 用户系统与权限控制：原生 reactive 单例状态（不引入 Pinia）
// 只管理登录态与本地持久化，不 import api.js，避免 api.js <-> store 循环依赖。
// api.js 单向依赖本模块读取 token；登录/改密请求由 api.js 发起后回写 setSession。
import { reactive, computed, ref } from 'vue'

const STORAGE_KEY = 'chantion_auth'

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { token: '', user: null }
    const obj = JSON.parse(raw)
    return { token: obj.token || '', user: obj.user || null }
  } catch (e) {
    return { token: '', user: null }
  }
}

const stored = readStored()

// 登录态：token 与 user 一起持久化，刷新页面先恢复，再由 App.vue 调 /auth/me 校验
export const auth = reactive({
  token: stored.token,
  user: stored.user
})

export const isLoggedIn = computed(() => !!auth.token && !!auth.user)
export const isAdmin = computed(() => isLoggedIn.value && auth.user.role === 'admin')
// 登录即可增删改（普通用户 / 管理员对四类业务对象均有写权限）；访客只读
export const canWrite = computed(() => isLoggedIn.value)
export const roleLabel = computed(() => {
  if (!isLoggedIn.value) return '访客'
  return auth.user.role === 'admin' ? '管理员' : '普通用户'
})

// 弹窗开关：登录框由 api.js 收到 401 时自动唤起，也可由侧边栏手动打开
export const showLogin = ref(false)
export const showPassword = ref(false)

export function setSession(token, user) {
  auth.token = token || ''
  auth.user = user || null
  persist()
}

export function clearSession() {
  auth.token = ''
  auth.user = null
  persist()
  showPassword.value = false
}

function persist() {
  try {
    if (auth.token && auth.user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: auth.token, user: auth.user }))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch (e) { /* 隐私模式下 localStorage 不可用时静默降级为内存态 */ }
}
