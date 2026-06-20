import { describe, expect, it } from "vitest";
import { CostConfidence } from "@prisma/client";
import { parseAlibabaEmail } from "./alibaba-email";

describe("parseAlibabaEmail", () => {
  it("extracts Alibaba email order costs and line items", () => {
    const parsed = parseAlibabaEmail(`
From: Alibaba <orders@notice.alibaba.com>
Subject: Alibaba order confirmation
Order ID: 123456789
Supplier: China DDP Supplier / Confirmed Orders
Order Date: 2026-06-01
Product: LED-COB-12V-3000K qty 100 unit price USD 0.86 total USD 86.00
Product: PSU-12V-GS-UL qty 200 unit price USD 1.93 total USD 386.00
Shipping: USD 25.50
Total: USD 497.50
`);

    expect(parsed.externalOrderId).toBe("123456789");
    expect(parsed.supplierName).toBe("China DDP Supplier / Confirmed Orders");
    expect(parsed.currency).toBe("USD");
    expect(parsed.shippingCost).toBe(25.5);
    expect(parsed.totalCost).toBe(497.5);
    expect(parsed.confidence).toBe(CostConfidence.CONFIRMED);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0]).toMatchObject({
      rawDescription: "LED-COB-12V-3000K",
      quantity: 100,
      unitPrice: 0.86,
      lineTotal: 86,
      shippingAllocated: 4.65,
      landedUnitCost: 0.9065,
      currency: "USD"
    });
  });

  it("creates a fallback line when the email is not line-item structured", () => {
    const parsed = parseAlibabaEmail(`
Subject: Alibaba invoice
Order Number: AB-42
Supplier: Example Factory Ltd.
Description: Custom cable order
Quantity: 100
Unit Price: USD 1.76
Total: USD 176.00
`);

    expect(parsed.externalOrderId).toBe("AB-42");
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0].rawDescription).toBe("Custom cable order");
    expect(parsed.lines[0].quantity).toBe(100);
    expect(parsed.lines[0].unitPrice).toBe(1.76);
  });

  it("parses Alibaba initial payment emails with item subtotal, shipping, and inferred unit cost", () => {
    const parsed = parseAlibabaEmail(`
Subject: Your initial payment has been received (304447618001023166)
From: "Alibaba" <credit@notice.alibaba.com>
Your initial payment has been received (304447618001023166) Hi Musashi Kaneko, The supplier Mark Tang has received your initial payment for order no. 304447618001023166. View order details Total
USD 51.50
Order date
2026-06-05 19:22:59 PST
Your product and delivery information Stock Wholesale Back to Back Hook and Loop Strap Fastener Cable Organizer Colorful Reusable Cable Ties
Quantity: 1000
Variations: 1
Item subtotal: USD 15.00
Order summary (1 item) Item subtotal USD 15.00 Shipping fee USD 36.50 Total USD 51.50 Initial payment: USD 51.50 Remaining balance: USD 0.00
`);

    expect(parsed.externalOrderId).toBe("304447618001023166");
    expect(parsed.supplierName).toBe("Mark Tang");
    expect(parsed.shippingCost).toBe(36.5);
    expect(parsed.totalCost).toBe(51.5);
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]).toMatchObject({
      quantity: 1000,
      unitPrice: 0.015,
      lineTotal: 15,
      shippingAllocated: 36.5,
      landedUnitCost: 0.0515
    });
  });

  it("does not treat Alibaba shipment-message text as a valid supplier name", () => {
    const parsed = parseAlibabaEmail(`
Subject: Alibaba shipment update
From: "Alibaba" <notice@alibaba.com>
Order ID: 304716450001023166
Supplier: I will send you the international tracking number as soon as the logistics company provides it to
Message: Mark Tang 2026-6-5 Shenzhen Sunnice Textile Co., Limited Will ship out your order soon Mark Tang
Product: LED-COB-12V-3000K qty 1 unit price USD 1.00 total USD 1.00
Total: USD 1.00
`);

    expect(parsed.supplierName).toBe("Alibaba supplier");
  });

  it("keeps same-price LED color-temperature variants as separate Alibaba order lines", () => {
    const parsed = parseAlibabaEmail(`
Subject: Your initial payment has been received (300174506001023166)
From: "Alibaba" <credit@notice.alibaba.com>
Your initial payment has been received (300174506001023166) Hi Musashi Kaneko, The supplier jason zhou has received your initial payment for order no. 300174506001023166. View order details Total
USD 171.00
Order date
2026-04-27 17:40:29 PST
Your product and delivery information 480led 3000K 12v Cob Led Strip Lights
Quantity: 100
Variations: 1
Item subtotal: USD 68.00
View details
480led 6500K 12v Cob Led Strip Light
Quantity: 100
Variations: 1
Item subtotal: USD 68.00
View details
Order summary (2 items) View details Item subtotal USD 136.00 Shipping fee USD 35.00 Total USD 171.00 Initial payment: USD 171.00 Remaining balance: USD 0.00
`);

    expect(parsed.externalOrderId).toBe("300174506001023166");
    expect(parsed.supplierName).toBe("jason zhou");
    expect(parsed.shippingCost).toBe(35);
    expect(parsed.totalCost).toBe(171);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines.map((line) => line.rawDescription)).toEqual([
      "480led 3000K 12v Cob Led Strip Lights",
      "480led 6500K 12v Cob Led Strip Light"
    ]);
    expect(parsed.lines.map((line) => line.quantity)).toEqual([100, 100]);
    expect(parsed.lines.map((line) => line.unitPrice)).toEqual([0.68, 0.68]);
    expect(parsed.lines.map((line) => line.lineTotal)).toEqual([68, 68]);
    expect(parsed.lines.map((line) => line.shippingAllocated)).toEqual([17.5, 17.5]);
  });

  it("differentiates several repeated SKU/description blocks in one supplier email", () => {
    const parsed = parseAlibabaEmail(`
From: supplier@example.com
Subject: Alibaba Order 12345 Invoice
Order ID: 12345
Supplier: Example Multi Item Factory
Currency: USD

SKU: LED-COB-12V-3000K
Description: LED strip warm white
Quantity: 10
Unit price: 2.50
Line total: 25.00

SKU: PSU-12V-GS-UL
Description: 12V power adapter
Quantity: 5
Unit price: 3.00
Line total: 15.00

Shipping: 4.00
Total: 44.00
`);

    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0]).toMatchObject({
      supplierSku: "LED-COB-12V-3000K",
      rawDescription: "LED-COB-12V-3000K - LED strip warm white",
      quantity: 10,
      unitPrice: 2.5,
      lineTotal: 25,
      shippingAllocated: 2.5,
      landedUnitCost: 2.75
    });
    expect(parsed.lines[1]).toMatchObject({
      supplierSku: "PSU-12V-GS-UL",
      rawDescription: "PSU-12V-GS-UL - 12V power adapter",
      quantity: 5,
      unitPrice: 3,
      lineTotal: 15,
      shippingAllocated: 1.5,
      landedUnitCost: 3.3
    });
  });

  it("splits smart natural supplier item rows into one editable line per distinct item", () => {
    const parsed = parseAlibabaEmail(`
From: supplier@example.com
Subject: Mixed order invoice
Order ID: MIX-9001
Supplier: Smart Row Factory
Currency: USD

Items ordered:
- LED strip warm white 3000K | 10 pcs | USD 2.50 each | USD 25.00
- 12V GS/UL power adapter | 5 pcs | USD 3.00 each | USD 15.00
- Stainless M2 hex bolts 16mm | 1000 pcs | USD 0.06 each | USD 60.00

Shipping: USD 4.00
Total: USD 104.00
`);

    expect(parsed.lines).toHaveLength(3);
    expect(parsed.lines.map((line) => line.rawDescription)).toEqual([
      "LED strip warm white 3000K",
      "12V GS/UL power adapter",
      "Stainless M2 hex bolts 16mm"
    ]);
    expect(parsed.lines.map((line) => line.quantity)).toEqual([10, 5, 1000]);
    expect(parsed.lines.map((line) => line.unitPrice)).toEqual([2.5, 3, 0.06]);
    expect(parsed.lines.map((line) => line.lineTotal)).toEqual([25, 15, 60]);
  });

  it("splits compact compound item summaries into one row per product", () => {
    const parsed = parseAlibabaEmail(`
From: supplier@example.com
Subject: Compact multi-item invoice
Order ID: COMPACT-77
Supplier: Compact Factory Ltd.
Currency: USD
Items: LED strip warm white 3000K x 10 @ USD 2.50 = USD 25.00; 12V GS/UL power adapter x 5 @ USD 3.00 = USD 15.00; Stainless M2 hex bolts 16mm x 1000 @ USD 0.06 = USD 60.00
Shipping: USD 4.00
Total: USD 104.00
`);

    expect(parsed.lines).toHaveLength(3);
    expect(parsed.lines.map((line) => line.rawDescription)).toEqual([
      "LED strip warm white 3000K",
      "12V GS/UL power adapter",
      "Stainless M2 hex bolts 16mm"
    ]);
    expect(parsed.lines.map((line) => line.quantity)).toEqual([10, 5, 1000]);
  });

  it("splits Alibaba graphical product-card text into separate line items", () => {
    const parsed = parseAlibabaEmail(`
Subject: Your initial payment has been received (304445754001023166)
From: "Alibaba" <credit@notice.alibaba.com>
Your initial payment has been received (304445754001023166)
Hi Musashi Kaneko, The supplier Anna Liu has received your initial payment for order no. 304445754001023166.
View order details
Total USD 353.00
Order date 2026-06-05 19:05:29 PST
Your product and delivery information
M2*2*3mm Brass Insert Nut
Quantity: 1000
Variations: 1
Item subtotal: USD 30.00
View details
M2*4*3.5mm Brass Insert Nut
Quantity: 4000
Variations: 1
Item subtotal: USD 140.00
View details
M2*16mm Button Head Machine Screw Brass
Quantity: 1000
Variations: 1
Item subtotal: USD 50.00
View details
M2*4mm Button Head Machine Screw Brass
Quantity: 1000
Variations: 1
Item subtotal: USD 40.00
View details
Order summary (4 items)
Item subtotal USD 260.00
Shipping fee USD 93.00
Total USD 353.00
`);

    expect(parsed.externalOrderId).toBe("304445754001023166");
    expect(parsed.lines).toHaveLength(4);
    expect(parsed.lines.map((line) => line.rawDescription)).toEqual([
      "M2*2*3mm Brass Insert Nut",
      "M2*4*3.5mm Brass Insert Nut",
      "M2*16mm Button Head Machine Screw Brass",
      "M2*4mm Button Head Machine Screw Brass"
    ]);
    expect(parsed.lines.map((line) => line.quantity)).toEqual([1000, 4000, 1000, 1000]);
    expect(parsed.lines.map((line) => line.lineTotal)).toEqual([30, 140, 50, 40]);
    expect(parsed.lines.map((line) => line.unitPrice)).toEqual([0.03, 0.035, 0.05, 0.04]);
  });

  it("keeps similar Alibaba product cards as distinct lines when quantity and price match", () => {
    const parsed = parseAlibabaEmail(`
Subject: Your initial payment has been received (304716450001023166)
From: "Alibaba" <credit@notice.alibaba.com>
Your initial payment has been received (304716450001023166)
Hi Musashi Kaneko,
The supplier Winnie XU has received your initial payment for order no. 304716450001023166.
View order details
Total
USD 145.50
Order date
2026-06-08 18:24:26 PST
Your product and delivery information
Super Glue Self-adhesive Car Cable Clamp 3m Adhesive Cable Clips Clamps Plastic Nylon Cable Organizer Clip
Quantity: 1000
Variations: 1
Item subtotal: USD 20.00
View details
White Adhesive Nylon Cable Clips & Organizers (R Type Model WCL-0805) for Industrial Use-Wire Holders & Cord Management
Quantity: 500
Variations: 1
Item subtotal: USD 10.00
View details
Self-adhesive Wire Rope Clip 3m Adhesive Cable Clips Plastic Nylon Cable Organizer 14.5MM*15.8MM
Quantity: 1000
Variations: 1
Item subtotal: USD 20.00
View details
Order summary (3 items)
Item subtotal USD 50.00
Shipping fee USD 95.50
Total USD 145.50
Initial payment: USD 145.50
`);

    expect(parsed.externalOrderId).toBe("304716450001023166");
    expect(parsed.lines).toHaveLength(3);
    expect(parsed.lines.map((line) => line.rawDescription)).toEqual([
      "Super Glue Self-adhesive Car Cable Clamp 3m Adhesive Cable Clips Clamps Plastic Nylon Cable Organizer Clip",
      "White Adhesive Nylon Cable Clips & Organizers (R Type Model WCL-0805) for Industrial Use-Wire Holders & Cord Management",
      "Self-adhesive Wire Rope Clip 3m Adhesive Cable Clips Plastic Nylon Cable Organizer 14.5MM*15.8MM"
    ]);
    expect(parsed.lines.map((line) => line.quantity)).toEqual([1000, 500, 1000]);
    expect(parsed.lines.map((line) => line.lineTotal)).toEqual([20, 10, 20]);
  });

  it("extracts order numbers from Alibaba Trade Assurance status emails", () => {
    const parsed = parseAlibabaEmail(`
Subject: The payment status for your Trade Assurance order 303671327001023166 has changed
From: "Alibaba" <credit@notice.alibaba.com>
The payment status for your Trade Assurance order 303671327001023166 has changed.
Click to view order details.
Total USD 292.00
Your product and delivery information
5952 pad with tab
Quantity: 500
Item subtotal: USD 150.00
View details
5952 pad with tab small one
Quantity: 500
Item subtotal: USD 75.00
Order summary (2 items)
Item subtotal USD 225.00
Shipping fee USD 67.00
Total USD 292.00
`);

    expect(parsed.externalOrderId).toBe("303671327001023166");
    expect(parsed.lines).toHaveLength(2);
  });

  it("parses supplier invoice tables with source URLs, invoice IDs, delivery, tax, and description-first rows", () => {
    const parsed = parseAlibabaEmail(`
From: "Arc Circuit Supply" <sales@arccircuit.example>
Subject: Invoice INV-2026-018 for PO LAMBENTI-42
Vendor: Arc Circuit Supply Co., Ltd.
Invoice No: INV-2026-018
Invoice Date: Jun 7, 2026
Source: https://supplier.example/orders/INV-2026-018
Currency: USD

Description | Supplier SKU | Qty | Unit Cost | Amount
Custom UL2464 24 AWG 2C 1.5 m cable | CABLE-UL2464-2C-1P5M | 100 | US$1.7639 | US$176.39
Molex Micro-Fit 3.0 Vertical Connector | 430450200 | 200 | $0.4247 | $84.94

Delivery fee: US$22.00
GST/HST: US$0.00
Amount due: US$283.33
`);

    expect(parsed.externalOrderId).toBe("INV-2026-018");
    expect(parsed.supplierName).toBe("Arc Circuit Supply Co., Ltd.");
    expect(parsed.sourceUrl).toBe("https://supplier.example/orders/INV-2026-018");
    expect(parsed.shippingCost).toBe(22);
    expect(parsed.taxCost).toBe(0);
    expect(parsed.totalCost).toBe(283.33);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0]).toMatchObject({
      rawDescription: "CABLE-UL2464-2C-1P5M - Custom UL2464 24 AWG 2C 1.5 m cable",
      supplierSku: "CABLE-UL2464-2C-1P5M",
      quantity: 100,
      unitPrice: 1.7639,
      lineTotal: 176.39
    });
    expect(parsed.lines[1]).toMatchObject({
      rawDescription: "430450200 - Molex Micro-Fit 3.0 Vertical Connector",
      supplierSku: "430450200",
      quantity: 200,
      unitPrice: 0.4247,
      lineTotal: 84.94
    });
  });

  it("parses checkout-style supplier rows with varied unit-cost wording and source links", () => {
    const parsed = parseAlibabaEmail(`
From: Shopify Supplier <orders@shop.example>
Subject: Receipt for order #SF-7781
Seller name: Bright Strip Factory
Order link: https://shop.example/orders/SF-7781?token=abc
Paid on: 06/07/2026
1) LED COB strip 3000K SKU LED-COB-12V-3000K — Qty 20 pcs — Unit Cost USD 2.75/pc — Line Amount USD 55.00
2) 12V GS/UL power adapter SKU PSU-12V-GS-UL — Qty 8 pcs — Unit Cost USD 4.80 each — Line Amount USD 38.40
Freight charge USD 12.60
VAT USD 0.00
Total paid USD 106.00
`);

    expect(parsed.externalOrderId).toBe("SF-7781");
    expect(parsed.supplierName).toBe("Bright Strip Factory");
    expect(parsed.sourceUrl).toBe("https://shop.example/orders/SF-7781?token=abc");
    expect(parsed.shippingCost).toBe(12.6);
    expect(parsed.taxCost).toBe(0);
    expect(parsed.totalCost).toBe(106);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines.map((line) => line.supplierSku)).toEqual(["LED-COB-12V-3000K", "PSU-12V-GS-UL"]);
    expect(parsed.lines.map((line) => line.quantity)).toEqual([20, 8]);
    expect(parsed.lines.map((line) => line.unitPrice)).toEqual([2.75, 4.8]);
    expect(parsed.lines.map((line) => line.lineTotal)).toEqual([55, 38.4]);
  });

  it("parses graphical confirmed-order summaries with compact x-quantity product cards", () => {
    const parsed = parseAlibabaEmail(`
From: Alibaba.com <transaction@notice.alibaba.com>
Subject: Order 8210374403313166 confirmed
Hi Musashi Kaneko,
Your order 8210374403313166 is confirmed. Click below to track its progress and rest easy knowing you’ll receive updates every step of the way!
Track order

1 Piece FOR DIP Pogo Pin Conn...
4P Height 4.5mm
x2

Order total
C$5.53
See order details
Ship to
[redacted]
`);

    expect(parsed.externalOrderId).toBe("8210374403313166");
    expect(parsed.currency).toBe("CAD");
    expect(parsed.totalCost).toBe(5.53);
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]).toMatchObject({
      rawDescription: "1 Piece FOR DIP Pogo Pin Conn... - 4P Height 4.5mm",
      quantity: 2,
      unitPrice: 2.765,
      lineTotal: 5.53,
      currency: "CAD"
    });
  });

  it("parses non-Alibaba graphical supplier receipts into categorized editable lines with detected prices", () => {
    const parsed = parseAlibabaEmail(`
From: Digi Components <receipts@digicomponents.example>
Subject: Receipt for order #DC-7788
Seller: Digi Components Canada
Thanks for your purchase

Order #DC-7788
Paid

Product image
Mini toggle switch SPDT panel mount
SKU SWT-SPDT-6MM
Qty
3
Price
CA$4.80
Item total
CA$14.40

Product image
12V GS/UL AC power adapter
SKU PSU-12V-GS-UL
Quantity
2
Unit price
CA$9.25
Amount
CA$18.50

Shipping
CA$6.00
GST/HST
CA$1.95
Order total
CA$40.85
`);

    expect(parsed.externalOrderId).toBe("DC-7788");
    expect(parsed.supplierName).toBe("Digi Components Canada");
    expect(parsed.currency).toBe("CAD");
    expect(parsed.shippingCost).toBe(6);
    expect(parsed.taxCost).toBe(1.95);
    expect(parsed.totalCost).toBe(40.85);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0]).toMatchObject({
      rawDescription: "Receipt — SWT-SPDT-6MM - Mini toggle switch SPDT panel mount",
      supplierSku: "SWT-SPDT-6MM",
      quantity: 3,
      unitPrice: 4.8,
      lineTotal: 14.4,
      currency: "CAD"
    });
    expect(parsed.lines[1]).toMatchObject({
      rawDescription: "Receipt — PSU-12V-GS-UL - 12V GS/UL AC power adapter",
      supplierSku: "PSU-12V-GS-UL",
      quantity: 2,
      unitPrice: 9.25,
      lineTotal: 18.5,
      currency: "CAD"
    });
  });

  it("differentiates visually similar OCR product-card items using associated image context", () => {
    const parsed = parseAlibabaEmail(`
From: Visual Supplier <orders@visual.example>
Subject: Receipt for order #VIS-3000-6500
Seller: Visual Supplier Factory
Order #VIS-3000-6500

Product image
Attachment filename: led-cob-strip-3000k-warm.jpg
COB LED strip
Qty
10
Unit price
USD 2.50
Line total
USD 25.00

Product image
Attachment filename: led-cob-strip-6500k-cool.jpg
COB LED strip
Qty
8
Unit price
USD 2.75
Line total
USD 22.00

Shipping USD 4.00
Order total USD 51.00
`);

    expect(parsed.externalOrderId).toBe("VIS-3000-6500");
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines.map((line) => line.rawDescription)).toEqual([
      "Receipt — COB LED strip - image led cob strip 3000k warm",
      "Receipt — COB LED strip - image led cob strip 6500k cool"
    ]);
    expect(parsed.lines.map((line) => line.productUrl)).toEqual([
      "image:led-cob-strip-3000k-warm.jpg",
      "image:led-cob-strip-6500k-cool.jpg"
    ]);
    expect(parsed.lines.map((line) => line.quantity)).toEqual([10, 8]);
  });

  it("keeps visually differentiated product-image cards separate even when text, quantity, and price match", () => {
    const parsed = parseAlibabaEmail(`
From: Visual Supplier <orders@visual.example>
Subject: Receipt for order #VIS-SAME-ECONOMICS
Seller: Visual Supplier Factory
Order #VIS-SAME-ECONOMICS

Product image
Attachment filename: led-cob-strip-3000k-warm.jpg
SKU LED-COMMON
COB LED strip
Qty
10
Unit price
USD 2.50
Line total
USD 25.00

Product image
Attachment filename: led-cob-strip-6500k-cool.jpg
SKU LED-COMMON
COB LED strip
Qty
10
Unit price
USD 2.50
Line total
USD 25.00

Order total USD 50.00
`);

    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines.map((line) => line.productUrl)).toEqual([
      "image:led-cob-strip-3000k-warm.jpg",
      "image:led-cob-strip-6500k-cool.jpg"
    ]);
    expect(parsed.lines.map((line) => line.rawDescription)).toEqual([
      "Receipt — LED-COMMON - COB LED strip - image led cob strip 3000k warm",
      "Receipt — LED-COMMON - COB LED strip - image led cob strip 6500k cool"
    ]);
  });

  it("carries attachment filename context through OCR text that repeats the Product image heading", () => {
    const parsed = parseAlibabaEmail(`
From: Visual Supplier <orders@visual.example>
Subject: Receipt for order #VIS-NESTED-IMAGE-HEADING
Seller: Visual Supplier Factory
Order #VIS-NESTED-IMAGE-HEADING

Product image
Attachment filename: magnetic-controller-render.png
Product image
Magnetic controller PCB render
Qty
3
Unit price
USD 12.00
Line total
USD 36.00

Order total USD 36.00
`);

    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]).toMatchObject({
      rawDescription: "Receipt — Magnetic controller PCB render - image magnetic controller render",
      productUrl: "image:magnetic-controller-render.png",
      quantity: 3,
      unitPrice: 12,
      lineTotal: 36
    });
  });

});
