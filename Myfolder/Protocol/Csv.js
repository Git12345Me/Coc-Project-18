/** Small CSV parser (quotes, commas, newlines) for the client's CSV files. */
function parse (text) {
  const rows = []; let row = []; let cell = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

/**
 * Supercell CSV rule: row 0 = column names, row 1 = column types, then data.
 * A row WITH a Name starts a new entry. Rows with an empty Name are the next LEVELS of the entry above.
 * So the data id is  tableBase + (number of named rows before it), NOT the plain row number.
 */
function entries (text, nameColumn = 'Name') {
  const rows = parse(text)
  const head = rows[0]; const col = Object.fromEntries(head.map((n, i) => [n, i]))
  const out = []
  for (const r of rows.slice(2)) {
    if (!r.length || (r.length === 1 && !r[0])) continue
    if (r[col[nameColumn]]) out.push({ row: r, levels: 1 }); else if (out.length) out[out.length - 1].levels++
  }
  return { col, entries: out }
}

module.exports = { parse, entries }
