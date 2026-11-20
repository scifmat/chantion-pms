<template>
  <div class="basic-settings">
    <div class="panel">
      <div class="setting-note">
        系统名称会立即显示在左上角 Logo 旁与浏览器标签页标题。所属企业从「竞争对手 / 中标单位」档案中选择，
        一个系统最多只能有一个本企业；它仍作为普通单位参与所有统计与排名，只是带专属标识。
      </div>

      <div class="fld setting-field">
        <label>系统名称 <span style="color:#d92d20">*</span></label>
        <input v-model="form.systemName" maxlength="40" placeholder="例如：ChanTion-PMS" @input="error = ''">
        <span class="auth-hint">{{ Array.from(form.systemName || '').length }}/40 个字符</span>
      </div>

      <div class="fld setting-field">
        <label>所属企业（本企业）</label>
        <ElSelect v-model="form.selfId" filterable clearable placeholder="未设置本企业" style="max-width:420px">
          <ElOption v-for="c in competitors" :key="c.id" :label="c.name" :value="c.id" />
        </ElSelect>
        <span class="auth-hint">保存后自动清除其他单位的本企业标记，全局始终唯一。</span>
      </div>

      <div v-if="settings.selfCompetitorName" class="self-current">
        当前本企业：<b>{{ settings.selfCompetitorName }}</b>
      </div>
      <div v-else class="self-current muted">当前尚未设置本企业</div>

      <div class="fld setting-field">
        <label>系统 Logo</label>
        <div class="logo-row">
          <img :src="logoPreview" class="logo-preview" alt="Logo 预览" @error="previewFailed = true">
          <input type="file" accept="image/png,image/jpeg,image/webp" @change="onLogoFile">
          <button class="btn sm primary" :disabled="!pendingLogo || savingLogo" @click="applyLogo">
            {{ savingLogo ? '上传中…' : '上传并应用' }}
          </button>
          <button class="btn sm" v-if="settings.hasCustomLogo" :disabled="savingLogo" @click="restoreLogo">恢复默认</button>
        </div>
        <span class="auth-hint">正方形 PNG / JPG / WebP 效果最佳，最大 512KB；上传后左上角立即生效。</span>
        <div class="auth-error" v-if="logoError">{{ logoError }}</div>
      </div>

      <div class="auth-error" v-if="error">{{ error }}</div>

      <div class="query-actions">
        <span class="spacer"></span>
        <button class="btn" :disabled="loading || saving" @click="load">放弃修改</button>
        <button class="btn primary" :disabled="loading || saving" @click="save">
          {{ saving ? '保存中…' : '保存设置' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch, computed } from 'vue'
import { ElSelect, ElOption } from 'element-plus'
import defaultLogo from '../../assets/logo.svg'
import { getSystemSettings, saveSystemSettings, getArchives, uploadSystemLogo, resetSystemLogo } from '../../api.js'
import { setSettings, settings } from '../../store/system.js'
import { toastSuccess, toastError } from '../../utils/toast.js'

const props = defineProps({ active: { type: Boolean, default: false } })
const competitors = ref([])
// 未设置时用 null，避免选项尚未加载时 ElSelect 把数字 0 当成选中值直接显示出来
const form = reactive({ systemName: '', selfId: null })
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const loaded = ref(false)
const pendingLogo = ref('')
const savingLogo = ref(false)
const logoError = ref('')
const previewFailed = ref(false)
const logoPreview = computed(function () {
  if (pendingLogo.value) return pendingLogo.value
  if (!previewFailed.value && settings.hasCustomLogo) return '/api/system/logo?v=' + encodeURIComponent(settings.logoVersion || '0')
  return defaultLogo
})

function onLogoFile(e) {
  logoError.value = ''
  previewFailed.value = false
  const f = e.target.files && e.target.files[0]
  if (!f) return
  if (f.size > 512 * 1024) { logoError.value = 'Logo 不能超过 512KB'; pendingLogo.value = ''; return }
  const reader = new FileReader()
  reader.onload = function () { pendingLogo.value = String(reader.result || '') }
  reader.onerror = function () { logoError.value = '读取图片失败' }
  reader.readAsDataURL(f)
}

async function applyLogo() {
  if (!pendingLogo.value || savingLogo.value) return
  savingLogo.value = true
  logoError.value = ''
  try {
    const data = await uploadSystemLogo(pendingLogo.value)
    setSettings(data)
    pendingLogo.value = ''
    toastSuccess('Logo 已更新')
  } catch (e) {
    logoError.value = e.message || 'Logo 上传失败'
    toastError(logoError.value)
  } finally { savingLogo.value = false }
}

async function restoreLogo() {
  if (savingLogo.value) return
  savingLogo.value = true
  logoError.value = ''
  try {
    const data = await resetSystemLogo()
    setSettings(data)
    pendingLogo.value = ''
    previewFailed.value = false
    toastSuccess('已恢复默认 Logo')
  } catch (e) {
    logoError.value = e.message || '恢复默认 Logo 失败'
    toastError(logoError.value)
  } finally { savingLogo.value = false }
}

watch(function () { return props.active; }, function (on) {
  if (on && !loaded.value) load()
}, { immediate: true })

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [s, list] = await Promise.all([getSystemSettings(), getArchives('competitor')])
    setSettings(s)                       // 同步全局状态与 document.title
    form.systemName = settings.systemName
    form.selfId = Number(s.selfCompetitorId) || null
    competitors.value = Array.isArray(list) ? list : []
    loaded.value = true
  } catch (e) {
    error.value = e.message || '读取系统设置失败'
  } finally {
    loading.value = false
  }
}

async function save() {
  if (saving.value) return
  error.value = ''
  const name = String(form.systemName || '').trim()
  if (!name) { error.value = '请填写系统名称'; return }
  if (Array.from(name).length > 40) { error.value = '系统名称不能超过 40 个字符'; return }
  saving.value = true
  try {
    const data = await saveSystemSettings({ systemName: name, selfCompetitorId: Number(form.selfId) || 0 })
    setSettings(data)                    // 所见即所得：左上角 Logo + document.title 立即更新
    toastSuccess('系统设置已保存')
    await load()
  } catch (e) {
    error.value = e.message || '保存失败，请重试'
    toastError(error.value)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.setting-note{font-size:12px;color:#5b6577;line-height:1.7;margin-bottom:18px;padding:10px 12px;background:#f7f9fc;border:1px solid #e8edf5;border-radius:6px}
.setting-field{max-width:520px;margin-bottom:16px}
.self-current{font-size:13px;color:#374151;margin:4px 0 16px}
.self-current b{color:#b54708}
.logo-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.logo-preview{width:36px;height:36px;flex:none;border-radius:6px;border:1px solid #e3e7ee;background:#fff;object-fit:contain;padding:3px}
</style>
