import { revalidatePath } from "next/cache";

export const WORKSPACE_PATHS = [
  "/",
  "/inventory/items",
  "/inventory/movements",
  "/inventory/valuation",
  "/incoming",
  "/integrations/alibaba-email",
  "/integrations/email-import",
  "/purchasing/recommendations",
  "/purchasing/requests",
  "/suppliers",
  "/boms",
  "/accounting/invoices",
  "/automation"
];

export function revalidateWorkspace(extraPaths: string[] = []) {
  for (const path of Array.from(new Set([...WORKSPACE_PATHS, ...extraPaths]))) {
    revalidatePath(path);
  }
}
