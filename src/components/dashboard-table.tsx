export function DashboardTable({
  title,
  columns,
  rows
}: {
  title: string;
  columns: string[];
  rows: string[][];
}) {
  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="font-medium">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              {columns.map((column, columnIndex) => (
                <th key={`${column}-${columnIndex}`} className="px-4 py-3 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-slate-500" colSpan={columns.length}>
                  No records found.
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => (
                <tr key={`${row.join("-")}-${rowIndex}`} className={`border-t border-slate-100 ${rowIndex % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${cell}-${cellIndex}`} className="px-4 py-3">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

