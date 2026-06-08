# Lambenti supplier order agent

The inventory app has a manual-first supplier order tracking agent. It can ingest supplier order evidence from two inputs:

1. **Order mailbox sync** for supplier emails that entail orders, invoices, receipts, payment confirmations, or shipment notices.
2. **Optional Alibaba portal reader** that reuses a local Chrome profile, reads visible Alibaba order/message pages, downloads invoice/receipt documents, and uploads snapshots to the local inventory app.

The workflow is intentionally **manual for now**: you run the agent or press the app sync button when you want it to check for new order evidence. It does not run on a schedule unless you explicitly add one later.

## What the sync does

- Imports relevant supplier order/email/portal evidence into auditable records.
- Reuses a local Google Chrome profile/session created by `npm run agent:alibaba-login` for the optional Alibaba portal reader.
- Detects CAPTCHA/security/2FA checks and stops for manual completion in Chrome; it does not bypass those checks.
- Reads Alibaba order/message pages and downloads invoice/receipt PDFs or invoice HTML pages into `var/alibaba-invoices` when the portal reader is used.
- Extracts invoice text when possible and stores source document path/hash/source URL provenance.
- De-duplicates by content hash and external order ID, so re-running sync is safe.
- Treats order/invoice/payment/receipt/shipping emails as relevant even when they are not from Alibaba.
- Explicitly rejects login/security-code noise.
- For confidently matched lines, creates or updates:
  - `EmailOrderImport`
  - `EmailOrderLineImport`
  - `PurchaseOrder` with status `ORDERED`
  - `SupplierInvoice` accounting/AP records
  - item cost/provenance/preferred supplier fields
  - audit log entries
- Surfaces follow-up work on the dashboard **Human approval queue**.
- Does **not** receive physical stock. Receiving remains a separate human-approved inventory ledger action.

## Direct Alibaba portal setup

Run this once from `C:/Users/musas/Desktop/lambenti-inventory`:

```bash
npm run agent:alibaba-login
```

A Google Chrome window opens. Sign into Alibaba manually, complete any 2FA/security/CAPTCHA checks, open the order/message center once, then return to the terminal and press Enter. CAPTCHA/security checks are manual-only; the agent detects them and will not bypass them.

The browser cookies are saved under `var/alibaba-chrome-profile`; later manual runs reuse that Chrome profile and do not need your password stored in the app. If Chrome saves/autofills the login fields in that profile, the agent may auto-submit those saved fields on later runs when Alibaba only shows the normal login form.

Configuration options in `.env`:

```env
LAMBENTI_ALIBABA_AGENT_SECRET=
LAMBENTI_ALIBABA_ORDERS_URL="https://www.alibaba.com/trade/order/list.htm"
LAMBENTI_ALIBABA_MESSAGES_URL="https://message.alibaba.com/"
LAMBENTI_ALIBABA_BROWSER_PROFILE_DIR="var/alibaba-chrome-profile"
LAMBENTI_ALIBABA_INVOICE_DIR="var/alibaba-invoices"
# Optional if Google Chrome is installed somewhere non-standard.
# LAMBENTI_ALIBABA_BROWSER_EXECUTABLE_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"
# Submit Chrome-saved/autofilled login fields automatically when Alibaba shows a normal login form.
# CAPTCHA/security/2FA checks are detected and require manual completion; they are not bypassed.
LAMBENTI_ALIBABA_AUTO_SUBMIT_SAVED_LOGIN="true"
LAMBENTI_ALIBABA_AUTH_SETTLE_MS="2000"
LAMBENTI_ALIBABA_BROWSER_STARTUP_SETTLE_MS="2000"
LAMBENTI_ALIBABA_LOGIN_SETTLE_MS="5000"
LAMBENTI_ALIBABA_HEADLESS="false"
```

Keep `LAMBENTI_ALIBABA_HEADLESS=false` unless there is a good reason to change it; supplier portals are less likely to challenge normal headed Chrome sessions.

## Google Workspace / Gmail setup

Google requires IMAP to be enabled and usually requires an app password. Do **not** use the main mailbox password.

1. Sign into the Lambenti Google mailbox in a browser.
2. Enable IMAP:
   - Gmail settings gear → **See all settings** → **Forwarding and POP/IMAP**.
   - Under **IMAP access**, select **Enable IMAP**.
   - Save changes.
3. Enable 2-step verification if it is not already enabled:
   - Google Account → **Security** → **2-Step Verification**.
4. Create an app password:
   - Google Account → **Security** → **App passwords**.
   - App: **Mail** or **Other**.
   - Name: `Lambenti Inventory`.
   - Copy the generated 16-character password.
5. Add these values to the real project `.env` file at `C:/Users/musas/Desktop/lambenti-inventory/.env`:

```env
LAMBENTI_EMAIL_IMAP_HOST="imap.gmail.com"
LAMBENTI_EMAIL_IMAP_PORT="993"
LAMBENTI_EMAIL_IMAP_SECURE="true"
LAMBENTI_EMAIL_IMAP_USER="your-lambenti-google-email@example.com"
LAMBENTI_EMAIL_IMAP_PASSWORD=
LAMBENTI_EMAIL_IMAP_MAILBOX="INBOX"
LAMBENTI_EMAIL_AUTO_APPLY="true"
LAMBENTI_EMAIL_AUTO_CREATE_INVOICE="true"
LAMBENTI_EMAIL_MARK_IMPORTED_SEEN="false"
LAMBENTI_EMAIL_SYNC_MAX_MESSAGES="25"
LAMBENTI_EMAIL_SYNC_SINCE_DAYS="60"
LAMBENTI_EMAIL_SYNC_SECRET=
# Optional if the app is not served at the default local URL.
LAMBENTI_INVENTORY_BASE_URL="http://127.0.0.1:5173"
```

Restart the inventory app after changing `.env`; Next.js reads these values at server startup.

Common provider reference:

| Provider | IMAP host | Port | Secure |
| --- | --- | ---: | --- |
| Google Workspace / Gmail | `imap.gmail.com` | `993` | `true` |
| Microsoft 365 / Outlook | `outlook.office365.com` | `993` | `true` |
| Zoho Mail | `imap.zoho.com` | `993` | `true` |
| Namecheap Private Email | `mail.privateemail.com` | `993` | `true` |

## Manual sync from the app

Open either route:

```text
/integrations/email-import
/integrations/alibaba-email
```

Use **Sync mailbox now**. The generalized route label in the app is **Order Email Agent**.

## Local manual agent scripts

The repository includes these local entry points:

```bash
npm run agent:orders -- --verbose          # portal reader first, then mailbox fallback
npm run agent:order-email -- --verbose     # mailbox-only order email sync
npm run agent:alibaba-login                # one-time interactive Alibaba login/session setup
npm run agent:alibaba-portal -- --dry-run --verbose

# Backward-compatible aliases:
npm run agent:alibaba -- --verbose
npm run agent:alibaba-email -- --verbose
```

- `agent:orders` runs the optional Alibaba portal reader/downloader first, then the mailbox fallback.
- `agent:order-email` runs only the mailbox sync.
- With `--verbose`, scripts print a sync summary even when there is nothing new.
- Without `--verbose`, scripts stay quiet unless they import a new portal/email order, create/update an invoice, need first-time login, or hit an error.
- New order notifications include supplier, external order ID, total/subtotal/shipping/tax when available, matched Lambenti SKU, quantity, unit price, line subtotal, landed unit cost, invoice provenance, and review links.

## Local API endpoints

When the app is running, manual scripts call these local endpoints:

```bash
curl -fsS -X POST http://127.0.0.1:5173/api/integrations/alibaba-email/sync
curl -fsS -X POST http://127.0.0.1:5173/api/integrations/alibaba-portal/import \
  -H 'content-type: application/json' \
  -d '{"snapshots":[{"sourceUrl":"https://example.alibaba.com/order","text":"Order Number: 123456789 Supplier: Example Factory Product: LED-COB-12V-3000K qty 100 unit price USD 0.86 total USD 86.00 Total USD 86.00"}]}'
```

If `LAMBENTI_EMAIL_SYNC_SECRET` or `LAMBENTI_ALIBABA_AGENT_SECRET` is set, include it as an authorization bearer token or as a `secret` query parameter. Keeping a sync token set is recommended even for local manual automation.

## Review and approval flow

After each manual run:

1. Open the dashboard and check **Human approval queue**.
2. Review any imported orders or unmatched lines.
3. Approve/pay invoices only after verifying the supplier document.
4. Receive physical stock only after the shipment arrives and you have counted it.

The agent can create order/invoice metadata automatically, but inventory stock movements remain ledger-protected and human-confirmed.
