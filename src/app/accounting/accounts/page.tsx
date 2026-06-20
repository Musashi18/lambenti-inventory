import Link from "next/link";
import { GLAccountType } from "@prisma/client";
import { RefreshingActionForm } from "@/app/refreshing-action-form";
import { getChartOfAccounts } from "@/modules/accounting/gl";
import { requirePermission } from "@/modules/auth/permissions";
import { upsertGLAccountAction, upsertGLMappingAction, installDefaultApPostingSetupAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AccountingAccountsPage() {
  await requirePermission("accounting:view");
  const { accounts, mappings } = await getChartOfAccounts();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">GL Account Mapping</h1>
          <p className="max-w-3xl text-sm text-slate-600">
            Maintain the chart of accounts and mapping rules used by posted AP invoice/payment journals, GST/HST Exports, and landed-cost reports. Missing required mappings block posting instead of creating unbalanced entries.
          </p>
        </div>
        <Link href="/accounting" className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Back to Accounting</Link>
      </div>

      <section className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <h2 className="font-medium">Required Defaults for Posted AP Journals</h2>
            <p className="mt-1 text-xs">Configure these active DEFAULT mappings before approving supplier invoices or reconciling payments: INVENTORY_ASSET, TAX_RECOVERABLE, ACCOUNTS_PAYABLE, and BANK_CASH. More specific item/category/supplier mappings can override defaults.</p>
          </div>
          <RefreshingActionForm action={installDefaultApPostingSetupAction} className="lg:text-right">
            <button className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-white">Install Lambenti Default AP Setup</button>
            <p className="mt-1 text-[11px] text-blue-800">Creates safe starter accounts 1000/1060/1300/2000 only where no active default exists.</p>
          </RefreshingActionForm>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-medium">Add/Update GL Account</h2>
          <RefreshingActionForm action={upsertGLAccountAction} className="mt-3 grid gap-3 md:grid-cols-2">
            <input name="code" required placeholder="Code, e.g. 1300" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <input name="name" required placeholder="Account name" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <select name="type" required className="rounded-md border border-slate-300 px-2 py-1 text-sm">
              {Object.values(GLAccountType).map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <select name="active" className="rounded-md border border-slate-300 px-2 py-1 text-sm" defaultValue="true">
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
            <button className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-white md:col-span-2">Save Account</button>
          </RefreshingActionForm>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-medium">Add/Update Mapping</h2>
          <RefreshingActionForm action={upsertGLMappingAction} className="mt-3 grid gap-3 md:grid-cols-2">
            <select name="scopeType" required className="rounded-md border border-slate-300 px-2 py-1 text-sm">
              <option value="DEFAULT">Default</option>
              <option value="ITEM_CATEGORY">Item category</option>
              <option value="ITEM">Item id</option>
              <option value="SUPPLIER">Supplier id</option>
            </select>
            <input name="scopeId" placeholder="Scope id/category; blank for default" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <select name="purpose" required defaultValue="INVENTORY_ASSET" className="rounded-md border border-slate-300 px-2 py-1 text-sm">
              <option value="INVENTORY_ASSET">INVENTORY_ASSET — invoice-line debit / landed cost</option>
              <option value="TAX_RECOVERABLE">TAX_RECOVERABLE — GST/HST ITC debit</option>
              <option value="ACCOUNTS_PAYABLE">ACCOUNTS_PAYABLE — AP credit/debit</option>
              <option value="BANK_CASH">BANK_CASH — payment credit</option>
            </select>
            <select name="glAccountId" required className="rounded-md border border-slate-300 px-2 py-1 text-sm">
              <option value="">Choose account…</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
            </select>
            <input name="priority" type="number" placeholder="Priority" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <select name="active" className="rounded-md border border-slate-300 px-2 py-1 text-sm" defaultValue="true">
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
            <button className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-white md:col-span-2">Save Mapping</button>
          </RefreshingActionForm>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3"><h2 className="font-medium">Chart of Accounts</h2></div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Code</th><th className="px-4 py-3">Name</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Active</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {accounts.length === 0 ? <tr><td className="px-4 py-6 text-slate-500" colSpan={4}>No GL accounts configured.</td></tr> : accounts.map((account) => (
                <tr key={account.id}><td className="px-4 py-3 font-medium">{account.code}</td><td className="px-4 py-3">{account.name}</td><td className="px-4 py-3">{account.type}</td><td className="px-4 py-3">{account.active ? "Active" : "Inactive"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3"><h2 className="font-medium">Mappings</h2></div>
        <div className="divide-y divide-slate-100">
          {mappings.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">No GL Mappings configured.</p> : mappings.map((mapping) => (
            <div key={mapping.id} className="px-4 py-3 text-sm">
              <span className="font-medium">{mapping.purpose}</span> · {mapping.scopeType}{mapping.scopeId ? ` ${mapping.scopeId}` : ""} → {mapping.glAccount.code} {mapping.glAccount.name} · priority {mapping.priority} · {mapping.active ? "active" : "inactive"}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
