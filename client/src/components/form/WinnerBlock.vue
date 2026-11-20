<template>
  <div>
    <div class="sub-title">中标单位</div>
    <label class="switch">
      <input type="checkbox" v-model="winner.isUnion">
      <span class="track"></span><span>联合体投标</span>
    </label>
    <div class="grid2" style="margin-top:8px">
      <Field :label="winner.isUnion ? '牵头单位' : '单位名称'" :path="path + '.lead'" required>
        <ArchiveInput type="competitor" v-model="winner.lead" />
      </Field>
      <div class="fld" v-if="winner.isUnion">
        <label>成员单位</label>
        <div class="row" v-for="(m, i) in winner.members" :key="i" style="gap:5px;flex-wrap:nowrap;margin-bottom:4px">
          <ArchiveInput type="competitor" v-model="winner.members[i]" style="flex:1;min-width:0" />
          <button class="btn sm" @click="removeMember(i)">-</button>
        </div>
        <button class="btn sm" @click="addMember">+ 添加成员</button>
      </div>
      <div v-else></div>
    </div>
  </div>
</template>

<script setup>
import Field from './Field.vue'
import ArchiveInput from './ArchiveInput.vue'

const props = defineProps({
  winner: { type: Object, required: true },   // 对象引用：总中标或某个分包共用
  path: { type: String, required: true }
})

function addMember() { props.winner.members.push('') }
function removeMember(i) {
  props.winner.members.splice(i, 1)
  if (!props.winner.members.length) props.winner.members = ['']
}
</script>
