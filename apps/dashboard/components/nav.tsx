"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-ink text-white">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 2.5 4 5.5v6c0 4.7 3.3 8.6 8 10 4.7-1.4 8-5.3 8-10v-6l-8-3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="m8.5 12 2.4 2.4 4.6-4.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="font-display text-[19px] font-extrabold">AgentShield</span>
    </span>
  );
}

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/console", label: "Console" },
  { href: "/audit", label: "Audit" },
  { href: "/evaluation", label: "Evaluation" },
];

export function Nav() {
  const path = usePathname();
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    const check = () => api("/api/health").then(() => setOnline(true)).catch(() => setOnline(false));
    check();
    const t = setInterval(check, 8000);
    return () => clearInterval(t);
  }, []);
  return (
    <header className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-5 lg:px-10">
      <Link href="/"><Logo /></Link>
      <nav className="flex items-center gap-1 sm:gap-2">
        {LINKS.map((l) => {
          const active = l.href !== "/#how" && path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href}
              className={`rounded-full px-3 py-1.5 text-[15px] transition-colors ${active ? "bg-white text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}>
              {l.label}
            </Link>
          );
        })}
        <span className="ml-2 hidden items-center gap-2 rounded-full border border-line bg-white px-3.5 py-1.5 text-[13px] text-ink-2 md:flex">
          <span className={`h-2 w-2 rounded-full ${online === false ? "bg-orange" : "bg-blue pulse-dot"}`} />
          {online === false ? "Core offline: run pnpm dev" : "Shield core live"}
        </span>
      </nav>
    </header>
  );
}
