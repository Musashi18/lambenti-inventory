import Link from "next/link";
import {
  ArrowDownUp,
  Boxes,
  ClipboardList,
  Factory,
  LayoutDashboard,
  PackageSearch,
  ShoppingCart,
  Truck
} from "lucide-react";

const links = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inventory/items", label: "Items", icon: Boxes },
  { href: "/inventory/movements", label: "Movements", icon: ArrowDownUp },
  { href: "/suppliers", label: "Suppliers", icon: Factory },
  { href: "/purchasing/recommendations", label: "Recommendations", icon: ShoppingCart },
  { href: "/purchasing/requests", label: "Approvals", icon: ClipboardList },
  { href: "/boms", label: "BOMs", icon: ClipboardList },
  { href: "/incoming", label: "Incoming", icon: Truck },
  { href: "/inventory/valuation", label: "Valuation", icon: PackageSearch }
];

export function Sidebar() {
  return (
    <aside className="border-b border-slate-200 bg-white p-4 lg:min-h-screen lg:border-b-0 lg:border-r">
      <div className="mb-6">
        <div className="text-xl font-semibold">Lambenti</div>
        <div className="text-xs text-slate-500">Inventory and sourcing</div>
      </div>
      <nav className="grid gap-1">
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
