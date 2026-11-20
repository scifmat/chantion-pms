<template>
  <div>
    <div class="sub-title">{{ title }}</div>
    <div class="grid3">
      <Field :label="party === 'buyer' ? '单位名称' : '机构名称'" :path="party + '.name'" required>
        <ArchiveInput :type="archiveType" v-model="form[party].name" />
      </Field>
      <Field label="联系电话" :path="party + '.phone'">
        <ArchiveInput linked field="phone" :type="archiveType" :party-name="form[party].name" v-model="form[party].phone" />
      </Field>
      <Field label="电子邮箱" :path="party + '.email'">
        <ArchiveInput linked field="email" :type="archiveType" :party-name="form[party].name" v-model="form[party].email" />
      </Field>
      <Field :label="party === 'buyer' ? '单位地址' : '机构地址'" :path="party + '.address'" full rule="multiline">
        <ArchiveInput linked field="address" :type="archiveType" :party-name="form[party].name" multiline v-model="form[party].address" />
      </Field>
    </div>
  </div>
</template>

<script setup>
import { inject, computed } from 'vue'
import Field from './Field.vue'
import ArchiveInput from './ArchiveInput.vue'
const props = defineProps({
  party: { type: String, required: true },   // buyer | agency
  title: { type: String, required: true }
})
const form = inject('projectForm')
const archiveType = computed(function () { return props.party === 'buyer' ? 'buyer' : 'agency' })
</script>
