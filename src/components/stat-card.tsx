export function StatCard({
  label,
  value,
  helperText
}: {
  label: string;
  value: string | number;
  helperText?: string;
}) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {helperText ? <p className="mt-2 text-xs text-slate-500">{helperText}</p> : null}
    </section>
  );
}

