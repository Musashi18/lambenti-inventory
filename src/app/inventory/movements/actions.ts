"use server";

import { MovementType, Prisma } from "@prisma/client";
import { revalidateWorkspace } from "@/app/revalidate-workspace";
import { z } from "zod";
import { createStockMovement, createStockMovementReversal, recordAssembledPackageMovement } from "@/modules/inventory/service";
import { AuthorizationError, requirePermission } from "@/modules/auth/permissions";
import { emptyMovementFormValues, type MovementActionState } from "./state";

const emptyValues = emptyMovementFormValues;
const buildMovementType = "BUILD" as const;

const optionalFormString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional()
);

const movementSchema = z.object({
  itemId: z.string().min(1, "Select an item."),
  stockLotId: optionalFormString,
  movementType: z.string().refine(
    (value) => value === buildMovementType || Object.values(MovementType).includes(value as MovementType),
    "Select a valid movement type."
  ),
  quantity: z.coerce.number({ invalid_type_error: "Enter a numeric quantity." }).int("Quantity must be a whole number."),
  reason: optionalFormString,
  reference: optionalFormString,
  newLotCode: optionalFormString,
  newLotReceivedAt: optionalFormString,
  newLotUnitCost: optionalFormString,
  newLotCurrency: optionalFormString
});

export async function createMovementAction(
  previousStateOrFormData: MovementActionState | FormData | undefined,
  maybeFormData?: FormData
): Promise<MovementActionState> {
  const formData = maybeFormData ?? (previousStateOrFormData instanceof FormData ? previousStateOrFormData : undefined);
  if (!formData) {
    return failure("Missing stock movement form data.", {}, "VALIDATION_ERROR", emptyValues);
  }

  const values = formValues(formData);
  const parsed = movementSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return failure("Fix the highlighted stock movement fields.", parsed.error.flatten().fieldErrors, "VALIDATION_ERROR", values);
  }

  try {
    const actor = await requirePermission("stockMovement:create");
    if (parsed.data.movementType === buildMovementType) {
      await recordAssembledPackageMovement({
        finishedItemId: parsed.data.itemId,
        quantity: parsed.data.quantity,
        reason: parsed.data.reason,
        reference: parsed.data.reference,
        actorType: actor.actorType === "AGENT" ? "AGENT" : "USER",
        actorId: actor.id
      });
      revalidateWorkspace();
      return success(values, "Assembled package movement recorded. Finished package stock was received and active BOM component inventory was consumed in one audited transaction.");
    }

    await createStockMovement({
      itemId: parsed.data.itemId,
      stockLotId: undefined,
      movementType: parsed.data.movementType as MovementType,
      quantity: parsed.data.quantity,
      reason: parsed.data.reason,
      reference: parsed.data.reference,
      actorType: actor.actorType === "AGENT" ? "AGENT" : "USER",
      actorId: actor.id
    });
    revalidateWorkspace();
    return success(values, "Stock movement recorded in the immutable ledger.");
  } catch (error) {
    return domainFailure(error, values);
  }
}

export async function voidStockMovementAction(formData: FormData) {
  const movementId = formData.get("movementId");
  if (typeof movementId !== "string" || movementId.trim() === "") {
    throw new Error("Missing stock movement id.");
  }
  const actor = await requirePermission("stockMovement:create");
  await createStockMovementReversal({
    movementId,
    actorType: actor.actorType === "AGENT" ? "AGENT" : "USER",
    actorId: actor.id
  });
  revalidateWorkspace(["/inventory/movements", "/inventory/valuation", "/", "/purchasing/recommendations"]);
}

function success(values: Record<string, string>, message: string): MovementActionState {
  return {
    success: true,
    message,
    fieldErrors: {},
    values: {
      ...values,
      quantity: "",
      reason: "",
      reference: "",
      newLotCode: "",
      newLotUnitCost: ""
    }
  };
}

function formValues(formData: FormData) {
  const fieldNames = [
    "itemId",
    "stockLotId",
    "movementType",
    "quantity",
    "reason",
    "reference",
    "newLotCode",
    "newLotReceivedAt",
    "newLotUnitCost",
    "newLotCurrency"
  ];
  return Object.fromEntries(fieldNames.map((fieldName) => {
    const value = formData.get(fieldName);
    return [fieldName, typeof value === "string" ? value : value?.name ?? ""];
  })) as Record<string, string>;
}

function failure(
  message: string,
  fieldErrors: Record<string, string[] | undefined>,
  domainErrorCode: string,
  values: Record<string, string>
): MovementActionState {
  return {
    success: false,
    message,
    fieldErrors: Object.fromEntries(Object.entries(fieldErrors).filter(([, value]) => value && value.length > 0)) as Record<string, string[]>,
    domainErrorCode,
    values
  };
}

function domainFailure(error: unknown, values: Record<string, string>): MovementActionState {
  if (error instanceof AuthorizationError) {
    return failure((error as Error).message, {}, "UNAUTHORIZED", values);
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return failure("Duplicate lot code for this item. Choose a different lot code or select the existing lot.", {
      newLotCode: ["Lot code already exists for this item."]
    }, "DUPLICATE_LOT_CODE", values);
  }

  const message = error instanceof Error ? error.message : String(error);
  return failure(humanizeDomainMessage(message), {}, domainErrorCodeForMessage(message), values);
}

function domainErrorCodeForMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("active bom")) return "BUILD_REQUIRES_ACTIVE_BOM";
  if (normalized.includes("duplicate") && normalized.includes("lot")) return "DUPLICATE_LOT_CODE";
  if (normalized.includes("negative lot stock")) return "NEGATIVE_LOT_STOCK";
  if (normalized.includes("negative")) return "NEGATIVE_STOCK";
  if (normalized.includes("does not belong to the selected item")) return "INVALID_LOT_FOR_ITEM";
  if (normalized.includes("receive movements require")) return "RECEIVE_REQUIRES_LOT_OR_REFERENCE";
  if (normalized.includes("reserve movements require")) return "RESERVE_REQUIRES_REFERENCE";
  if (normalized.includes("scrap movements require")) return "SCRAP_REQUIRES_DETAIL";
  if (normalized.includes("adjustment movements require")) return "ADJUST_REQUIRES_REFERENCE";
  return "STOCK_MOVEMENT_REJECTED";
}

function humanizeDomainMessage(message: string) {
  if (domainErrorCodeForMessage(message) === "NEGATIVE_LOT_STOCK") {
    return "Stock movement rejected: it would create negative lot stock. Select a lot with available stock or reduce the quantity.";
  }
  if (domainErrorCodeForMessage(message) === "NEGATIVE_STOCK") {
    return "Stock movement rejected: it would create negative item-level stock. Receive stock first or reduce the quantity.";
  }
  if (domainErrorCodeForMessage(message) === "INVALID_LOT_FOR_ITEM") {
    return "Stock movement rejected: the selected lot belongs to a different item.";
  }
  return message;
}
