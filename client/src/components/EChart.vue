<template>
  <div ref="chartEl" class="echart-box" :style="{ height: height }"></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'

const props = defineProps({
  option: { type: Object, required: true },
  height: { type: String, default: '260px' }
})

const chartEl = ref(null)
let echarts = null       // 异步加载的 echarts 实例（打开看板时才下载，不拖慢首屏）
let chart = null
let observer = null
let disposed = false

async function ensureEcharts() {
  if (!echarts) {
    // 动态 import：Vite 会把 echarts 拆成独立 chunk，首屏不加载
    echarts = (await import('../utils/echarts.js')).default
  }
  return echarts
}

async function render() {
  if (!chartEl.value || disposed) return
  const ec = await ensureEcharts()
  if (disposed || !chartEl.value) return
  if (!chart) chart = ec.init(chartEl.value)
  chart.setOption(props.option, true)
}

function resize() {
  if (chart) chart.resize()
}

onMounted(async function () {
  await nextTick()
  await render()
  // ResizeObserver 监听容器自身尺寸变化（右侧内容区拉宽/缩窄、侧栏切换都会触发），
  // 比 window.resize 更可靠，能覆盖非窗口因素导致的容器缩放。
  if (typeof ResizeObserver !== 'undefined' && chartEl.value) {
    observer = new ResizeObserver(function () { resize() })
    observer.observe(chartEl.value)
  } else {
    window.addEventListener('resize', resize)
  }
})

watch(function () { return props.option }, function () { render() }, { deep: true })

onBeforeUnmount(function () {
  disposed = true
  if (observer) { observer.disconnect(); observer = null }
  else window.removeEventListener('resize', resize)
  if (chart) { chart.dispose(); chart = null }
})

defineExpose({ resize })
</script>

<style scoped>
.echart-box{width:100%;min-width:0}
</style>
