/**
 * 全局提示（第 8 轮 UI 优化）：基于 Element Plus 的 ElMessage。
 *  - 成功绿色打勾、失败红色警告图标由 ElMessage 的 type 自带
 *  - 屏幕正上方居中、自上而下丝滑滑入、3 秒后渐隐（样式见 styles.css .chantion-message）
 *  - pointer-events:none，不阻挡用户点击
 *  - grouping 合并短时间内重复消息，避免刷屏
 */
import { ElMessage } from 'element-plus'

const BASE = {
  duration: 3000,
  showClose: false,
  offset: 24,
  grouping: true,
  customClass: 'chantion-message'
}

export function toastSuccess(message) { return ElMessage(Object.assign({}, BASE, { message: message, type: 'success' })) }
export function toastError(message) { return ElMessage(Object.assign({}, BASE, { message: message, type: 'error' })) }
export function toastWarning(message) { return ElMessage(Object.assign({}, BASE, { message: message, type: 'warning' })) }
export function toastInfo(message) { return ElMessage(Object.assign({}, BASE, { message: message, type: 'info' })) }
