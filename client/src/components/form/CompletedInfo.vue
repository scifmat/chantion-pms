<template>
  <div>
    <div class="sect-title">完成招标</div>
    <label class="switch">
      <input type="checkbox" v-model="c.isSplit">
      <span class="track"></span><span>分包</span>
    </label>

    <div :class="c.isSplit ? 'grid2' : 'grid3'" style="margin-top:10px">
      <template v-if="!c.isSplit">
        <Field label="项目类型" path="completed.type">
          <select v-model="c.type">
            <option value="">请选择</option>
            <option v-for="t in typeOpts(c.type)" :key="t" :value="t">{{ t }}</option>
          </select>
        </Field>
        <Field label="中标金额" path="completed.amount_yuan" rule="amount">
          <input v-model="c.amount_yuan" placeholder="如 7500000 或 750万元">
        </Field>
      </template>
      <template v-else>
        <Field label="总中标金额" path="completed.total">
          <input readonly value="保存后按各分包金额自动汇总">
        </Field>
      </template>
      <Field label="中标时间" path="completed.winDate" rule="date">
        <DateField kind="date" v-model="c.winDate" />
      </Field>
    </div>

    <WinnerBlock v-if="!c.isSplit" :winner="c.winner" path="completed.winner" />

    <template v-else>
      <div class="sub-title">分包信息</div>
      <div class="pkg" v-for="(p, i) in c.packages" :key="i">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <b>分包 {{ i + 1 }}</b>
          <button class="btn sm" @click="removePackage(i)">删除</button>
        </div>
        <div class="grid3">
          <Field label="包号/包名" :path="'completed.packages.' + i + '.name'" required>
            <input v-model="p.name">
          </Field>
          <Field label="分包类型" :path="'completed.packages.' + i + '.type'">
            <select v-model="p.type">
              <option value="">请选择</option>
              <option v-for="t in typeOpts(p.type)" :key="t" :value="t">{{ t }}</option>
            </select>
          </Field>
          <Field label="分包中标金额" :path="'completed.packages.' + i + '.amount_yuan'" rule="amount">
            <input v-model="p.amount_yuan" placeholder="如 7500000 或 750万元">
          </Field>
        </div>
        <WinnerBlock :winner="p.winner" :path="'completed.packages.' + i + '.winner'" />
      </div>
      <button class="btn sm" @click="addPackage">+ 添加分包</button>
    </template>

    <div class="sub-title">评委</div>
    <div class="grid2">
      <Field label="评委（一段文本智能识别；按 Enter 确认单个姓名）" path="completed.judges" full rule="text">
        <JudgeInput />
      </Field>
    </div>

    <div class="sub-title">中标公告网址</div>
    <div class="grid2">
      <Field label="中标公告网址" path="completed.url" full rule="url">
        <input v-model="c.url" placeholder="https://...">
      </Field>
    </div>
  </div>
</template>

<script setup>
import { inject, watch } from 'vue'
import Field from './Field.vue'
import WinnerBlock from './WinnerBlock.vue'
import JudgeInput from './JudgeInput.vue'
import DateField from './DateField.vue'
import { optsWithCurrent } from '../../utils/options.js'

const form = inject('projectForm')
const c = form.completed
// 选项取自业务配置；编辑历史值时把已停用/不在当前配置里的原值临时补入
function typeOpts(current) { return optsWithCurrent('project_type', current) }

function newPackage() {
  return { name: '', type: '', amount_yuan: '', winner: { lead: '', members: [''], isUnion: false } }
}
function addPackage() { c.packages.push(newPackage()) }
function removePackage(i) { c.packages.splice(i, 1) }

watch(function () { return c.isSplit; }, function (on) {
  if (on && !c.packages.length) c.packages.push(newPackage())
})
</script>
