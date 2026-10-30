// Real inbox for the live demo: reads recent mail from a Gmail account over IMAP with an app password.
// Read-only on purpose. The mailbox is opened read-only, so nothing is marked as read, moved or deleted, and the
// agent's actions (payments, outgoing email) stay simulated: an injected "email the statements to X" never
// reaches a real address.
//
// GMAIL_USER, GMAIL_APP_PASSWORD   the account and a Google app password (Google account > Security > App passwords)
// GMAIL_MAILBOX                    mailbox or label to read (default INBOX)
// GMAIL_LIMIT                      newest N messages (default 6, max 12, the live run's inbox limit)
// GMAIL_SINCE_HOURS                only messages from the last N hours (default 72)

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { LiveEmail } from "./live.js";

const MAX_BODY = 4000;

export function gmailConfigured() {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

export function gmailAccount() {
  return process.env.GMAIL_USER ?? null;
}

/** Plain text of an email: the text part, or the HTML part with tags removed. */
function plainText(text: string | undefined, html: string | false | undefined): string {
  const raw = text?.trim() || (html ? html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ") : "");
  return raw.replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_BODY);
}

export async function fetchGmailInbox(): Promise<LiveEmail[]> {
  if (!gmailConfigured()) throw new Error("Gmail is not configured: set GMAIL_USER and GMAIL_APP_PASSWORD in the root .env");
  const limit = Math.min(12, Math.max(1, Number(process.env.GMAIL_LIMIT ?? 6)));
  const sinceHours = Math.max(1, Number(process.env.GMAIL_SINCE_HOURS ?? 72));
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: process.env.GMAIL_USER!, pass: process.env.GMAIL_APP_PASSWORD!.replace(/\s+/g, "") },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock(process.env.GMAIL_MAILBOX ?? "INBOX", { readOnly: true });
  try {
    const uids = (await client.search({ since: new Date(Date.now() - sinceHours * 3600_000) }, { uid: true })) || [];
    const newest = uids.slice(-limit);
    const out: (LiveEmail & { date: number })[] = [];
    if (newest.length) {
      for await (const msg of client.fetch(newest, { source: true, uid: true }, { uid: true })) {
        if (!msg.source) continue;
        const p = await simpleParser(msg.source);
        out.push({
          from: p.from?.value?.[0]?.address ?? p.from?.text ?? "(unknown sender)",
          subject: (p.subject ?? "(no subject)").slice(0, 300),
          body: plainText(p.text, p.html) || "(empty message)",
          gmail: true,
          date: p.date?.getTime() ?? 0,
        });
      }
    }
    // oldest first, like the demo inbox, so "email #1" is the earliest
    return out.sort((a, b) => a.date - b.date).map(({ date: _d, ...e }) => e);
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }
}
