"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type AutomationAction = () => Promise<void>;

type AutomationScanControlsProps = {
  runStockReorderScanAction: AutomationAction;
  runInventoryAnomalyScanAction: AutomationAction;
};

type RunningScan = "reorder" | "anomaly" | null;

export function AutomationScanControls({
  runStockReorderScanAction,
  runInventoryAnomalyScanAction
}: AutomationScanControlsProps) {
  const router = useRouter();
  const [runningScan, setRunningScan] = useState<RunningScan>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function runScan(scan: Exclude<RunningScan, null>, action: AutomationAction) {
    setRunningScan(scan);
    setMessage(null);
    try {
      await action();
      router.refresh();
      window.location.reload();
      setMessage("Scan complete. Recent automation runs and findings were refreshed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Scan failed. Refresh and try again.");
    } finally {
      setRunningScan(null);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-3">
        <ScanButton
          label="Run reorder scan"
          pendingLabel="Scanning reorder…"
          variant="primary"
          pending={runningScan === "reorder"}
          disabled={runningScan !== null}
          onClick={() => void runScan("reorder", runStockReorderScanAction)}
        />
        <ScanButton
          label="Run anomaly scan"
          pendingLabel="Scanning anomalies…"
          pending={runningScan === "anomaly"}
          disabled={runningScan !== null}
          onClick={() => void runScan("anomaly", runInventoryAnomalyScanAction)}
        />
      </div>
      {message ? <p className="text-sm text-slate-600" role="status">{message}</p> : null}
    </div>
  );
}

function ScanButton({
  label,
  pendingLabel,
  pending,
  disabled,
  onClick,
  variant = "secondary"
}: {
  label: string;
  pendingLabel: string;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
  variant?: "primary" | "secondary";
}) {
  const classes = variant === "primary"
    ? "rounded-md bg-ink px-3 py-2 text-sm font-medium text-white disabled:opacity-70"
    : "rounded-md border px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-70";

  return (
    <button type="button" className={classes} disabled={disabled} aria-busy={pending} onClick={onClick}>
      <span className="inline-flex items-center gap-2">
        {pending ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" /> : null}
        {pending ? pendingLabel : label}
      </span>
    </button>
  );
}
