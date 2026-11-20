<template>
  <div>
    <div class="sect-title">意向公示</div>
    <div class="grid2">
      <Field label="征求意见起始日期" path="intention.startDate" rule="date">
        <DateField kind="date" v-model="form.intention.startDate" />
      </Field>
      <Field label="征求意见截止日期" path="intention.endDate" rule="date">
        <DateField kind="date" v-model="form.intention.endDate" />
      </Field>
      <Field label="意向公告网址" path="intention.url" full rule="url">
        <input v-model="form.intention.url" placeholder="https://...">
      </Field>
    </div>
  </div>
</template>

<script setup>
import { inject } from 'vue'
import Field from './Field.vue'
import DateField from './DateField.vue'
const form = inject('projectForm')
</script>
