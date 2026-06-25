"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun, ShieldCheck, LayoutDashboard, History, ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReviewer } from "./reviewer";
import { Input } from "./ui/primitives";

const NAV = [
  { href: "/", label: "New Audit", icon: ScanSearch },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/audits", label: "History", icon: History },
];

export function Navbar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { reviewer, setReviewer } = useReviewer();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur no-print">
      <div className="container flex h-16 items-center gap-4">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" />
          </span>
          <span className="hidden sm:block">
            DealerQA <span className="text-primary">AI</span>
          </span>
        </Link>

        <nav className="ml-2 flex items-center gap-1">
          {NAV.map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <item.icon className="size-4" />
                <span className="hidden md:block">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Input
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
            placeholder="Reviewer name"
            className="hidden h-9 w-40 sm:block"
            aria-label="Reviewer name"
          />
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="grid size-9 place-items-center rounded-lg border hover:bg-accent"
            aria-label="Toggle dark mode"
          >
            {mounted && theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </div>
      </div>
    </header>
  );
}
