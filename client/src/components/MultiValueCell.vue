<template>
  <span class="mvc-cell" :class="{ 'mvc-ellip': ellipsis }" :title="tipText || undefined">
    <template v-if="list.length === 0"><span class="mvc-empty">—</span></template>
    <template v-else-if="list.length === 1"><span class="mvc-text">{{ list[0] }}</span></template>
    <template v-else>
      <span class="mvc-text">{{ list[0] }}</span>
      <button type="button" class="mvc-more" @click.stop="openDialog">[更多]</button>
    </template>

    <ElDialog v-model="dialogOpen" :title="label + '（共 ' + list.length + ' 项）'" width="460px" append-to-body destroy-on-close>
      <ul class="mvc-list">
        <li v-for="(v, i) in list" :key="i" class="mvc-item">
          <span class="mvc-idx">{{ i + 1 }}</span>
          <span class="mvc-val">{{ v }}</span>
        </li>
      </ul>
      <template #footer>
        <button type="button" class="btn" @click="dialogOpen = false">关闭</button>
      </template>
    </ElDialog>
  </span>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElDialog } from 'element-plus'
import { splitArchiveValues } from '../utils/archiveValues.js'

const props = defineProps({
  // 后端字段：可能是数组（phoneList / emailList / addressList），也可能是逗号分隔串（phone / email / address）
  values: { default: () => [] },
  label: { type: String, default: '详细信息' },
  // 地址等长文本：表格内单行省略 + title 悬浮提示完整内容
  ellipsis: { type: Boolean, default: false }
})

const list = computed(function () { return splitArchiveValues(props.values) })
const tipText = computed(function () { return list.value.length ? list.value.join('，') : '' })
const dialogOpen = ref(false)
function openDialog() { dialogOpen.value = true }
</script>

<style scoped>
.mvc-cell { display: inline-flex; align-items: center; max-width: 100%; min-width: 0; gap: 4px; vertical-align: middle; }
/* ellipsis 模式用于表格单元格（中标单位/地址列）：水平居中，与全局 td 纵横居中一致，
   避免空状态「—」和单值靠左、与其余单元格不齐 */
.mvc-cell.mvc-ellip { display: flex; width: 100%; white-space: nowrap; justify-content: center; }
.mvc-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; word-break: break-all; }
.mvc-empty { color: #8a94a6; }
.mvc-more {
  flex: none;
  border: 0;
  background: transparent;
  color: #2f6fed;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  padding: 0 2px;
  cursor: pointer;
  white-space: nowrap;
}
.mvc-more:hover { text-decoration: underline; color: #2559c9; }
.mvc-list { list-style: none; margin: 0; padding: 2px 0; max-height: 55vh; overflow-y: auto; }
.mvc-item { display: flex; align-items: flex-start; gap: 10px; padding: 7px 4px; border-bottom: 1px solid #eef1f6; }
.mvc-item:last-child { border-bottom: 0; }
.mvc-idx { flex: none; min-width: 20px; height: 20px; border-radius: 10px; background: #eef2f8; color: #42526e; font-size: 12px; text-align: center; line-height: 20px; }
.mvc-val { flex: 1; min-width: 0; font-size: 13px; color: #243247; line-height: 20px; word-break: break-all; white-space: pre-wrap; }
</style>
