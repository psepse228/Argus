"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api.me().then((user) => {
      if (user) router.replace("/app");
      else setChecked(true);
    });
  }, [router]);

  if (!checked) return null;

  return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="glass-panel" style={{ padding: "40px 44px", textAlign: "center", maxWidth: 360 }}>
        <div
          style={{
            width: 48, height: 48, borderRadius: 14, background: "var(--v-accent)",
            display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px",
          }}
        >
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="var(--v-text-on-accent)" strokeWidth={2.2}>
            <circle cx="12" cy="12" r="3.4" />
            <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
          </svg>
        </div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 20, margin: "0 0 6px", color: "var(--color-text)" }}>
          Argus
        </h1>
        <p style={{ color: "var(--color-text-soft)", fontSize: 13, margin: "0 0 24px" }}>
          AI-слой продаж · Italiano Vero
        </p>
        <a
          href={api.loginUrl()}
          style={{
            display: "inline-block", padding: "11px 26px", borderRadius: 12,
            background: "var(--v-accent)", color: "var(--v-text-on-accent)",
            fontWeight: 700, fontSize: 14,
          }}
        >
          Войти через Google
        </a>
      </div>
    </div>
  );
}
