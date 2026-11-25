/**
 * 全局表格单元格统一居中指令 `v-cell-align`。
 *
 * 之前按「渲染后文本长度」区分：短文本双向居中、长文本左对齐。
 * 实际观感不一致，现在不再做任何判断，所有单元格一律水平 + 垂直居中。
 *
 * 用法：<td v-cell-align class="cell-ellip">…</td>
 * 跳过：带 colspan 的占位/空态行（无实际数据，不需要居中 class）。
 */

const CENTER = 'cell-center'

/** 所有单元格统一使用的居中 class，供测试与手动场景复用 */
export function cellClass() { return CENTER }

function apply(el) {
  if (el.hasAttribute('colspan')) return
  // 清掉历史智能对齐遗留的 class，避免旧缓存样式继续左对齐
  el.classList.remove('cell-left')
  el.classList.add(CENTER)
}

export const cellAlign = {
  mounted: apply,
  updated: apply
}

export { CENTER }
