import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

vi.mock("@/app/revalidate-workspace", () => ({
  revalidateWorkspace: vi.fn()
}));

vi.mock("@/modules/auth/permissions", () => ({
  requirePermission: vi.fn(async () => ({ actorType: "USER", id: "test-operator" }))
}));

vi.mock("@/modules/suppliers/service", () => ({
  archiveSupplierCleanupCandidates: vi.fn(async () => ({ archivedCount: 2, candidates: [] })),
  archiveSupplierProfile: vi.fn(),
  deleteArchivedSupplier: vi.fn(async () => {
    throw new Error("Archived supplier has historical purchasing or email records and cannot be hard-deleted. Keep it archived instead.");
  }),
  unarchiveSupplierProfile: vi.fn(),
  updateItemSupplierEntry: vi.fn(),
  updateSupplierContactProfile: vi.fn()
}));

import { revalidateWorkspace } from "@/app/revalidate-workspace";
import { archiveSupplierCleanupCandidatesAction, deleteArchivedSupplierAction, updateItemSupplierEntryAction } from "./actions";

describe("supplier server actions", () => {
  it("returns an inline failure instead of throwing a production server-component digest when archived delete is blocked", async () => {
    const form = new FormData();
    form.set("supplierId", "supplier-with-history");

    const result = await deleteArchivedSupplierAction(form);

    expect(result).toMatchObject({ success: false });
    expect(result.message).toMatch(/historical purchasing or email records/i);
  });

  it("archives cleanup candidates through a human-gated supplier edit action", async () => {
    const result = await archiveSupplierCleanupCandidatesAction();

    expect(result).toMatchObject({ success: true });
    expect(result.message).toMatch(/Archived 2 supplier cleanup candidate/);
  });

  it("revalidates all dependent cost views after a supplier-entry price update", async () => {
    const form = new FormData();
    form.set("itemId", "component-item");
    form.set("preferredSupplierId", "supplier-id");
    form.set("customSupplierName", "");
    form.set("supplierSku", "COMP-001");
    form.set("estimatedUnitCost", "1.25");
    form.set("costConfidence", "CONFIRMED");
    form.set("costSourceRef", "Supplier quote");

    await updateItemSupplierEntryAction(form);

    expect(revalidateWorkspace).toHaveBeenCalledTimes(1);
  });
});
