<template>
  <div class="region-picker">
    <el-cascader
      v-if="ready"
      v-model="codes"
      :options="regions"
      :props="CASCADER_PROPS"
      :filter-method="filterRegion"
      filterable
      clearable
      :show-all-levels="true"
      separator=" / "
      :debounce="120"
      :placeholder="placeholder"
      style="width:100%"
      @change="onChange"
    />
    <input
      v-else-if="loadFailed"
      type="text"
      class="region-raw"
      :value="displayValue"
      placeholder="请输入监管地区"
      @input="onRawInput"
    >
    <div v-else class="region-loading">正在加载行政区划…</div>

    <!-- 历史 / 手输文本匹配不上级联数据时：原样展示，不报错、不改写，保存时保留原值 -->
    <div v-if="ready && !matched && displayValue" class="region-fallback">
      历史自定义地区：<b>{{ displayValue }}</b> · 保持不变即可，也可在上方重新选择
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import {
  loadRegions, formatRegion, parseRegion, filterRegion, CASCADER_PROPS
} from '../../utils/regions.js'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  placeholder: { type: String, default: '输入汉字或拼音，也可逐级选择' }
})
const emit = defineEmits(['update:modelValue'])

const regions = ref([])
const ready = ref(false)
const loadFailed = ref(false)
const codes = ref([])
const matched = ref(true)
const displayValue = computed(function () { return String(props.modelValue == null ? '' : props.modelValue).trim() })

onMounted(async function () {
  try {
    regions.value = await loadRegions()
    ready.value = true
    syncFromValue()
  } catch (e) {
    loadFailed.value = true   // 数据文件异常时降级为纯文本输入，录入不受阻
  }
})

function syncFromValue() {
  const v = displayValue.value
  if (!v) { codes.value = []; matched.value = true; return }
  const r = parseRegion(v)
  matched.value = r.ok
  codes.value = r.codes
}

watch(displayValue, function () { if (ready.value) syncFromValue() })

function onChange(val) {
  emit('update:modelValue', formatRegion(val || []))
}

function onRawInput(e) {
  emit('update:modelValue', e.target.value)
}
</script>
