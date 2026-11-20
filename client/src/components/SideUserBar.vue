<template>
  <!-- 已登录：整个用户卡片即下拉触发器，单行紧凑排列 -->
  <ElDropdown v-if="isLoggedIn" class="su-dropdown" trigger="click" placement="top-start" @command="onCommand">
    <div class="side-user-bar su-logged">
      <div class="su-avatar">{{ avatarText }}</div>
      <span class="su-name">{{ auth.user.username }}</span>
      <span class="su-role" :class="isAdmin ? 'admin' : 'normal'">{{ roleLabel }}</span>
      <el-icon class="su-caret"><ArrowDown /></el-icon>
    </div>
    <template #dropdown>
      <ElDropdownMenu>
        <ElDropdownItem command="password">修改密码</ElDropdownItem>
        <ElDropdownItem command="logout" divided>退出登录</ElDropdownItem>
      </ElDropdownMenu>
    </template>
  </ElDropdown>

  <!-- 未登录（访客）：整卡可点击登录，头像 / 幽灵登录按钮 / 访客标签居中紧凑排列 -->
  <div v-else class="side-user-bar guest-card" @click="showLogin = true">
    <div class="su-avatar default-avatar" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
      </svg>
    </div>
    <button class="su-login-btn" @click.stop="showLogin = true">登录</button>
    <span class="su-role visitor">访客</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ElDropdown, ElDropdownMenu, ElDropdownItem, ElMessageBox } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'
import { auth, isLoggedIn, isAdmin, roleLabel, showLogin, showPassword, clearSession } from '../store/auth.js'
import { toastSuccess } from '../utils/toast.js'

const avatarText = computed(function () {
  const name = String((auth.user && auth.user.username) || '?')
  return name.trim().charAt(0).toUpperCase()
})

async function onCommand(cmd) {
  if (cmd === 'password') {
    showPassword.value = true
  } else if (cmd === 'logout') {
    try {
      await ElMessageBox.confirm('确定退出登录吗？', '退出登录', {
        confirmButtonText: '退出', cancelButtonText: '取消', type: 'info'
      })
    } catch (e) { return }
    clearSession()
    toastSuccess('已退出登录')
  }
}
</script>
