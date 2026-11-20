<template>
  <div>
    <div class="sect-title">公共信息</div>
    <div class="grid3">
      <Field label="项目状态" path="public.status" required>
        <select v-model="form.public.status">
          <option v-for="s in statuses" :key="s" :value="s">{{ s }}</option>
        </select>
      </Field>
      <Field label="监管地区" path="public.region" required>
        <RegionPicker v-model="form.public.region" />
      </Field>
      <Field label="项目编号" path="public.project_no" required rule="projectNo">
        <input v-model="form.public.project_no" placeholder="如 XM-2026-001">
      </Field>
      <Field label="项目名称" path="public.project_name" required>
        <input v-model="form.public.project_name">
      </Field>
      <Field label="项目预算" path="public.budget_yuan" rule="amount">
        <input v-model="form.public.budget_yuan" placeholder="如 5000000 或 500万元">
      </Field>
      <Field label="最高限价" path="public.ceiling_yuan" rule="amount">
        <input v-model="form.public.ceiling_yuan" placeholder="如 5000000 或 500万元">
      </Field>
    </div>
  </div>
</template>

<script setup>
import { inject, computed } from 'vue'
import Field from './Field.vue'
import RegionPicker from './RegionPicker.vue'
import { optsWithCurrent } from '../../utils/options.js'
const form = inject('projectForm')
// 项目状态仍取自业务配置；编辑历史项目时把已停用 / 不在当前配置里的原值临时补入（需求 12.2 第 6 条）。
// 监管地区改由全国三级行政区划数据驱动，不再从业务配置的模拟省市下拉里取。
const statuses = computed(function () { return optsWithCurrent('status', form.public.status) })
</script>
