import type { Metadata } from "next";
import "@/app/globals.css";
import { Sidebar } from "@/components/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";

const themeInitScript = `
  (() => {
    try {
      const storageKey = "lambenti-theme";
      const storedTheme = window.localStorage.getItem(storageKey);
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const theme = storedTheme === "dark" || (!storedTheme && prefersDark) ? "dark" : "light";
      document.documentElement.dataset.theme = theme;
    } catch {
      document.documentElement.dataset.theme = "light";
    }
  })();
`;

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
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <div className="min-h-screen lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
          <Sidebar />
          <main className="min-w-0 p-4 lg:p-8">{children}</main>
        </div>
        <ThemeToggle />
      </body>
    </html>
  );
}

