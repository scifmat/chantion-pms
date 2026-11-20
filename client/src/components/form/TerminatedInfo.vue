<template>
  <div>
    <div class="sect-title">终止招标</div>
    <div class="grid2">
      <Field label="终止原因" path="terminated.reason" rule="multiline">
        <textarea v-model="form.terminated.reason"></textarea>
      </Field>
      <Field label="补充说明" path="terminated.note" rule="multiline">
        <textarea v-model="form.terminated.note"></textarea>
      </Field>
      <Field label="终止公告网址" path="terminated.url" full rule="url">
        <input v-model="form.terminated.url" placeholder="https://...">
      </Field>
    </div>
  </div>
</template>

<script setup>
import { inject } from 'vue'
import Field from './Field.vue'
const form = inject('projectForm')
</script>
