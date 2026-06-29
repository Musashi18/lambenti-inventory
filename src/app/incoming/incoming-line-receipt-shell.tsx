"use client";

import { useEffect, useState, type ReactNode } from "react";

const RECEIPT_CONFIRMED_EVENT = "lambenti:incoming-line-received";

export function notifyIncomingLineReceived(purchaseOrderLineId: string) {
  window.dispatchEvent(new CustomEvent(RECEIPT_CONFIRMED_EVENT, { detail: { purchaseOrderLineId } }));
}

export function IncomingLineReceiptShell({ purchaseOrderLineId, children }: { purchaseOrderLineId: string; children: ReactNode }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    function handleReceiptConfirmed(event: Event) {
      const detail = (event as CustomEvent<{ purchaseOrderLineId?: string }>).detail;
      if (detail?.purchaseOrderLineId === purchaseOrderLineId) setExiting(true);
    }

    window.addEventListener(RECEIPT_CONFIRMED_EVENT, handleReceiptConfirmed);
    return () => window.removeEventListener(RECEIPT_CONFIRMED_EVENT, handleReceiptConfirmed);
  }, [purchaseOrderLineId]);

  return (
    <div
      className={`origin-top overflow-hidden transition-all duration-500 ease-in-out motion-reduce:transition-none ${exiting ? "max-h-0 -translate-y-2 scale-[0.98] border-emerald-200 bg-emerald-50/70 opacity-0" : "max-h-[900px] translate-y-0 scale-100 opacity-100"}`}
      aria-live="polite"
    >
      {children}
    </div>
  );
}
