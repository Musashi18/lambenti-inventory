"use client";

import { useFormStatus } from "react-dom";

type AutomationScanButtonProps = {
  label: string;
  pendingLabel: string;
  variant?: "primary" | "secondary";
};

export function AutomationScanButton({ label, pendingLabel, variant = "secondary" }: AutomationScanButtonProps) {
  const { pending } = useFormStatus();
  const classes = variant === "primary"
    ? "rounded-md bg-ink px-3 py-2 text-sm font-medium text-white disabled:opacity-70"
    : "rounded-md border px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-70";

  return (
    <button className={classes} disabled={pending} aria-busy={pending}>
      <span className="inline-flex items-center gap-2">
        {pending ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" /> : null}
        {pending ? pendingLabel : label}
      </span>
    </button>
  );
}
