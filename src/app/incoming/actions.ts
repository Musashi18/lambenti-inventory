"use server";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { revalidateWorkspace } from "@/app/revalidate-workspace";
import { AuthorizationError, requirePermission } from "@/modules/auth/permissions";
import { receivePurchaseOrderLine } from "@/modules/purchasing/receiving";
import type { IncomingReceiveActionState } from "./state";

const fieldNames = [
  "purchaseOrderLineId",
  "quantity",
  "lotCode",
  "receivedAt",
  "unitCost",
  "currency",
  "reference",
  "notes",
  "overrideReason"
] as const;

const requiredString = (message: string) => z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z.string().min(1, message)
);

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : typeof value === "string" ? value.trim() : value),
  z.string().min(1).optional()
);

const receiveIncomingSchema = z.object({
  purchaseOrderLineId: requiredString("Missing purchase order line."),
  quantity: z.coerce.number({ invalid_type_error: "Enter a numeric received quantity." })
    .int("Received quantity must be a whole number.")
    .positive("Received quantity must be positive."),
  lotCode: requiredString("Enter the lot or packing slip code."),
  receivedAt: requiredString("Enter the physical receipt date."),
  unitCost: z.coerce.number({ invalid_type_error: "Enter a numeric unit cost." })
    .finite("Unit Cost must be a finite number.")
    .nonnegative("Unit Cost cannot be negative."),
  currency: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value.trim().toUpperCase() : "USD"),
    z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code such as USD or CAD.")
  ),
  reference: requiredString("Enter the packing slip, PO, or shipment reference."),
  notes: optionalString,
  overrideReason: optionalString
});

export async function receiveIncomingPurchaseOrderLineFormAction(
  _previousState: IncomingReceiveActionState,
  formData: FormData
): Promise<IncomingReceiveActionState> {
  const values = formValues(formData);
  const parsed = receiveIncomingSchema.safeParse(values);
  if (!parsed.success) {
    return failure("Fix the highlighted receiving fields.", parsed.error.flatten().fieldErrors, "VALIDATION_ERROR", values);
  }

  const receivedAt = parseReceiptDate(parsed.data.receivedAt);
  if (!receivedAt) {
    return failure("Enter a valid physical receipt date.", { receivedAt: ["Receipt date is invalid."] }, "VALIDATION_ERROR", values);
  }

  try {
    const actor = await requirePermission("receiving:confirm");
    await receivePurchaseOrderLine({
      purchaseOrderLineId: parsed.data.purchaseOrderLineId,
      quantity: parsed.data.quantity,
      actor,
      lot: {
        lotCode: parsed.data.lotCode,
        receivedAt,
        unitCost: parsed.data.unitCost,
        currency: parsed.data.currency
      },
      reference: parsed.data.reference,
      notes: parsed.data.notes ?? "Human counted stock via Incoming / Receiving workbench.",
      overrideReason: parsed.data.overrideReason
    });

    revalidateWorkspace();
    return success(values, `Received ${parsed.data.quantity} counted unit${parsed.data.quantity === 1 ? "" : "s"} into the immutable stock ledger. Incoming, valuation, recommendations, and dashboard views were refreshed.`);
  } catch (error) {
    return domainFailure(error, values);
  }
}

function parseReceiptDate(value: string) {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formValues(formData: FormData) {
  return Object.fromEntries(fieldNames.map((fieldName) => {
    const value = formData.get(fieldName);
    return [fieldName, typeof value === "string" ? value : value?.name ?? ""];
  })) as Record<string, string>;
}

function success(values: Record<string, string>, message: string): IncomingReceiveActionState {
  return {
    success: true,
    message,
    fieldErrors: {},
    values: {
      ...values,
      quantity: "",
      lotCode: "",
      reference: "",
      notes: "",
      overrideReason: ""
    }
  };
}

function failure(
  message: string,
  fieldErrors: Record<string, string[] | undefined>,
  domainErrorCode: string,
  values: Record<string, string>
): IncomingReceiveActionState {
  return {
    success: false,
    message,
    fieldErrors: Object.fromEntries(Object.entries(fieldErrors).filter(([, value]) => value && value.length > 0)) as Record<string, string[]>,
    domainErrorCode,
    values
  };
}

function domainFailure(error: unknown, values: Record<string, string>): IncomingReceiveActionState {
  if (error instanceof AuthorizationError) {
    return failure(error.message, {}, "UNAUTHORIZED", values);
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return failure("Duplicate lot code for this item. Use a unique lot/packing slip code for this receipt.", {
      lotCode: ["Lot code already exists for this item."]
    }, "DUPLICATE_LOT_CODE", values);
  }

  const message = error instanceof Error ? error.message : String(error);
  return failure(humanizeDomainMessage(message), {}, domainErrorCodeForMessage(message), values);
}

function domainErrorCodeForMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("remaining ordered quantity")) return "OVER_RECEIPT";
  if (normalized.includes("obsolete")) return "OBSOLETE_ITEM";
  if (normalized.includes("positive")) return "INVALID_QUANTITY";
  if (normalized.includes("exactly one") || normalized.includes("lot")) return "LOT_PROVENANCE";
  if (normalized.includes("cannot receive against")) return "ORDER_NOT_RECEIVABLE";
  return "RECEIVING_REJECTED";
}

function humanizeDomainMessage(message: string) {
  if (domainErrorCodeForMessage(message) === "OVER_RECEIPT") {
    return `Receiving rejected: ${message}`;
  }
  if (domainErrorCodeForMessage(message) === "ORDER_NOT_RECEIVABLE") {
    return `Receiving rejected: ${message}`;
  }
  return message;
}
