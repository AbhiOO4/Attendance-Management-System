import xlsx from 'xlsx';

const file = process.argv[2];
const wb = xlsx.readFile(file, { cellDates: true });
console.log('FILE:', file);
console.log('SHEETS:', wb.SheetNames);
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const ref = ws['!ref'];
  console.log('\n===== SHEET:', JSON.stringify(name), 'ref=', ref, '=====');
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: true, defval: null });
  const maxRows = Math.min(rows.length, 60);
  for (let r = 0; r < maxRows; r++) {
    const row = rows[r] || [];
    // trim trailing nulls
    let last = row.length - 1;
    while (last >= 0 && (row[last] === null || row[last] === '')) last--;
    const trimmed = row.slice(0, last + 1);
    console.log(String(r).padStart(3), JSON.stringify(trimmed));
  }
  if (rows.length > maxRows) console.log(`... (${rows.length - maxRows} more rows)`);
}
