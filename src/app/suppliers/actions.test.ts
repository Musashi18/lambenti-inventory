import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
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

import { archiveSupplierCleanupCandidatesAction, deleteArchivedSupplierAction } from "./actions";

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
});
