// 把「主标题（补充口径）」拆成主标题与小字提示，统一看板卡片/图表标题的展示风格。
export function splitLabelHint(text) {
  const value = String(text == null ? '' : text).trim();
  const match = value.match(/^(.*?)（(.+)）$/);
  if (!match) return { label: value, hint: '' };
  return { label: match[1].trim(), hint: match[2].trim() };
}
