"use server";

import { GLAccountType } from "@prisma/client";
import { revalidateWorkspace } from "@/app/revalidate-workspace";
import { requirePermission } from "@/modules/auth/permissions";
import { installDefaultApPostingSetup, upsertGLAccount, upsertGLMapping } from "@/modules/accounting/gl";

export async function upsertGLAccountAction(formData: FormData) {
  const actor = await requirePermission("invoice:create");
  const code = stringField(formData, "code");
  const name = stringField(formData, "name");
  const type = stringField(formData, "type");
  if (!code || !name || !type || !Object.values(GLAccountType).includes(type as GLAccountType)) {
    return { ok: false, message: "Account code, name, and valid type are required." };
  }
  await upsertGLAccount({ code, name, type: type as GLAccountType, active: booleanField(formData, "active"), actorId: actor.id });
  revalidateWorkspace(["/accounting/accounts"]);
  return { ok: true, message: "GL account saved." };
}

export async function upsertGLMappingAction(formData: FormData) {
  const actor = await requirePermission("invoice:create");
  const scopeType = stringField(formData, "scopeType");
  const purpose = stringField(formData, "purpose");
  const glAccountId = stringField(formData, "glAccountId");
  if (!scopeType || !purpose || !glAccountId) return { ok: false, message: "Mapping scope, purpose, and account are required." };
  await upsertGLMapping({
    scopeType,
    scopeId: stringField(formData, "scopeId"),
    purpose,
    glAccountId,
    priority: numberField(formData, "priority"),
    active: booleanField(formData, "active"),
    actorId: actor.id
  });
  revalidateWorkspace(["/accounting/accounts"]);
  return { ok: true, message: "GL Mapping saved." };
}

export async function installDefaultApPostingSetupAction() {
  const actor = await requirePermission("invoice:create");
  const results = await installDefaultApPostingSetup({ actorId: actor.id });
  revalidateWorkspace(["/accounting", "/accounting/accounts", "/accounting/invoices", "/accounting/payments"]);
  const changed = results.filter((result) => result.status !== "kept").length;
  return {
    ok: true,
    message: changed === 0
      ? "Default AP posting mappings were already configured."
      : `Installed ${changed} default AP posting mapping${changed === 1 ? "" : "s"}.`
  };
}

function stringField(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(formData: FormData, key: string) {
  const value = stringField(formData, key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanField(formData: FormData, key: string) {
  return formData.get(key) !== "false";
}
