<template>
  <div class="fld">
    <label>{{ label }}</label>
    <div class="date-range">
      <template v-if="type === 'date'">
        <DateField kind="date" :model-value="from" @update:modelValue="emit('update:from', $event)" />
        <span class="sep">至</span>
        <DateField kind="date" :model-value="to" @update:modelValue="emit('update:to', $event)" />
      </template>
      <template v-else>
        <input
          :value="from" :placeholder="placeholder" inputmode="decimal"
          @input="emit('update:from', $event.target.value)"
        >
        <span class="sep">至</span>
        <input
          :value="to" :placeholder="placeholder" inputmode="decimal"
          @input="emit('update:to', $event.target.value)"
        >
      </template>
    </div>
    <div class="tip err" v-if="tip">{{ tip }}</div>
  </div>
</template>

<script setup>
// 金额区间用文本输入（不用 type=number，避免浏览器把大数写成科学计数法）；
// 日期区间统一用 el-date-picker（可视化日历 + 粘贴兼容），与首页、录入弹窗一致。
import DateField from '../form/DateField.vue'
defineProps({
  label: { type: String, required: true },
  from: { type: [String, Number], default: '' },
  to: { type: [String, Number], default: '' },
  type: { type: String, default: 'text' },
  placeholder: { type: String, default: '' },
  tip: { type: String, default: '' }
})
const emit = defineEmits(['update:from', 'update:to'])
</script>
