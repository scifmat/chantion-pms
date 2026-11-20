/**
 * Excel 工作簿生成（exceljs）—— 通用导出底座的「写文件」部分。
 *
 * 设计：
 *   - 输入：表头 [{key,label}] + 行数据（已由 fields.js 扁平化好的二维数组）
 *   - 金额列写成数字类型（便于 Excel 再计算），其余写字符串；所有空值写 ''
 *   - 样式：表头加粗 + 底色 + 边框、冻结首行、自动筛选、列宽自适应、斑马纹可选
 *   - 输出：Node Readable 流，供路由直接 pipe 到 res（流式，不攒大 Buffer，防 OOM）
 */
const ExcelJS = require('exceljs');

const MAX_WIDTH = 42;
const MIN_WIDTH = 10;

/** 估算列宽：中文按 2 字符宽度，取表头与样本行的内容最大宽度 */
function estimateWidth(label, sampleValues) {
  function width(s) {
    let w = 0;
    for (const ch of String(s == null ? '' : s)) {
      w += /[\u2E80-\uFFFF]/.test(ch) ? 2 : 1;
    }
    return w;
  }
  let max = width(label);
  sampleValues.forEach(function (v) {
    const lines = String(v == null ? '' : v).split('\n');
    lines.forEach(function (ln) { max = Math.max(max, width(ln)); });
  });
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, max + 3));
}

/** 判断某列是否金额列（表头含「万元」），决定写成数字类型 */
function isMoneyColumn(label) { return /万元/.test(String(label)); }

/**
 * 创建工作簿并写入响应流。
 * @param {Array<{key,label}>} headers 表头（按用户勾选顺序）
 * @param {Array<Array>} rows 数据行（二维数组，与 headers 一一对应）
 * @param {object} opts { sheetName, sampleRows } sampleRows 用于估算列宽的行数上限
 * @returns {Promise<ExcelJS.Workbook>} 调用方用 workbook.xlsx.write(res) 流式输出
 */
async function buildWorkbook(headers, rows, opts) {
  opts = opts || {};
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ChanTion-PMS';
  wb.created = new Date();
  const ws = wb.addWorksheet(opts.sheetName || '导出数据', {
    views: [{ state: 'frozen', ySplit: 1 }] // 冻结首行
  });

  // 表头
  const headerRow = ws.addRow(headers.map(function (h) { return h.label; }));
  headerRow.height = 24;
  headerRow.eachCell(function (cell) {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F6FED' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD0D7E5' } },
      left: { style: 'thin', color: { argb: 'FFD0D7E5' } },
      bottom: { style: 'thin', color: { argb: 'FFD0D7E5' } },
      right: { style: 'thin', color: { argb: 'FFD0D7E5' } }
    };
  });

  // 列宽估算（用表头 + 前若干行样本）
  const sampleLimit = Math.min(rows.length, opts.sampleRows || 200);
  headers.forEach(function (h, i) {
    const samples = [];
    for (let r = 0; r < sampleLimit; r++) samples.push(rows[r][i]);
    ws.getColumn(i + 1).width = estimateWidth(h.label, samples);
  });

  // 数据行
  const moneyFlags = headers.map(function (h) { return isMoneyColumn(h.label); });
  rows.forEach(function (row, idx) {
    const excelRow = ws.addRow([]);
    headers.forEach(function (h, i) {
      const raw = row[i];
      const cell = excelRow.getCell(i + 1);
      if (moneyFlags[i] && raw !== '' && raw != null && Number.isFinite(Number(raw))) {
        cell.value = Number(raw);          // 金额写数字，numFmt 保留两位
        cell.numFmt = '0.00';
      } else {
        cell.value = raw === '' || raw == null ? '' : String(raw);
      }
      cell.alignment = { vertical: 'middle', wrapText: false };
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F8FE' } };
      }
    });
  });

  // 自动筛选（作用于整个表头行）
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length }
  };

  return wb;
}

module.exports = { buildWorkbook };
