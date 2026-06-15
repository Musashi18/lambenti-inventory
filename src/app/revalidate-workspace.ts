import { revalidatePath } from "next/cache";

export const WORKSPACE_PATHS = [
  "/",
  "/inventory/items",
  "/inventory/movements",
  "/inventory/valuation",
  "/incoming",
  "/integrations/alibaba-email",
  "/integrations/email-import",
  "/tracking",
  "/purchasing/recommendations",
  "/purchasing/requests",
  "/suppliers",
  "/boms",
  "/accounting",
  "/accounting/invoices",
  "/accounting/customer-invoices",
  "/accounting/payments",
  "/accounting/exports",
  "/accounting/accounts",
  "/accounting/journals",
  "/accounting/landed-cost",
  "/automation"
];

export function revalidateWorkspace(extraPaths: string[] = []) {
  for (const path of Array.from(new Set([...WORKSPACE_PATHS, ...extraPaths]))) {
    revalidatePath(path);
  }
}
