<template>
  <!-- 原用户管理弹窗抽离成面板：表格 / 新增 / 重置 / 删除逻辑原样保留，嵌套弹窗继续 append-to-body -->
  <div class="user-manage-panel">
    <div class="um-toolbar">
      <span class="um-subtitle">共 {{ users.length }} 位用户 · 管理员账号全局唯一，不可删除</span>
      <button class="btn primary" @click="openAdd">+ 新增用户</button>
    </div>

    <div class="um-table-wrap">
      <table class="um-table">
        <thead>
          <tr><th>用户名</th><th>角色</th><th>创建时间</th><th>最近登录</th><th class="col-frozen">操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>{{ u.username }}</td>
            <td>
              <span class="role-tag" :class="u.role === 'admin' ? 'admin' : 'normal'">
                {{ u.role === 'admin' ? '管理员' : '普通用户' }}
              </span>
            </td>
            <td class="um-muted">{{ u.created_at }}</td>
            <td class="um-muted">{{ u.last_login_at || '—' }}</td>
            <td class="col-frozen">
              <template v-if="u.role === 'admin'">
                <span class="um-muted">—</span>
              </template>
              <template v-else>
                <button class="btn sm" @click="openReset(u)">重置密码</button>
                <button class="btn sm danger" style="margin-left:6px" @click="remove(u)">删除</button>
              </template>
            </td>
          </tr>
          <tr v-if="loading"><td colspan="5" class="empty">正在读取…</td></tr>
          <tr v-if="!loading && loadError"><td colspan="5" class="empty">{{ loadError }}</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 新增用户子弹窗：必须 append-to-body，避免被 Tab 容器的 overflow / 层级裁剪 -->
    <ElDialog v-model="addOpen" title="新增用户" width="420px" :close-on-click-modal="false" append-to-body align-center>
      <form class="auth-form" @submit.prevent="submitAdd" novalidate>
        <div class="fld">
          <label>用户名 <span style="color:#d92d20">*</span></label>
          <input v-model="addForm.username" autocomplete="off" placeholder="2-32 个字符" @input="addError = ''">
        </div>
        <div class="fld">
          <label>初始密码 <span style="color:#d92d20">*</span></label>
          <input v-model="addForm.password" type="password" autocomplete="new-password" placeholder="至少 6 个字符" @input="addError = ''">
        </div>
        <div class="fld">
          <label>角色</label>
          <ElSelect v-model="addForm.role" style="width:100%">
            <ElOption label="普通用户" value="user" />
          </ElSelect>
          <span class="auth-hint">管理员全局唯一，仅在系统初始化时生成，此处不开放创建。</span>
        </div>
        <div class="auth-error" v-if="addError">{{ addError }}</div>
      </form>
      <template #footer>
        <button class="btn" @click="addOpen = false">取消</button>
        <button class="btn primary" style="margin-left:8px" :disabled="saving" @click="submitAdd">
          {{ saving ? '创建中…' : '创建' }}
        </button>
      </template>
    </ElDialog>

    <!-- 重置密码子弹窗 -->
    <ElDialog v-model="resetOpen" title="重置密码" width="420px" :close-on-click-modal="false" append-to-body align-center>
      <form class="auth-form" @submit.prevent="submitReset" novalidate>
        <div class="auth-hint">为「{{ resetTarget && resetTarget.username }}」设置新密码，重置后该用户的登录态立即失效。</div>
        <div class="fld">
          <label>新密码 <span style="color:#d92d20">*</span></label>
          <input v-model="resetPassword" type="password" autocomplete="new-password" placeholder="至少 6 个字符" @input="resetError = ''">
        </div>
        <div class="auth-error" v-if="resetError">{{ resetError }}</div>
      </form>
      <template #footer>
        <button class="btn" @click="resetOpen = false">取消</button>
        <button class="btn primary" style="margin-left:8px" :disabled="saving" @click="submitReset">
          {{ saving ? '重置中…' : '确认重置' }}
        </button>
      </template>
    </ElDialog>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { ElDialog, ElSelect, ElOption } from 'element-plus'
import { getUsers, createUser, resetUserPassword, deleteUser } from '../../api.js'
import { toastSuccess, toastError } from '../../utils/toast.js'
import { confirmAction } from '../../utils/confirm.js'

const props = defineProps({ active: { type: Boolean, default: false } })
const users = ref([])
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const loaded = ref(false)

const addOpen = ref(false)
const addForm = ref({ username: '', password: '', role: 'user' })
const addError = ref('')

const resetOpen = ref(false)
const resetTarget = ref(null)
const resetPassword = ref('')
const resetError = ref('')

watch(function () { return props.active; }, function (on) {
  if (on && !loaded.value) load()
}, { immediate: true })

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    users.value = await getUsers()
    loaded.value = true
  } catch (e) {
    loadError.value = e.message || '读取用户列表失败'
  } finally {
    loading.value = false
  }
}

function openAdd() {
  addForm.value = { username: '', password: '', role: 'user' }
  addError.value = ''
  addOpen.value = true
}

async function submitAdd() {
  if (saving.value) return
  addError.value = ''
  if (!addForm.value.username.trim() || !addForm.value.password) {
    addError.value = '请填写用户名和密码'
    return
  }
  saving.value = true
  try {
    await createUser({ username: addForm.value.username.trim(), password: addForm.value.password, role: addForm.value.role })
    toastSuccess('用户创建成功')
    addOpen.value = false
    await load()
  } catch (e) {
    addError.value = e.message || '创建失败，请重试'
  } finally {
    saving.value = false
  }
}

function openReset(u) {
  resetTarget.value = u
  resetPassword.value = ''
  resetError.value = ''
  resetOpen.value = true
}

async function submitReset() {
  if (saving.value) return
  resetError.value = ''
  if (!resetPassword.value) { resetError.value = '请输入新密码'; return }
  saving.value = true
  try {
    await resetUserPassword(resetTarget.value.id, resetPassword.value)
    toastSuccess('密码已重置')
    resetOpen.value = false
  } catch (e) {
    resetError.value = e.message || '重置失败，请重试'
  } finally {
    saving.value = false
  }
}

async function remove(u) {
  try {
    await confirmAction({
      title: '删除用户',
      object: '确定要删除用户：「' + u.username + '」吗？',
      consequence: '删除后该用户无法登录，操作不可恢复。',
      confirmText: '确定删除',
      danger: true
    })
  } catch (e) { return } // 用户取消
  try {
    await deleteUser(u.id)
    toastSuccess('用户已删除')
    await load()
  } catch (e) {
    toastError(e.message || '删除失败，请重试')
  }
}
</script>

<style scoped>
.um-toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:10px;flex-wrap:wrap}
.um-subtitle{font-size:12px;color:#5b6577}
.um-table-wrap{width:100%;overflow:auto}
.um-table{width:100%;border-collapse:collapse;font-size:13px}
.um-table th{background:#f5f7fa;color:#3b4658;font-weight:500;text-align:center;padding:9px 10px;border-bottom:1px solid #e3e7ee;white-space:nowrap}
.um-table td{padding:9px 10px;border-bottom:1px solid #eef1f6;text-align:center;vertical-align:middle}
.um-table tbody tr:hover{background:#fafbfd}
.um-muted{color:#8a94a6;font-size:12px}
.um-table .empty{color:#8a94a6;padding:22px 0}
.role-tag{display:inline-block;padding:2px 9px;border-radius:10px;font-size:12px;line-height:18px}
.role-tag.admin{background:#fff4e5;color:#b54708}
.role-tag.normal{background:#eaf1fb;color:#2f6fed}
</style>
