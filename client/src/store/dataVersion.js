// 全局数据版本号：任何项目 / 档案 / 回收站写操作成功后 +1。
// v-show 常驻的页面（档案页等）watch 它即可静默刷新，不依赖组件重新挂载。
import { ref } from 'vue'

export const dataVersion = ref(0)
export function bumpDataVersion() { dataVersion.value += 1 }
