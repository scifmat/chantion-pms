<template>
  <ElDialog
    :model-value="showPassword"
    @update:model-value="showPassword = $event"
    title="修改密码"
    width="440px"
    :close-on-click-modal="false"
    destroy-on-close
    align-center
  >
    <form class="auth-form" @submit.prevent="submit" novalidate>
      <div class="fld">
        <label>原密码</label>
        <input v-model="oldPassword" type="password" autocomplete="current-password" placeholder="请输入原密码" @input="error = ''">
      </div>
      <div class="fld">
        <label>新密码</label>
        <input v-model="newPassword" type="password" autocomplete="new-password" placeholder="至少 6 个字符" @input="error = ''">
      </div>
      <div class="fld">
        <label>确认新密码</label>
        <input v-model="confirmPassword" type="password" autocomplete="new-password" placeholder="请再次输入新密码" @keydown.enter.prevent="submit" @input="error = ''">
      </div>
      <div class="auth-error" v-if="error">{{ error }}</div>
      <div class="auth-hint">修改成功后当前登录态会保留，其他设备上已登录的会话将自动失效。</div>
    </form>
    <template #footer>
      <button class="btn" @click="showPassword = false">取消</button>
      <button class="btn primary" style="margin-left:8px" :disabled="busy" @click="submit">
        {{ busy ? '保存中…' : '确认修改' }}
      </button>
    </template>
  </ElDialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { ElDialog } from 'element-plus'
import { showPassword, setSession, auth } from '../store/auth.js'
import { changePassword } from '../api.js'
import { toastSuccess } from '../utils/toast.js'

const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref('')
const busy = ref(false)

watch(showPassword, function (open) {
  if (open) {
    oldPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    error.value = ''
  }
})

async function submit() {
  if (busy.value) return
  error.value = ''
  if (!oldPassword.value || !newPassword.value || !confirmPassword.value) {
    error.value = '请填写全部密码项'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的新密码不一致'
    return
  }
  busy.value = true
  try {
    const data = await changePassword(oldPassword.value, newPassword.value)
    // 后端签发新 Token（旧 Token 因 pv+1 失效），本地同步更新保持登录态
    setSession(data.token, auth.user)
    showPassword.value = false
    toastSuccess('密码修改成功')
  } catch (e) {
    error.value = e.message || '修改失败，请重试'
  } finally {
    busy.value = false
  }
}
</script>
