// 百度搜索链接：统一在这里拼接，便于测试与复用。
export function baiduSearchUrl(name) {
  return 'https://www.baidu.com/s?wd=' + encodeURIComponent(String(name == null ? '' : name).trim())
}
