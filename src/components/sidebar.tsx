import {
  ArrowDownUp,
  Boxes,
  ClipboardList,
  Factory,
  LayoutDashboard,
  Mail,
  PackageSearch,
  Radar,
  ReceiptText,
  Route,
  ShoppingCart,
  Truck,
  Workflow
} from "lucide-react";
import { SidebarLogoControl } from "@/components/sidebar-logo-control";

const links = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/atlas", label: "Atlas", icon: Radar },
  { href: "/inventory/items", label: "Items", icon: Boxes },
  { href: "/inventory/movements", label: "Movements", icon: ArrowDownUp },
  { href: "/suppliers", label: "Suppliers", icon: Factory },
  { href: "/purchasing/recommendations", label: "Recommendations", icon: ShoppingCart },
  { href: "/purchasing/requests", label: "Approvals", icon: ClipboardList },
  { href: "/integrations/email-import", label: "Order Agent", icon: Mail },
  { href: "/tracking", label: "Tracking", icon: Route },
  { href: "/automation", label: "Automation", icon: Workflow },
  { href: "/boms", label: "BOMs", icon: ClipboardList },
  { href: "/incoming", label: "Receiving", icon: Truck },
  { href: "/inventory/valuation", label: "Valuation", icon: PackageSearch },
  { href: "/accounting", label: "Accounting", icon: ReceiptText }
];

export function Sidebar() {
  return (
    <aside className="isolate relative z-50 border-b border-slate-200 bg-white p-4 lg:min-h-screen lg:border-b-0 lg:border-r">
      <div className="mb-6">
        <SidebarLogoControl defaultImageUrl="/lambenti-logo-sidebar.webp" />
        <div className="px-3 text-xl font-semibold text-ink">Inventory and Sourcing</div>
      </div>
      <nav className="grid gap-1">
        {links.map(({ href, label, icon: Icon }) => (
          <a
            key={href}
            href={href}
            className="relative z-10 flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            <Icon className="h-4 w-4" />
            {label}
          </a>
        ))}
      </nav>
    </aside>
  );
}
