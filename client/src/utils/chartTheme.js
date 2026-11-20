// 图表主题常量（零 echarts 依赖，可被静态 import 而不拖入图表库本体）。
// echarts 实例只在 EChart.vue 里动态 import，主题常量独立出来保证代码分割有效。

export const CHART_COLORS = ['#2f6fed', '#0f9d6e', '#7c4dff', '#e8833a', '#d4537e', '#38a3c7']

export const TOOLTIP_STYLE = {
  backgroundColor: '#fff',
  borderColor: '#e3e7ee',
  borderWidth: 1,
  padding: [8, 12],
  textStyle: { color: '#374151', fontSize: 12 },
  extraCssText: 'box-shadow:0 4px 16px rgba(16,24,40,.12);border-radius:6px;'
}

export function themeOption(option) { return Object.assign({ color: CHART_COLORS }, option) }
