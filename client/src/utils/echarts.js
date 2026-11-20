// ECharts 按需引入（第 11 步）：只打包用到的图表与组件，避免全量 echarts 拖大主包。
// 主题色与系统一致（#2f6fed），统一去掉冗余背景 / 网格线 / 边框，保持现代清爽。
import * as echarts from 'echarts/core'
import { BarChart, PieChart, LineChart, MapChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  BarChart, PieChart, LineChart, MapChart,
  GridComponent, TooltipComponent, LegendComponent, VisualMapComponent,
  CanvasRenderer
])

// 主题常量在 chartTheme.js（零 echarts 依赖），从这里转出以兼容既有引用
export { CHART_COLORS, TOOLTIP_STYLE, themeOption } from './chartTheme.js'

export default echarts
