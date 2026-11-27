<template>
  <!-- 中文日历面板（月份/星期）；该组件不产生额外 DOM，#app 布局不变 -->
  <el-config-provider :locale="zhCn">
  <div id="app">
    <aside id="sidebar">
      <!-- 导航区独占剩余高度并自行滚动，把底部用户卡片挤到最下方 -->
      <div class="sidebar-nav">
        <div class="logo">
          <img :src="displayLogo" alt="系统 Logo" class="logo-img" @error="logoFailed = true">
          <span>{{ systemName }}</span>
        </div>
        <div
          v-for="item in visibleNav"
          :key="item.label"
        class="nav-item"
        :class="{ on: current === item.label || (current === '__dashboard__' && dashboard && dashboard.from === item.label) }"
        @click="selectNav(item.label)"
        >
          <el-icon class="nav-icon"><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </div>
      </div>

      <!-- 侧边栏底部：访客显示登录入口，已登录显示用户信息与下拉菜单 -->
      <SideUserBar />
    </aside>

    <main id="main">
      <div id="content">
        <!--
          全部视图常驻挂载，只用 v-show 切换，绝不用 v-if 销毁组件。
          首页的 4 个查询条件、结果、高级查询的条件与结果，切走再切回都原封不动。
          第 16 步左侧入口调整为「系统管理」（原业务配置并入）；第 9 步新增项目详情视图。
        -->
        <!-- 第 17 步：系统级数据看板（战略驾驶舱），仅登录用户可见 -->
        <GlobalDashboard v-show="current === '数据看板'" :active="current === '数据看板'" />
        <ProjectList
          v-show="current === '项目列表' && view === 'list'"
          :refresh-token="listRefresh"
          @go-advanced="view = 'advanced'"
          @go-detail="goDetail"
        />
        <AdvancedQuery
          v-show="current === '项目列表' && view === 'advanced'"
          :active="current === '项目列表' && view === 'advanced'"
          @back="view = 'list'"
        />
        <ProjectDetail
          v-show="current === '项目列表' && view === 'detail'"
          :project-id="detailId"
          :active="current === '项目列表' && view === 'detail'"
          @back="backFromDetail"
          @saved="onDetailSaved"
        />
        <ArchiveList
          v-show="current === '采购单位'"
          type="buyer" title="采购单位" :active="current === '采购单位'"
          @go-dashboard="openDashboard"
        />
        <ArchiveList
          v-show="current === '代理机构'"
          type="agency" title="代理机构" :active="current === '代理机构'"
          @go-dashboard="openDashboard"
        />
        <ArchiveList
          v-show="current === '竞争对手'"
          type="competitor" title="竞争对手 / 中标单位" :active="current === '竞争对手'"
          @go-dashboard="openDashboard"
        />
        <!-- 第 18 步：项目跟进（销售团队工作台），仅登录用户可见 -->
        <TrackingList
          v-show="current === '项目跟进'"
          :active="current === '项目跟进'"
          @go-detail="function (id) { goDetail(id, '项目跟进') }"
        />
        <!-- 第 10 步：参与项目数据看板，v-show 常驻切换；返回时档案页查询状态原样保留 -->
        <ArchiveDashboard
          v-show="current === '__dashboard__'"
          :payload="dashboard"
          :active="current === '__dashboard__'"
          @back="closeDashboard"
        />
        <!-- 第 16 步：系统管理（三个 Tab：基本设置 / 业务配置 / 用户管理），仅管理员可见 -->
        <SystemManage
          v-show="current === '系统管理'"
          :active="current === '系统管理'"
        />
        <OperationLogs
          v-show="current === '操作记录'"
          :active="current === '操作记录'"
        />
        <RecycleBin
          v-show="current === '回收管理'"
          :active="current === '回收管理'"
        />
      </div>
    </main>
  </div>

  <!-- 系统级回到顶部：固定在右侧工作区，滚动超过阈值后出现 -->
  <BackToTop />

  <!-- 鉴权相关弹窗：全局挂载，由 store 的开关控制 -->
  <LoginDialog />
  <ChangePasswordDialog />
  </el-config-provider>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import {
  List, OfficeBuilding, Briefcase, Trophy, Clock, Setting, DataAnalysis, Delete, Flag
} from '@element-plus/icons-vue'
import logoUrl from './assets/logo.svg'
import ProjectList from './views/ProjectList.vue'
import AdvancedQuery from './views/AdvancedQuery.vue'
import ProjectDetail from './views/ProjectDetail.vue'
import ArchiveList from './views/ArchiveList.vue'
import ArchiveDashboard from './views/ArchiveDashboard.vue'
import SystemManage from './views/SystemManage.vue'
import GlobalDashboard from './views/GlobalDashboard.vue'
import OperationLogs from './views/OperationLogs.vue'
import RecycleBin from './views/RecycleBin.vue'
import TrackingList from './views/TrackingList.vue'
import SideUserBar from './components/SideUserBar.vue'
import LoginDialog from './components/LoginDialog.vue'
import ChangePasswordDialog from './components/ChangePasswordDialog.vue'
import BackToTop from './components/BackToTop.vue'
import { systemName, customLogoUrl } from './store/system.js'
import { isLoggedIn, isAdmin, auth, clearSession } from './store/auth.js'
import { readUiState, saveUiState } from './store/uiState.js'
import { getMe } from './api.js'

// 导航项：label 同时作为 current 的标识与各视图 v-show 的判断依据，勿改字面值
// 第 16 步权限：操作记录对访客隐藏；系统管理仅管理员可见（原「业务配置」入口已并入其中）
const allNav = [
  { label: '数据看板', icon: DataAnalysis, needLogin: true },
  { label: '项目列表', icon: List },
  { label: '采购单位', icon: OfficeBuilding },
  { label: '代理机构', icon: Briefcase },
  { label: '竞争对手', icon: Trophy },
  { label: '项目跟进', icon: Flag, needLogin: true },
  { label: '操作记录', icon: Clock, needLogin: true },
  { label: '回收管理', icon: Delete, needLogin: true },
  { label: '系统管理', icon: Setting, needAdmin: true }
]
const visibleNav = computed(function () {
  return allNav.filter(function (item) {
    if (item.needAdmin && !isAdmin.value) return false
    if (item.needLogin && !isLoggedIn.value) return false
    return true
  })
})

// 从本地存储恢复导航状态；权限不满足（如刷新后已退出登录）则回退项目列表
const savedUi = readUiState()
function restorable(label) {
  if (label === '__dashboard__') return !!isLoggedIn.value && !!savedUi && !!savedUi.dashboard
  const nav = allNav.find(function (n) { return n.label === label })
  if (!nav) return false
  if (nav.needAdmin && !isAdmin.value) return false
  if (nav.needLogin && !isLoggedIn.value) return false
  return true
}
const current = ref(savedUi && restorable(savedUi.current) ? savedUi.current : '项目列表')
const view = ref(savedUi && current.value === '项目列表' && ['list', 'advanced'].indexOf(savedUi.view) >= 0
  ? savedUi.view : 'list') // 'list' | 'advanced' | 'detail'；detail 依赖运行时 id，刷新后回退 list
const logoFailed = ref(false)
const displayLogo = computed(function () {
  return !logoFailed.value && customLogoUrl.value ? customLogoUrl.value : logoUrl
})
watch(customLogoUrl, function () { logoFailed.value = false })
const detailId = ref(null)
const detailFrom = ref('项目列表')  // 详情页返回时回到来源入口（项目列表 / 项目跟进）
const listRefresh = ref(0)   // 详情页保存后 +1，列表只重新 load 数据，不动 filters

// 刷新页面后静默校验本地会话：Token 有效则保留，失效则清态（不弹全局登录框）
onMounted(function () {
  if (auth.token) {
    getMe().catch(function () { clearSession() })
  }
})

// 退出登录后若当前停在受限入口，自动回到项目列表，避免视图与导航不一致
watch([isLoggedIn, isAdmin], function () {
  if (current.value === '系统管理' && !isAdmin.value) current.value = '项目列表'
  if (current.value === '操作记录' && !isLoggedIn.value) current.value = '项目列表'
  if (current.value === '数据看板' && !isLoggedIn.value) current.value = '项目列表'
  if (current.value === '回收管理' && !isLoggedIn.value) current.value = '项目列表'
  if (current.value === '项目跟进' && !isLoggedIn.value) current.value = '项目列表'
})

function goDetail(id, from) {
  detailId.value = id
  detailFrom.value = from || '项目列表'
  current.value = '项目列表'
  view.value = 'detail'
}
function backFromDetail() {
  view.value = 'list'
  current.value = detailFrom.value || '项目列表'
}
function onDetailSaved() { listRefresh.value++ }

// 第 10 步：看板视图切换。from 记录来源档案入口，返回时原样恢复（组件常驻，查询状态不丢）
const dashboard = ref(savedUi && savedUi.current === '__dashboard__' ? savedUi.dashboard : null)

// 导航状态变化即持久化：刷新后停在原页面。集中在一个 watch，避免遗漏某个入口。
watch([current, view, dashboard], function () {
  saveUiState({ current: current.value, view: view.value, dashboard: dashboard.value })
}, { deep: true })
function openDashboard(payload) {
  // from 强制映射为导航 label（档案页 title 可能是「竞争对手 / 中标单位」这类长名，回不去）
  const navLabel = { buyer: '采购单位', agency: '代理机构', competitor: '竞争对手' }[payload.type] || '项目列表'
  dashboard.value = Object.assign({}, payload, { from: navLabel })
  current.value = '__dashboard__'
}
function closeDashboard() {
  current.value = dashboard.value && dashboard.value.from ? dashboard.value.from : '项目列表'
  dashboard.value = null
}

function selectNav(item) {
  current.value = item
  // 切换入口时复位子视图；组件常驻，首页条件与结果不会因此丢失
  view.value = 'list'
}
</script>
