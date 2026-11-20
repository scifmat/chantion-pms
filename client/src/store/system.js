// 系统级全局状态：系统名称 / 所属企业。由 main.js 启动时从公开接口加载；
// 保存设置后由 BasicSettingsPanel 调 setSettings 即时同步左上角 Logo 与页面标题。
import { reactive, computed } from 'vue'

const DEFAULT_NAME = 'ChanTion-PMS'

export const settings = reactive({
  systemName: DEFAULT_NAME,
  companyName: '',
  selfCompetitorId: 0,
  selfCompetitorName: '',
  hasCustomLogo: false,
  logoMime: '',
  logoVersion: '0'
})

export const systemName = computed(function () { return settings.systemName || DEFAULT_NAME })
export const selfCompetitorName = computed(function () { return settings.selfCompetitorName || '' })
export const customLogoUrl = computed(function () {
  return settings.hasCustomLogo ? '/api/system/logo?v=' + encodeURIComponent(settings.logoVersion || '0') : ''
})

/** 把后端返回的 settings 对象写入全局状态，并同步浏览器标题 */
export function setSettings(data) {
  if (!data || typeof data !== 'object') return
  settings.systemName = String(data.systemName == null ? '' : data.systemName).trim() || DEFAULT_NAME
  settings.companyName = String(data.companyName == null ? '' : data.companyName).trim()
  settings.selfCompetitorId = Number(data.selfCompetitorId) || 0
  settings.selfCompetitorName = String(data.selfCompetitorName == null ? '' : data.selfCompetitorName).trim()
  settings.hasCustomLogo = !!data.hasCustomLogo
  settings.logoMime = String(data.logoMime == null ? '' : data.logoMime)
  settings.logoVersion = String(data.logoVersion == null ? '0' : data.logoVersion)
  if (typeof document !== 'undefined') document.title = systemName.value
}
