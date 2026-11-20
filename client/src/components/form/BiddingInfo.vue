<template>
  <div>
    <div class="sect-title">正在招标</div>
    <div class="grid2">
      <Field label="采购方式" path="bidding.method">
        <select v-model="form.bidding.method">
          <option value="">请选择</option>
          <option v-for="m in methods" :key="m" :value="m">{{ m }}</option>
        </select>
      </Field>
      <Field label="合同履行期限" path="bidding.periodDays">
        <div class="with-unit">
          <input v-model="form.bidding.periodDays" placeholder="只填数字">
          <span class="unit">天</span>
        </div>
      </Field>
    </div>

    <div class="sub-title">获取采购文件</div>
    <div class="grid2">
      <Field label="获取方式" path="bidding.docWay">
        <select v-model="form.bidding.docWay">
          <option value="">请选择</option>
          <option v-for="w in docWays" :key="w" :value="w">{{ w }}</option>
        </select>
      </Field>
      <Field label="备注" path="bidding.docNote">
        <input v-model="form.bidding.docNote">
      </Field>
      <Field label="获取文件起始日期" path="bidding.docStart" rule="date">
        <DateField kind="date" v-model="form.bidding.docStart" />
      </Field>
      <Field label="获取文件截止日期" path="bidding.docEnd" rule="date">
        <DateField kind="date" v-model="form.bidding.docEnd" />
      </Field>
      <Field label="采购需求" path="bidding.demand" full rule="multiline">
        <textarea v-model="form.bidding.demand"></textarea>
      </Field>
    </div>

    <div class="sub-title">投标时间</div>
    <div class="grid2">
      <Field label="投标开始时间" path="bidding.bidStart" rule="datetime">
        <DateField kind="datetime" v-model="form.bidding.bidStart" />
      </Field>
      <Field label="投标截止时间" path="bidding.bidEnd" rule="datetime">
        <DateField kind="datetime" v-model="form.bidding.bidEnd" />
      </Field>
    </div>

    <div class="grid2" style="margin-top:10px">
      <Field label="招标公告网址" path="bidding.url" full rule="url">
        <input v-model="form.bidding.url" placeholder="https://...">
      </Field>
    </div>
  </div>
</template>

<script setup>
import { inject, computed } from 'vue'
import Field from './Field.vue'
import DateField from './DateField.vue'
import { opts } from '../../utils/options.js'
const form = inject('projectForm')
const methods = computed(function () { return opts('method') })
const docWays = computed(function () { return opts('doc_way') })
</script>
