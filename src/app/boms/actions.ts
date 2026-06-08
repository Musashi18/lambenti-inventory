"use server";

import { revalidateWorkspace } from "@/app/revalidate-workspace";
import { requirePermission } from "@/modules/auth/permissions";
import { addBomLine, consumeBomBuild, createBomSection, removeBomLine, updateBomLine, updateBomLineQuantity } from "@/modules/boms/service";

export async function createBomSectionAction(formData: FormData) {
  const parentItemId = readString(formData, "parentItemId");
  if (!parentItemId) throw new Error("Choose a finished unit from the item master before creating a BOM section.");

  const actor = await requirePermission("item:edit");
  await createBomSection({
    parentItemId,
    actorId: actor.id,
    actorType: actor.actorType === "AGENT" ? "AGENT" : "USER"
  });
  revalidateWorkspace(["/boms", "/inventory/movements", "/inventory/valuation"]);
}

export async function addBomLineAction(formData: FormData) {
  const bomId = readString(formData, "bomId");
  const componentItemId = readString(formData, "componentItemId");
  const quantity = Number(readString(formData, "quantity"));
  if (!bomId || !componentItemId) throw new Error("Choose a BOM section and component item before adding a line.");
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("BOM quantity per unit must be a positive whole number.");

  const actor = await requirePermission("item:edit");
  await addBomLine({
    bomId,
    componentItemId,
    quantity,
    actorId: actor.id,
    actorType: actor.actorType === "AGENT" ? "AGENT" : "USER"
  });
  revalidateWorkspace(["/boms", "/inventory/movements", "/inventory/valuation"]);
}

export async function updateBomLineAction(formData: FormData) {
  const lineId = readString(formData, "lineId");
  const componentItemId = readString(formData, "componentItemId");
  const quantity = Number(readString(formData, "quantity"));
  if (!lineId || !componentItemId) throw new Error("Choose a BOM line and component item before saving.");
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("BOM quantity per unit must be a positive whole number.");

  const actor = await requirePermission("item:edit");
  await updateBomLine({
    lineId,
    componentItemId,
    quantity,
    actorId: actor.id,
    actorType: actor.actorType === "AGENT" ? "AGENT" : "USER"
  });
  revalidateWorkspace(["/boms", "/inventory/movements", "/inventory/valuation"]);
}

export async function removeBomLineAction(formData: FormData) {
  const lineId = readString(formData, "lineId");
  if (!lineId) throw new Error("Missing BOM line id.");

  const actor = await requirePermission("item:edit");
  await removeBomLine({
    lineId,
    actorId: actor.id,
    actorType: actor.actorType === "AGENT" ? "AGENT" : "USER"
  });
  revalidateWorkspace(["/boms", "/inventory/movements", "/inventory/valuation"]);
}

export async function updateBomLineQuantityAction(formData: FormData) {
  const lineId = readString(formData, "lineId");
  const quantity = Number(readString(formData, "quantity"));
  if (!lineId) {
    throw new Error("Missing BOM line id.");
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("BOM quantity per unit must be a positive whole number.");
  }

  const actor = await requirePermission("item:edit");
  await updateBomLineQuantity({
    lineId,
    quantity,
    actorId: actor.id,
    actorType: actor.actorType === "AGENT" ? "AGENT" : "USER"
  });
  revalidateWorkspace(["/boms", "/inventory/movements", "/inventory/valuation"]);
}

export async function consumeBomBuildAction(formData: FormData) {
  const bomId = readString(formData, "bomId");
  const buildQuantity = Number(readString(formData, "buildQuantity"));
  const reference = readString(formData, "reference");
  if (!bomId) {
    throw new Error("Missing BOM id.");
  }
  if (!Number.isInteger(buildQuantity) || buildQuantity <= 0) {
    throw new Error("Build quantity must be a positive whole number.");
  }

  const actor = await requirePermission("stockMovement:create");
  await consumeBomBuild({
    bomId,
    buildQuantity,
    reference: reference || undefined,
    actorId: actor.id,
    actorType: actor.actorType === "AGENT" ? "AGENT" : "USER"
  });
  revalidateWorkspace(["/boms", "/inventory/movements", "/inventory/valuation"]);
}

function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}
