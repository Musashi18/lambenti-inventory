import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMessageThreadMemoryKey,
  buildPortalCaptureTargets,
  buildPortalImportPayload,
  buildTrackingOrderCandidateFingerprint,
  buildTrackingOrderMemoryKey,
  createEmptyTrackingCaptureMemory,
  isGenericLogisticsServicesCandidateText,
  isWaitingForSupplierToShipText,
  recordMessageThreadRead,
  recordTrackingOrderRead,
  readTrackingTargetUrls,
  resolvePortalImportOptions,
  seedTrackingCaptureMemoryFromSavedTrackingRows,
  shouldReadMessageThread,
  shouldSkipTrackingOrderCandidate
} from "./alibaba-portal-agent.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Alibaba portal agent CLI import mode", () => {
  it("turns the portal upload into tracking-only evidence capture when requested", () => {
    const options = resolvePortalImportOptions(["--json", "--tracking-only"]);
    const payload = buildPortalImportPayload([{ sourceUrl: "https://biz.alibaba.com/order/list.htm", text: "Tracking Number: LL270153423CN" }], options);

    expect(options).toEqual({ trackingOnly: true, autoApply: false, autoCreateInvoices: false });
    expect(payload).toMatchObject({
      autoApply: false,
      autoCreateInvoices: false,
      actorId: "alibaba-tracking-capture-agent"
    });
  });

  it("preserves the existing full portal-import behavior by default", () => {
    const options = resolvePortalImportOptions(["--json"]);

    expect(options).toEqual({ trackingOnly: false, autoApply: true, autoCreateInvoices: true });
    expect(buildPortalImportPayload([], options)).toMatchObject({
      autoApply: true,
      autoCreateInvoices: true,
      actorId: "alibaba-portal-agent"
    });
  });

  it("deep tracking mode scans lazy-loaded portal evidence before marking order/message candidates", () => {
    const source = readFileSync(join(__dirname, "alibaba-portal-agent.mjs"), "utf8");

    expect(source).toContain("await scrollThroughPortalEvidence(page)");
    expect(source).toContain("[role='feed']");
    expect(source).toContain("element.dispatchEvent(new Event(\"scroll\"");
  });

  it("tracking capture explicitly opens the Alibaba messenger page and reads individual message threads", () => {
    const source = readFileSync(join(__dirname, "alibaba-portal-agent.mjs"), "utf8");

    expect(source).toContain("https://message.alibaba.com/message/messenger.htm");
    expect(source).toContain("collectMessageCenterSnapshots");
    expect(source).toContain("markMessageThreadCandidates");
    expect(source).toContain("collectActiveMessageSectionText");
    expect(source).toContain("data-alibaba-agent-message-thread");
    expect(source).toContain("hasShippingTrackingMessageContext");
  });

  it("tracking capture checks delivering orders, completed-and-in-review orders, then message threads in that order", () => {
    const targets = buildPortalCaptureTargets(
      { trackingOnly: true, autoApply: false, autoCreateInvoices: false },
      {
        ordersUrl: "https://biz.alibaba.com/order/list.htm",
        messagesUrl: "https://message.alibaba.com/message/messenger.htm"
      }
    );

    expect(targets).toEqual([
      expect.objectContaining({ kind: "orders", orderStatus: "delivering", label: "orders-delivering" }),
      expect.objectContaining({ kind: "orders", orderStatus: "completed-review", label: "orders-completed-review" }),
      expect.objectContaining({ kind: "messages", label: "messages" })
    ]);
  });

  it("tracking capture checks email-provided Alibaba order-detail links directly before falling back to broad scans", () => {
    const targetUrl = "https://biz.alibaba.com/ta/detail.htm?orderId=304716450001023166&foo=bar";
    const targets = buildPortalCaptureTargets(
      { trackingOnly: true, autoApply: false, autoCreateInvoices: false },
      {
        ordersUrl: "https://biz.alibaba.com/order/list.htm",
        messagesUrl: "https://message.alibaba.com/message/messenger.htm",
        targetUrls: [targetUrl]
      }
    );

    expect(targets).toEqual([
      expect.objectContaining({
        kind: "orders",
        label: "orders-email-detail-1",
        targeted: true,
        url: targetUrl
      })
    ]);
    expect(readTrackingTargetUrls([
      "--tracking-target-url=https://example.com/not-alibaba",
      "--tracking-target-url",
      "https://biz.alibaba.com/order/detail.htm?orderId=305000000001023166"
    ], {
      LAMBENTI_ALIBABA_TRACKING_TARGET_URLS: "https://message.alibaba.com/message/messenger.htm?orderId=306000000001023166"
    })).toEqual([
      "https://biz.alibaba.com/order/detail.htm?orderId=305000000001023166",
      "https://message.alibaba.com/message/messenger.htm?orderId=306000000001023166"
    ]);
  });

  it("tracking capture uses fast tracking-specific order scans rather than invoice download passes", () => {
    const source = readFileSync(join(__dirname, "alibaba-portal-agent.mjs"), "utf8");

    expect(source).toContain("selectOrderStatusSurface(page, target.orderStatus)");
    expect(source).toContain("trackingOnly ? [] : await downloadInvoiceDocuments(page)");
    expect(source).toContain("trackingDetail");
    expect(source).toContain("messageThreadSettleMs");
    expect(source).toContain("portalScrollContainerLimit");
    expect(source).toContain("positiveInt(process.env.LAMBENTI_ALIBABA_MAX_LINKS, trackingOnly ? 4 : 12)");
    expect(source).toContain("positiveInt(process.env.LAMBENTI_ALIBABA_MAX_MESSAGE_THREADS, trackingOnly ? 12 : 20)");
    expect(source).toContain("LAMBENTI_ALIBABA_PORTAL_SCROLL_STEPS");
  });

  it("follows nested Track Package and Track Shipment(s) buttons before giving up on an order", () => {
    const source = readFileSync(join(__dirname, "alibaba-portal-agent.mjs"), "utf8");

    expect(source).toContain("collectNestedTrackingButtonSnapshots");
    expect(source).toContain("markTrackingActionCandidates");
    expect(source).toContain("data-alibaba-agent-tracking-action");
    expect(source).toContain("Track Package / Track Shipment(s)");
    expect(source).toContain("LAMBENTI_ALIBABA_MAX_TRACKING_CLICK_LAYERS");
    expect(source).toContain("maxCompletedReviewCandidates");
    expect(source).toContain("Math.max(maxCandidates, 24)");
    expect(source).toContain("data-alibaba-agent-detail-context");
    expect(source).toContain("rawCandidates.sort");
    expect(source).toContain("exactTrackingAction ? 20_000");
    expect(source).toContain("buyer_market_list");
  });

  it("skips tracking-order candidates that are waiting to ship or already have captured tracking numbers", () => {
    const memory = createEmptyTrackingCaptureMemory();
    const trackedOrder = {
      text: "Order ID: 304716450001023166\nStatus: Delivering\nTrack shipment",
      href: "https://biz.alibaba.com/order/detail.htm?orderId=304716450001023166"
    };
    const waitingOrder = {
      text: "Order ID: 305000000001023166\nWaiting for supplier to ship\nOrder details",
      href: "https://biz.alibaba.com/order/detail.htm?orderId=305000000001023166"
    };

    expect(isWaitingForSupplierToShipText(waitingOrder.text)).toBe(true);
    expect(shouldSkipTrackingOrderCandidate(waitingOrder, memory).skip).toBe(true);
    expect(shouldSkipTrackingOrderCandidate(waitingOrder, memory).reason).toBe("waiting-supplier-to-ship");

    recordTrackingOrderRead(memory, {
      key: buildTrackingOrderMemoryKey(trackedOrder),
      label: trackedOrder.text,
      orderId: "304716450001023166",
      trackingNumbers: ["888071620741"],
      source: "orders-delivering"
    });

    expect(shouldSkipTrackingOrderCandidate(trackedOrder, memory)).toMatchObject({
      skip: true,
      reason: "tracking-already-captured"
    });
    expect(shouldSkipTrackingOrderCandidate({ text: "Order ID: 306000000001023166\nStatus: Delivering\nTrack shipment" }, memory).skip).toBe(false);
  });

  it("hydrates tracking-order memory from saved TrackingNumber rows so already-saved order elements are not reopened", () => {
    const memory = createEmptyTrackingCaptureMemory();
    const summary = seedTrackingCaptureMemoryFromSavedTrackingRows(memory, [{
      trackingNumber: "888071620741",
      source: "ALIBABA_PORTAL",
      sourceUrl: "https://biz.alibaba.com/ta/detail.htm?orderId=304716450001023166#newBuyerShipment_1-heading",
      externalOrderId: "304716450001023166",
      currentStatus: "PENDING",
      emailOrderImport: {
        externalOrderId: "304716450001023166",
        sourceUrl: "https://biz.alibaba.com/order/list.htm",
        subject: "Alibaba order 304716450001023166"
      }
    }]);

    expect(summary).toEqual({ savedTrackingRowsHydrated: 1, savedTrackingOrdersHydrated: 1 });
    expect(memory.orders["order:304716450001023166"].trackingNumbers).toEqual(["888071620741"]);
    expect(shouldSkipTrackingOrderCandidate({
      label: "Track Package",
      href: "https://biz.alibaba.com/ta/detail.htm?orderId=304716450001023166",
      containerText: "Order ID: 304716450001023166\nCompleted & In Review\nTrack Package"
    }, memory)).toMatchObject({
      skip: true,
      reason: "tracking-already-captured"
    });
  });

  it("rejects Alibaba's generic Logistics Services marketplace link before clicking", () => {
    const memory = createEmptyTrackingCaptureMemory();
    const generic = {
      label: "Logistics services",
      href: "https://logistics.alibaba.com/buyer/luyou/blg/buyer_market_list.htm",
      text: "Logistics services https://logistics.alibaba.com/buyer/luyou/blg/buyer_market_list.htm"
    };

    expect(isGenericLogisticsServicesCandidateText(generic.text)).toBe(true);
    expect(shouldSkipTrackingOrderCandidate(generic, memory)).toMatchObject({
      skip: true,
      reason: "generic-logistics-services"
    });
    expect(isGenericLogisticsServicesCandidateText("Order ID: 304716450001023166\nLogistics details\nTracking Number: 888071620741")).toBe(false);
  });

  it("remembers checked order cards without tracking so unchanged stale entries stop blocking later candidates", () => {
    const memory = createEmptyTrackingCaptureMemory();
    const checkedOrder = {
      label: "Track Package",
      containerText: "Order ID: 304716450001023166\nCompleted & In Review\nSupplier Jason\nTrack Package",
      href: "https://biz.alibaba.com/ta/detail.htm?orderId=304716450001023166"
    };
    const fingerprint = buildTrackingOrderCandidateFingerprint(checkedOrder);

    expect(buildTrackingOrderMemoryKey(checkedOrder)).toBe("order:304716450001023166");
    recordTrackingOrderRead(memory, {
      ...checkedOrder,
      key: buildTrackingOrderMemoryKey(checkedOrder),
      fingerprint,
      trackingNumbers: []
    });

    expect(shouldSkipTrackingOrderCandidate({ ...checkedOrder, fingerprint }, memory)).toMatchObject({
      skip: true,
      reason: "already-checked-unchanged"
    });
    expect(shouldSkipTrackingOrderCandidate({
      ...checkedOrder,
      containerText: `${checkedOrder.containerText}\nTracking available`,
      fingerprint: "changed-card-fingerprint"
    }, memory).skip).toBe(false);
  });

  it("keeps order memory aligned to the clicked candidate key when the opened page text contains another order id", () => {
    const memory = createEmptyTrackingCaptureMemory();

    recordTrackingOrderRead(memory, {
      key: "order:304716450001023166",
      orderId: "303476570501023166",
      label: "Summary Details",
      text: "Order ID: 303476570501023166\nSummary Details",
      trackingNumbers: []
    });

    expect(memory.orders["order:304716450001023166"].orderId).toBe("304716450001023166");
  });

  it("records no-tracking order attempts so null/empty detail reads become stale on future runs", () => {
    const source = readFileSync(join(__dirname, "alibaba-portal-agent.mjs"), "utf8");

    expect(source).toContain("rememberTrackingOrderCandidateAttempt");
    expect(source).toContain("if (!candidateRemembered)");
    expect(source).toContain("trackingNumbers: input.trackingNumbers ?? []");
  });

  it("uses order-card context so generic Track Package buttons do not collapse into one stale memory key", () => {
    const first = buildTrackingOrderMemoryKey({
      label: "Track Package",
      containerText: "Order ID: 304716450001023166\nCompleted & In Review\nTrack Package"
    });
    const second = buildTrackingOrderMemoryKey({
      label: "Track Package",
      containerText: "Order ID: 299587687501023166\nCompleted & In Review\nTrack Package"
    });

    expect(first).toBe("order:304716450001023166");
    expect(second).toBe("order:299587687501023166");
    expect(first).not.toBe(second);
  });

  it("remembers message threads and rereads them only when the visible thread fingerprint changes", () => {
    const memory = createEmptyTrackingCaptureMemory();
    const firstThread = {
      label: "Jason Zhou Today Tracking number 7321315589070429",
      href: "https://message.alibaba.com/message/messenger.htm?conversationId=jason"
    };
    const secondThread = {
      label: "Seller Two Today Your package will ship soon",
      href: "https://message.alibaba.com/message/messenger.htm?conversationId=seller-two"
    };
    const firstKey = buildMessageThreadMemoryKey(firstThread);

    recordMessageThreadRead(memory, {
      key: firstKey,
      label: firstThread.label,
      listFingerprint: "same-preview",
      sectionText: "Tracking number 7321315589070429",
      trackingNumbers: ["7321315589070429"]
    });

    expect(shouldReadMessageThread({ ...firstThread, key: firstKey, listFingerprint: "same-preview" }, memory)).toMatchObject({
      read: false,
      reason: "already-read-no-new-messages"
    });
    expect(shouldReadMessageThread({ ...firstThread, key: firstKey, listFingerprint: "changed-preview" }, memory).read).toBe(true);
    expect(shouldReadMessageThread({ ...secondThread, listFingerprint: "new-thread-preview" }, memory).read).toBe(true);
  });

  it("dedupes nested Message Center elements from the same visible supplier thread card", () => {
    const source = readFileSync(join(__dirname, "alibaba-portal-agent.mjs"), "utf8");

    expect(source).toContain("duplicateThreadCard");
    expect(source).toContain("sameTextFamily");
    expect(source).toContain("sameVisualRow");
  });

  it("does not try to control Chrome's default user-data directory unless explicitly allowed", () => {
    const source = readFileSync(join(__dirname, "alibaba-portal-agent.mjs"), "utf8");

    expect(source).toContain("default-chrome-profile-blocked-dedicated");
    expect(source).toContain("LAMBENTI_ALIBABA_ALLOW_DEFAULT_CHROME_PROFILE_CONTROL");
    expect(source).toContain("isDefaultChromeUserDataDir");
    expect(source).toContain("dedicated Alibaba automation Chrome profile");
    expect(source).toContain("LAMBENTI_ALIBABA_SETUP_LOGIN_ASSIST");
    expect(source).toContain("pendingManualHandoff");
    expect(source).toContain("if (trackingOnly) break");
    expect(source).toContain("Finish the handoff there, close that Chrome window, then click Capture again");
    expect(source).toContain("process.env.LAMBENTI_EMAIL_IMAP_USER");
    expect(source).not.toContain("configured Chrome Work profile");
    expect(source).not.toContain("The Work Chrome profile is already open");
  });
});
