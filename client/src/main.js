import { createApp } from 'vue'
import { ElDatePicker, ElConfigProvider, ElCascader, ElIcon } from 'element-plus'
import 'element-plus/dist/index.css'   // 组件库 CSS 全量引入：保证日历/时间面板样式完整
import App from './App.vue'
import './styles.css'                 // 放在组件库 CSS 之后：项目 --el-* 变量与样式优先
import { loadOptions } from './utils/options.js'
import { cellAlign } from './utils/cellAlign.js'
import { getSystemSettings } from './api.js'
import { setSettings } from './store/system.js'

const app = createApp(App)
// 第 7 轮启用 Element Plus 的可视化日期/时间选择器；
// 第 10 轮启用行政区划三级级联选择器（支持汉字 / 拼音搜索、允许选父级）。
// 只注册实际用到的组件，避免把整个组件库 JS 打进主包（全量注册会到 1.1MB）。
app.component('ElDatePicker', ElDatePicker)
app.component('ElCascader', ElCascader)
app.component('ElConfigProvider', ElConfigProvider)   // 提供中文日历（月份 / 星期）
app.component('ElIcon', ElIcon)                       // 侧边栏导航图标容器

// 全局表格单元格统一居中（不再按长短判断）
app.directive('cell-align', cellAlign)

// 业务配置 + 系统配置：内置默认值兜底，任一接口不可用也不影响挂载
Promise.all([
  loadOptions(),
  getSystemSettings().then(setSettings).catch(function () {})
]).finally(function () { app.mount('#app') })
