"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/request-service", label: "Request Service" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/test-tools", label: "Test Tools" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-block h-6 w-6 rounded-md bg-blue-600" aria-hidden />
          <span>Prowider · Lead Distribution</span>
        </Link>
        <nav className="flex items-center gap-1">
          {links.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={
                  "rounded-md px-3 py-1.5 text-sm font-medium transition " +
                  (active
                    ? "bg-blue-600 text-white"
                    : "text-slate-700 hover:bg-slate-100")
                }
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
