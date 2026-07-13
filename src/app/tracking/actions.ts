"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/modules/auth/permissions";
import {
  archiveTrackingNumber,
  captureManualTrackingNumbers,
  captureTrackingNumbersFromImports,
  deleteTrackingNumber,
  pruneOldAlibabaTrackingNumbers,
  refreshActiveTrackingNumbers,
  refreshTrackingNumber,
  updateManualItemLeadTime
} from "@/modules/tracking/service";
import { revalidateWorkspace } from "@/app/revalidate-workspace";
import {
  alibabaPortalTrackingActionSucceeded,
  runAlibabaPortalTrackingCapture,
  summarizeAlibabaPortalTrackingCapture
} from "@/modules/tracking/alibaba-capture-agent";

const TRACKING_AGENT_ID = "tracking-workbench";
const ALIBABA_TRACKING_AGENT_ID = "alibaba-tracking-capture-agent";

export async function saveManualTrackingNumbersAction(formData: FormData) {
  const rawText = readString(formData, "rawText");
  if (rawText.length < 8) {
    return { success: false, message: "Paste or drop at least one tracking number, shipment email, or Alibaba order-details link." };
  }

  const actor = await requirePermission("integration:mutate");
  const result = await captureManualTrackingNumbers({
    rawText,
    actorId: actor.id,
    externalOrderId: readString(formData, "externalOrderId") || null,
    purchaseOrderId: readString(formData, "purchaseOrderId") || null,
    supplierName: readString(formData, "supplierName") || null,
    sourceUrl: readString(formData, "sourceUrl") || null
  });

  revalidateWorkspace();
  if (result.saved === 0 && result.updated === 0) {
    return { success: false, message: "No valid tracking numbers were found. Paste the tracking number itself, not only an Alibaba order number." };
  }

  const linked = result.records.filter((record) => record.purchaseOrderId).length;
  return {
    success: true,
    message: `Saved ${result.saved} new tracking number(s), updated ${result.updated}, and linked ${linked} to purchase order evidence.`
  };
}

export async function captureAlibabaTrackingAction() {
  await requirePermission("integration:mutate");

  const portal = await runAlibabaPortalTrackingCapture();
  const prune = await pruneOldAlibabaTrackingNumbers({
    actorId: ALIBABA_TRACKING_AGENT_ID,
    recentMonths: 3,
    sourceUrlContains: "alibaba"
  });
  const backfill = await captureTrackingNumbersFromImports({
    actorId: ALIBABA_TRACKING_AGENT_ID,
    limit: 200,
    recentMonths: 3
  });
  const success = alibabaPortalTrackingActionSucceeded({ portal, backfill, prune });

  revalidateWorkspace();

  return {
    success,
    message: `${summarizeAlibabaPortalTrackingCapture({ portal, backfill })} Pruned ${prune.pruned} old Alibaba tracking row(s) outside the last 3 months.`
  };
}

export async function refreshAllTrackingAction() {
  const result = await refreshActiveTrackingNumbers({ actorId: TRACKING_AGENT_ID, limit: 100 });
  revalidatePath("/tracking");
  if (result.failed > 0 && result.refreshed === 0) {
    return { success: false, message: `Tracking refresh attempted ${result.scanned} active numbers; ${result.failed} failed. Check service configuration.` };
  }
  const archivedOnProvider = result.archivedOnProvider ?? 0;
  const providerArchiveSuffix = archivedOnProvider > 0 ? ` Archived ${archivedOnProvider} delivered Ship24 backend tracker(s) to clear active API availability.` : "";
  return {
    success: true,
    message: `Refreshed ${result.refreshed} active tracking numbers; skipped ${result.skipped} delivered, archived, or over-limit records.${providerArchiveSuffix}`
  };
}

export async function refreshSingleTrackingAction(formData: FormData) {
  const trackingNumber = String(formData.get("trackingNumber") ?? "").trim();
  if (!trackingNumber) return { success: false, message: "Missing tracking number." };
  await refreshTrackingNumber({ trackingNumber, actorId: TRACKING_AGENT_ID });
  revalidatePath("/tracking");
  return { success: true, message: `Refreshed ${trackingNumber}.` };
}

export async function archiveTrackingNumberAction(formData: FormData) {
  const trackingNumber = readString(formData, "trackingNumber");
  if (!trackingNumber) return { success: false, message: "Missing tracking number." };

  const actor = await requirePermission("integration:mutate");
  await archiveTrackingNumber({
    trackingNumber,
    actorId: actor.id,
    reason: "Archived manually from the active Tracking Workbench card."
  });
  revalidateWorkspace(["/tracking"]);
  return { success: true, message: `Archived ${trackingNumber}. It will no longer be polled as active shipment evidence.` };
}

export async function deleteTrackingNumberAction(formData: FormData) {
  const trackingNumber = readString(formData, "trackingNumber");
  if (!trackingNumber) return { success: false, message: "Missing tracking number." };

  const actor = await requirePermission("integration:mutate");
  await deleteTrackingNumber({
    trackingNumber,
    actorId: actor.id,
    reason: "Deleted manually from the active Tracking Workbench card."
  });
  revalidateWorkspace(["/tracking"]);
  return { success: true, message: `Deleted ${trackingNumber} and its carrier event rows from active tracking.` };
}

export async function updateManualItemLeadTimeAction(formData: FormData) {
  const itemId = readString(formData, "itemId");
  const leadTimeDaysRaw = readString(formData, "leadTimeDays");
  const leadTimeDays = Number(leadTimeDaysRaw);
  if (!itemId) return { success: false, message: "Missing item." };
  if (!Number.isFinite(leadTimeDays) || leadTimeDays < 0) {
    return { success: false, message: "Lead time must be zero or more days." };
  }

  const actor = await requirePermission("item:edit");
  const item = await updateManualItemLeadTime({ itemId, leadTimeDays, actorId: actor.id });
  revalidateWorkspace();
  return { success: true, message: `Updated ${item.sku} lead time to ${item.leadTimeDays} day(s).` };
}

function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}
