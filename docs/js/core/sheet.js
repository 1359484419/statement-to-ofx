// Spreadsheet (XLSX/XLS/ODS) to a 2D array, with date cells turned into ISO strings.
// The SheetJS module is passed in so this works in the browser and in Node tests.

export function sheetToRows(XLSX, data, sheetIndex = 0) {
  const wb = XLSX.read(data, { type: 'array', cellDates: false, cellNF: true, dense: false });
  const name = wb.SheetNames[sheetIndex] || wb.SheetNames[0];
  const ws = wb.Sheets[name];
  if (!ws || !ws['!ref']) return { sheetNames: wb.SheetNames, rows: [] };
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell || cell.v == null) { row.push(''); continue; }
      if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
        const d = XLSX.SSF.parse_date_code(cell.v);
        row.push(`${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`);
      } else if (cell.t === 'd' && cell.v instanceof Date) {
        row.push(cell.v.toISOString().slice(0, 10));
      } else if (cell.t === 'n') row.push(cell.v);
      else row.push(String(cell.w ?? cell.v).trim());
    }
    if (row.some((v) => v !== '')) rows.push(row);
  }
  return { sheetNames: wb.SheetNames, rows };
}
