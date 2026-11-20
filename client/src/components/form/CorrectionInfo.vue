<template>
  <div>
    <div class="sect-title">更正信息</div>
    <label class="chk">
      <input type="checkbox" v-model="form.correctionsOn"> 启用更正信息
    </label>
    <template v-if="form.correctionsOn">
      <div style="margin:8px 0">
        <button class="btn sm" @click="addGroup">+ 添加更正信息</button>
      </div>
      <div class="pkg" v-for="(c, i) in form.corrections" :key="i">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <b>更正 {{ i + 1 }}</b>
          <button class="btn sm" @click="removeGroup(i)">删除</button>
        </div>
        <div class="grid2 correction-grid" style="margin-top:8px">
          <Field label="更正事项（可多选，选中后显示为标签）" :path="'corrections.' + i + '.items'">
            <ElSelect
              v-model="c.items"
              multiple
              filterable
              collapse-tags
              collapse-tags-tooltip
              :max-collapse-tags="2"
              :reserve-keyword="false"
              placeholder="请选择更正事项"
              class="correction-select"
              @change="onItemsChange(i)"
            >
              <ElOption v-for="o in itemOptions" :key="o" :label="o" :value="o" />
            </ElSelect>
          </Field>
          <Field label="更正日期" :path="'corrections.' + i + '.date'" rule="date">
            <DateField kind="date" v-model="c.date" />
          </Field>
          <Field label="更正内容" :path="'corrections.' + i + '.content'" full rule="multiline">
            <textarea v-model="c.content"></textarea>
          </Field>
          <Field label="更正公告网址" :path="'corrections.' + i + '.url'" full rule="url">
            <input v-model="c.url" placeholder="https://...">
          </Field>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { inject, computed } from 'vue'
import { ElSelect, ElOption } from 'element-plus'
import Field from './Field.vue'
import DateField from './DateField.vue'
import { opts } from '../../utils/options.js'
const form = inject('projectForm')
const validation = inject('projectValidation')

// 候选项始终来自业务配置；同时把历史项目里已停用/删除的值临时补进选项，
// 保证编辑旧项目时原值仍可见、不被自动改写（即使后台选项增减也不会丢数据）。
const itemOptions = computed(function () {
  const base = opts('correction_item').slice()
  const extra = []
  ;(form.corrections || []).forEach(function (c) {
    ;(c.items || []).forEach(function (v) {
      const s = String(v == null ? '' : v).trim()
      if (s && base.indexOf(s) < 0 && extra.indexOf(s) < 0) extra.push(s)
    })
  })
  return base.concat(extra)
})

function onItemsChange(i) {
  if (!validation) return
  validation.validateField('corrections.' + i + '.items', { phase: 'change' })
  validation.validateStructural()
  validation.validateTimeOrder()
}

function addGroup() {
  form.corrections.push({ items: [], content: '', date: '', url: '' })
}
function removeGroup(i) {
  form.corrections.splice(i, 1)
}
</script>

<style scoped>
/* 两列从顶部对齐；ElSelect 高度与右侧日期输入框一致，选项增减只改变标签折行、不撑乱布局。 */
.correction-grid{align-items:start}
.correction-select{width:100%}
.correction-select :deep(.el-select__wrapper){min-height:32px;align-items:center}
</style>
