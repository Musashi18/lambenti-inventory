import type { Metadata } from "next";
import "@/app/globals.css";
import { Sidebar } from "@/components/sidebar";

export const metadata: Metadata = {
  title: "Lambenti Inventory",
  description: "Inventory and sourcing management for Lambenti"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
          <Sidebar />
          <main className="min-w-0 p-4 lg:p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}

