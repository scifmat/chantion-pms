<template>
  <ElDialog
    :model-value="showLogin"
    @update:model-value="showLogin = $event"
    title="登录 ChanTion-PMS"
    width="420px"
    :close-on-click-modal="false"
    destroy-on-close
    align-center
  >
    <form class="auth-form" @submit.prevent="submit" novalidate>
      <div class="fld">
        <label>用户名</label>
        <input ref="userInput" v-model="username" autocomplete="username" placeholder="请输入用户名" @input="error = ''">
      </div>
      <div class="fld">
        <label>密码</label>
        <input v-model="password" type="password" autocomplete="current-password" placeholder="请输入密码" @input="error = ''" @keydown.enter.prevent="submit">
      </div>
      <div class="auth-error" v-if="error">{{ error }}</div>
      <div class="auth-hint">访客可直接浏览项目与档案，登录后可使用新增、编辑、删除等功能。</div>
    </form>
    <template #footer>
      <button class="btn" @click="showLogin = false">取消</button>
      <button class="btn primary" style="margin-left:8px" :disabled="busy" @click="submit">
        {{ busy ? '登录中…' : '登录' }}
      </button>
    </template>
  </ElDialog>
</template>

<script setup>
import { ref, nextTick, watch } from 'vue'
import { ElDialog } from 'element-plus'
import { showLogin, setSession } from '../store/auth.js'
import { login } from '../api.js'
import { toastSuccess } from '../utils/toast.js'

const username = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)
const userInput = ref(null)

watch(showLogin, function (open) {
  if (open) {
    error.value = ''
    nextTick(function () { if (userInput.value) userInput.value.focus() })
  }
})

async function submit() {
  if (busy.value) return
  error.value = ''
  if (!username.value.trim() || !password.value) {
    error.value = '请输入用户名和密码'
    return
  }
  busy.value = true
  try {
    const data = await login(username.value.trim(), password.value)
    setSession(data.token, data.user)
    showLogin.value = false
    password.value = ''
    toastSuccess('欢迎回来，' + data.user.username)
  } catch (e) {
    error.value = e.message || '登录失败，请重试'
  } finally {
    busy.value = false
  }
}
</script>
