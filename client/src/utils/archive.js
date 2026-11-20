// 第 6 步：独立信息档案类型（前后端 type 取值一一对应）
export const ARCHIVE_TYPES = [
  { key: 'buyer', label: '采购单位' },
  { key: 'agency', label: '代理机构' },
  { key: 'competitor', label: '竞争对手 / 中标单位' },
  { key: 'judge', label: '评委' }
]

export function archiveLabel(key) {
  const found = ARCHIVE_TYPES.find(function (x) { return x.key === key })
  return found ? found.label : '档案'
}

// 单位属性选项（与后端 server/archive.js 的 UNIT_ATTRIBUTES 一一对应）
export const UNIT_ATTRIBUTES = ['政府机关', '事业单位', '国有企业', '民营企业', '外资企业', '其他']

// 三类业务档案的「引用项目数」列按业务语义动态命名
export const REF_COL_LABEL = {
  buyer: '招标项目数',
  agency: '代理项目数',
  competitor: '中标项目数'
}
