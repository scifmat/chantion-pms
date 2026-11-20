<template>
  <div class="system-manage-page">
    <div class="page-head">
      <div>
        <h2>系统管理</h2>
        <div class="muted">系统级设置、业务选项与用户权限集中管理 · 仅管理员可见</div>
      </div>
    </div>

    <div class="panel system-manage-panel">
      <ElTabs v-model="activeTab" type="card">
        <ElTabPane label="基本设置" name="basic" lazy>
          <!-- 必须传 active：面板靠该 prop 在首次进入时加载设置与企业选项 -->
          <BasicSettingsPanel :active="active && activeTab === 'basic'" />
        </ElTabPane>
        <ElTabPane label="业务配置" name="config" lazy>
          <!-- 原 ConfigOptions.vue 抽离：applyConfig() 全局副作用、分组增删启停排序全部保留 -->
          <ConfigOptionsPanel :active="active && activeTab === 'config'" />
        </ElTabPane>
        <ElTabPane label="用户管理" name="users" lazy>
          <!-- 原 UserManageDialog.vue 抽离：新增/重置子弹窗继续 append-to-body -->
          <UserManagePanel :active="active && activeTab === 'users'" />
        </ElTabPane>
      </ElTabs>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElTabs, ElTabPane } from 'element-plus'
import BasicSettingsPanel from '../components/system/BasicSettingsPanel.vue'
import ConfigOptionsPanel from '../components/system/ConfigOptionsPanel.vue'
import UserManagePanel from '../components/system/UserManagePanel.vue'

defineProps({ active: { type: Boolean, default: false } })
const activeTab = ref('basic')
</script>

<style scoped>
.system-manage-panel{padding:8px 14px 14px}
</style>
