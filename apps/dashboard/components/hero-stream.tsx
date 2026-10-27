"use client";

const ROWS: { label: string; blocked: boolean; delay: number }[] = [
  { label: "github.list_issues", blocked: false, delay: 0 },
  { label: "github.read_repo(payments-core)", blocked: true, delay: 1.1 },
  { label: "tickets.reply", blocked: false, delay: 2.3 },
  { label: "db.query(integration_tokens)", blocked: true, delay: 0.6 },
  { label: "slack.post(#eng-updates)", blocked: false, delay: 3.1 },
  { label: "email.send(amy.watson@…)", blocked: true, delay: 1.8 },
  { label: "payments.pay(5012-…)", blocked: false, delay: 4.0 },
  { label: "github.create_pr(<private>)", blocked: true, delay: 2.7 },
];

export function HeroStream() {
  return (
    <div className="card p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between text-[14px]">
        <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-[3px] bg-orange" />Incoming</span>
        <span className="font-mono text-[12.5px] text-ink-2">tool calls · passing through</span>
        <span className="flex items-center gap-2">Allowed<span className="h-2.5 w-2.5 rounded-[3px] bg-blue" /></span>
      </div>
      <div className="relative h-[340px] overflow-hidden rounded-2xl bg-[linear-gradient(90deg,#f6e4dc_0%,#f8ece6_49.6%,#edf1fe_50.4%,#e6ebfd_100%)]">
        <div className="absolute inset-0 opacity-[0.35] [background-image:radial-gradient(#0b0d12_0.6px,transparent_0.6px)] [background-size:9px_9px]" />
        {ROWS.map((r, i) => (
          <div key={i} className="absolute left-0 right-0" style={{ top: 14 + i * 40 }}>
            <div
              className="absolute whitespace-nowrap rounded-lg px-2.5 py-1 font-mono text-[11.5px] shadow-sm"
              style={{
                animation: `${r.blocked ? "chip-block" : "chip-pass"} 7s linear -${r.delay}s infinite`,
                background: r.blocked ? "#e2582b" : "#ffffff",
                color: r.blocked ? "#fff" : "#2b4bf2",
                border: r.blocked ? "none" : "1px solid #c9d2fb",
              }}>
              {r.label}
            </div>
          </div>
        ))}
        <div className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-ink" />
        <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-ink px-2 py-0.5 font-mono text-[11px] font-semibold tracking-[0.2em] text-white">SHIELD</div>
      </div>
      <div className="mt-3 flex justify-between font-mono text-[11.5px] text-muted">
        <span>time →</span>
        <span>orange = driven by untrusted content</span>
        <span>blue = what the user asked for</span>
      </div>
      <style>{`
        @keyframes chip-pass { 0% { transform: translateX(-40%); left: 0%; opacity: 0 } 6% { opacity: 1 } 46% { left: 34%; } 54% { left: 52%; } 92% { opacity: 1 } 100% { left: 92%; opacity: 0 } }
        @keyframes chip-block { 0% { transform: translateX(-40%); left: 0%; opacity: 0 } 6% { opacity: 1 } 44% { left: 30%; opacity: 1 } 52% { left: 33%; opacity: 0; filter: blur(2px) } 100% { left: 33%; opacity: 0 } }
      `}</style>
    </div>
  );
}
