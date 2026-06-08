import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermissionMock = vi.hoisted(() => vi.fn(async () => ({
  id: "operator-1",
  role: "ADMIN",
  type: "HUMAN",
  actorType: "USER"
})));
const importOrderMock = vi.hoisted(() => vi.fn(async () => ({})));
const applyImportMock = vi.hoisted(() => vi.fn(async () => ({})));
const updateLineMock = vi.hoisted(() => vi.fn(async () => ({})));
const archiveImportMock = vi.hoisted(() => vi.fn(async () => ({})));
const unarchiveImportMock = vi.hoisted(() => vi.fn(async () => ({})));
const deleteArchivedImportMock = vi.hoisted(() => vi.fn(async () => ({})));
const reassessMock = vi.hoisted(() => vi.fn(async () => ({ scanned: 0, refreshed: 0, skippedManual: 0 })));
const syncMailboxMock = vi.hoisted(() => vi.fn(async () => ({ configured: true, fetchedMessages: 1, errors: [] })));
const revalidateWorkspaceMock = vi.hoisted(() => vi.fn());

vi.mock("@/modules/auth/permissions", () => ({
  requirePermission: requirePermissionMock
}));

vi.mock("@/modules/email-imports/alibaba-email", () => ({
  importAlibabaEmailOrder: importOrderMock,
  applyAlibabaEmailOrderImport: applyImportMock,
  updateEmailOrderImportLine: updateLineMock,
  archiveEmailOrderImport: archiveImportMock,
  unarchiveEmailOrderImport: unarchiveImportMock,
  deleteArchivedEmailOrderImport: deleteArchivedImportMock,
  reassessRecentEmailOrderImports: reassessMock
}));

vi.mock("@/modules/email-imports/mailbox", () => ({
  syncAlibabaMailboxWithBackoff: syncMailboxMock
}));

vi.mock("@/app/revalidate-workspace", () => ({
  revalidateWorkspace: revalidateWorkspaceMock
}));

import {
  applyAlibabaEmailImportAction,
  archiveAlibabaEmailImportAction,
  importAlibabaEmailAction,
  reassessRecentAlibabaEmailImportsAction,
  syncAlibabaEmailMailboxAction,
  updateAlibabaEmailLineAction
} from "./actions";

function emailForm(rawText = "Subject: order\nOrder ID: AUTH-42\nSupplier: Auth Supplier\nProduct: LED qty 2 unit price USD 1.00 total USD 2.00") {
  const form = new FormData();
  form.set("rawText", rawText);
  form.set("autoApply", "on");
  return form;
}

describe("order email server actions authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermissionMock.mockResolvedValue({ id: "operator-1", role: "ADMIN", type: "HUMAN", actorType: "USER" });
    syncMailboxMock.mockResolvedValue({ configured: true, fetchedMessages: 1, errors: [] });
  });

  it("requires integration mutation permission and records the authenticated actor for manual email import", async () => {
    await importAlibabaEmailAction(emailForm());

    expect(requirePermissionMock).toHaveBeenCalledWith("integration:mutate");
    expect(importOrderMock).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "operator-1",
      autoApply: true,
      source: "MANUAL_EMAIL"
    }));
  });

  it("does not apply an import when the current actor lacks integration mutation permission", async () => {
    requirePermissionMock.mockRejectedValueOnce(new Error("VIEWER does not have permission for integration:mutate."));
    const form = new FormData();
    form.set("importId", "import-1");

    await expect(applyAlibabaEmailImportAction(form)).rejects.toThrow(/integration:mutate/i);
    expect(applyImportMock).not.toHaveBeenCalled();
  });

  it("uses the authenticated actor for line edits, archive, mailbox sync, and reassessment", async () => {
    const lineForm = new FormData();
    lineForm.set("lineId", "line-1");
    lineForm.set("rawDescription", "Edited line");
    lineForm.set("quantity", "2");
    lineForm.set("unitPrice", "1.25");
    lineForm.set("currency", "USD");
    lineForm.set("matchedItemId", "item-1");
    await updateAlibabaEmailLineAction(lineForm);

    const archiveForm = new FormData();
    archiveForm.set("importId", "import-1");
    await archiveAlibabaEmailImportAction(archiveForm);
    await syncAlibabaEmailMailboxAction();
    await reassessRecentAlibabaEmailImportsAction();

    expect(updateLineMock).toHaveBeenCalledWith(expect.objectContaining({ actorId: "operator-1" }));
    expect(archiveImportMock).toHaveBeenCalledWith("import-1", "operator-1", "Ignored from Order Email Agent");
    expect(syncMailboxMock).toHaveBeenCalledWith("operator-1");
    expect(reassessMock).toHaveBeenCalledWith("operator-1");
  });
});
