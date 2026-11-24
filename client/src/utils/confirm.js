// 全局统一二次确认：标题明确动作，内容固定两行（对象 / 后果），危险操作红字按钮。
// 基于 ElMessageBox，返回 Promise；用户取消时 reject，调用方 catch 后直接 return 即可。
import { h } from 'vue'
import { ElMessageBox } from 'element-plus'

function body(object, consequence) {
  return h('div', { class: 'chantion-confirm-body' }, [
    h('div', { class: 'chantion-confirm-object' }, object),
    h('div', { class: 'chantion-confirm-consequence' }, consequence)
  ])
}

function baseOptions(title, confirmText, danger) {
  return {
    confirmButtonText: confirmText,
    cancelButtonText: '取消',
    type: danger ? 'warning' : 'info',
    customClass: 'chantion-confirm',
    confirmButtonClass: danger ? 'el-button--danger' : 'el-button--primary',
    closeOnClickModal: false,
    dangerouslyUseHTMLString: false
  }
}

/** 普通二次确认：删除用 danger=true（红字），恢复用 danger=false（蓝色） */
export function confirmAction(options) {
  const o = options || {}
  return ElMessageBox.confirm(
    body(o.object || '', o.consequence || ''),
    o.title || '请确认',
    baseOptions(o.title || '请确认', o.confirmText || '确定', o.danger === true)
  )
}

/** 强确认：除二次确认外，要求手动输入原名称/编号才能确认（彻底删除专用） */
export function confirmInput(options) {
  const o = options || {}
  const expected = String(o.expected == null ? '' : o.expected)
  const opts = baseOptions(o.title || '彻底删除', o.confirmText || '彻底删除', true)
  opts.inputPlaceholder = o.inputPlaceholder || '请输入确认内容'
  opts.inputValidator = function (value) {
    return String(value == null ? '' : value).trim() === expected || '输入不一致，请重新输入'
  }
  return ElMessageBox.prompt(
    body(o.object || '', o.consequence || ''),
    o.title || '彻底删除',
    opts
  )
}
