# Lambenti Current Operating Context — 2026-07-14

Use this note as the current Lambenti briefing context unless newer repository evidence clearly supersedes it. It supplements profile memory, `HERMES_STATE.md`, `TASK_QUEUE.md`, `DECISIONS.md`, `ISSUES.md`, recent sessions, and the daily research-brief prompt.

## Strategic state

- Lambenti is moving from advanced prototype development into first commercial validation.
- Immediate objective: produce a credible, sellable Phase I product; validate that customers understand and value the interaction; gather enough real-world evidence to decide whether a larger batch is justified.
- Do **not** optimize for broad scaling yet.
- Company mode: solo, self-funded premium consumer hardware startup.
- First target batch: founder-assembled roughly 20–50 units.
- Musashi recently lost employment and has roughly CAD$1,600 immediately available; inventory on hand was previously estimated around US$2.2k. Treat cash preservation and near-term sales as hard constraints.
- Working objective: reach an MVP launch and begin generating sales within about one month.

## Product promise and positioning

Lambenti is a premium ambient-lighting product where hidden magnetic spatial sensing turns a physical object on a desk/surface into a tactile light-control ritual. The public story should not reduce it to a novelty magnetic dimmer.

Current positioning directions:

- “Lambenti is a lighting brand that makes the ritual of turning on your lights actually satisfying.”
- “Intuitive Lighting. Designed to Satisfy.”
- “Shape Light” / “Shape Light with Magnetism” remains conceptually useful but may not be the primary public tagline.

Core differentiator:

- hidden interaction
- physical tactility
- smooth continuous light modulation
- satisfying ritual
- minimal visible technology
- premium ambient-lighting presentation

## White-light MVP status

The first commercial product remains a single-channel white ambient-lighting system using three MMC5603NJ magnetometers arranged in an equilateral triangle.

Current electronics/firmware baseline:

- ATmega328PB + MiniCore
- three MMC5603NJ magnetometers
- TCA9546A I²C multiplexer
- 12 V LED strip
- MOSFET low-side LED control
- approximately 31.25 kHz Timer1 PWM
- high-rate fractional smoothing near low brightness
- accepted firmware direction: V7 production-candidate lineage

Important interaction requirements:

- zero residual glow when magnet is absent
- smooth fades, especially near minimum brightness
- stable low-level PWM behavior
- useful outer interaction region
- narrow maximum-brightness center plateau
- no distracting jumps across sensor regions
- stable release behavior
- invisible normal-use sensor/interface hardware

Recent hardware/firmware note: a 2.2 nF capacitor to ground on PWM output eliminated remaining micro-glow. Recent firmware work has addressed center plateau size, spatial M-curve flattening, sensor-region continuity, low-PWM latching, desired-vs-applied PWM separation, and smoother near-off fading. Further firmware work should now require clear customer-observable benefit.

## Mechanical and installation direction

Current physical direction:

- 3D-printed enclosure for first batch
- PETG intended for functional final enclosure; matte PLA has been evaluated for surface appearance
- right-side LED connector orientation
- cable exits downward for strain relief
- M2 threaded inserts and screws
- 1.5 m UL2464 two-core 24 AWG jacketed cable
- Micro-Fit 3.0 connectors
- 12 V, 2 A power adapter
- nominal 2 m LED strip
- 3M VHB attachment for LED connector/installation hardware, with semi-permanent-adhesion warnings

Customer concerns to address: installation experience, cable routing, adhesive confidence, furniture marking risk, and visible installed hardware.

## Naming and product family

- “Lambenti Pure White” is exploratory for the initial single-channel white version; do not treat as final.
- “Basic” and “Dual-White” remain internal labels.
- Naming should support a coherent family without making the initial white-light product sound cheap or incomplete.
- Dual-white, rotation-based correlated color temperature control remains a credible follow-on product.
- RGB/spatial color work, including seven-sensor triangular exploration, is exploratory and should not distract from shipping/validating white-light MVP.

## Manufacturing and small-batch operations

Phase I philosophy:

- assemble first batch in-house
- preserve traceability
- document repeatable QA
- improve fixtures/tooling only where they remove meaningful risk or labor
- avoid large MOQs before demand validation
- outsource assembly only after product and demand are better understood

Inventory/operations app invariants:

- database is source of truth
- imported emails/orders/invoices/tracking records are evidence only until explicitly applied by a human
- accounting records must not silently modify physical inventory
- inventory changes require explicit receiving or stock-movement actions
- supplier communication, purchasing, invoice approval, payments, and receiving remain human-gated
- Atlas/agents are read-only or advisory unless a separately approved workflow exists

Research should prefer practical small-batch systems over enterprise theory: batch travelers, serial/lot traceability, fixture design, failure-mode-based QA, incoming inspection, first-article inspection, assembly time measurement, packaging checks, defect containment under 50 units, repair/rework policies, and golden-unit documentation.

## Packaging and onboarding

Packaging direction: premium, calm, restrained.

Visual direction:

- black exterior packaging
- warm glowing circular arc
- subtle upper-right flare
- thin/widely tracked LAMBENTI wordmark
- gold “SHAPE LIGHT” subtitle in the current logo direction

A printed black box has generally been preferred over pure debossing because it preserves glow/flare/wordmark/gold accent. Magnetic-flap rigid boxes and lift-off Apple-style rigid boxes have both been considered; architecture is not locked.

Insert direction: simplified EVA-layer structure organizing the control unit, magnetic actuator, power supply, LED strip/cable, installation accessories, small accessory boxes, and pull/ribbon features.

Quick-start guide is now an active requirement. Style target: simple vector line illustration, generic desks/installation surfaces, clear underside visibility, highlighted installation zones.

Research priorities: installation explanation under one minute, line-art clarity, reducing perceived installation risk, cable-routing diagrams, adhesive warnings without inducing fear, economical premium packaging for 20–50 units, and balancing unboxing theatre with shipping/damage protection.

## Customer validation

Survey state: current Lambenti Smart Lighting Survey is stronger and tests aesthetics, usage spaces, household purchase control, prior smart-light ownership, usage frequency, memorable product attributes, purchase comfort/likelihood, and concerns around price/installation/cables/visible hardware/adhesive/furniture damage.

One current version tests purchase likelihood around CAD $99 with shipping included. Treat this as a validation price point, not final pricing architecture.

Survey interest is insufficient. Next validation requires behavioral evidence:

- landing-page conversion
- email signups
- deposits/preorders where appropriate
- direct customer interviews
- installation testing
- customer-generated photos/video
- willingness to put Lambenti into a real desk/living-space setup

Research should help structure founder-led beta/testing, determine how many early users are enough, decide sold/discounted/loaned/tester-unit strategy, specify usage/installation data to collect, reduce bias from friends/supporters, and define evidence that would justify a 200-unit second batch.

## Marketing and content

Recent content signal: first two YouTube Shorts produced roughly 2,200 combined views, 35 likes, about 13 hours watch time, and 111 subscribers at latest review. Second Short showed stronger viewer behavior. Treat as encouraging early evidence, not proof of repeatable distribution.

Latest video strengths: close-up product/assembly footage, improved cinematography, detailed sound design, tactile connector/production moments, and loop continuity between ending LED glow and opening frame.

Recommended content rhythm:

- one long-form video about every two weeks
- two or three Shorts per week
- Shorts for discovery
- long-form for trust, founder attachment, and narrative depth

Potential long-form themes: why Lambenti exists, first-principles lighting interaction, engineering failures/fixes, prototype-to-first-batch path, launching with limited resources, personally manufacturing first units.

Research should connect process content to customer trust and sales, not only maker/engineer interest. Paid promotion should wait until landing page and measurable conversion objective exist.

## Brand and founder positioning

Musashi should be framed as a serious multidisciplinary hardware founder, not a hobbyist/content creator. Founder narrative should be demonstrated rather than inflated:

- self-taught product development
- embedded electronics, firmware, production tools, enclosure, packaging, brand/social strategy, inventory software, QA/manufacturing systems
- disciplined iteration under severe resource constraints
- transition from prototype to company

Current focus shift: marketing, educational content, e-commerce, commercial validation, manufacturing readiness.

## Website and e-commerce

A transaction-capable website is near-term required. Shopify is the current default unless a clearly superior low-risk alternative emerges.

Needs:

- compelling hero demonstration
- clear explanation of interaction
- installation reassurance
- product dimensions and compatibility
- cable/power details
- concise quick-start content
- pricing/shipping clarity
- email capture
- trustworthy founder/company story
- social proof as soon as customer material exists
- analytics for measuring purchase intent

Research should focus on conversion architecture for an unfamiliar physical interaction; a normal static lighting-product page may not communicate the satisfying tactile value.

## Network and meetings

Musashi is meeting/preparing to meet Chris Gibbs of Toronto Metropolitan University. Chris may introduce Eric Muellejans, relevant for hardware-founder experience and later B2B software transition.

These conversations should support commercial readiness, market wedge, founder-market fit, execution risk, evidence needed before raising/scaling, hardware economics/operational complexity, founder/advisor network, and whether Lambenti’s internal operational software has strategic future value without distracting from the consumer launch.

## Immediate risks

1. Overengineering before validation.
2. Insufficient behavioral demand evidence.
3. Capital scarcity.
4. Installation friction: adhesive, cables, furniture compatibility, unclear instructions.
5. Premium perception versus small-batch/3D-printed/founder-assembled reality.
6. Unclear Canada/US pricing architecture, shipping inclusion, naming, and future tiers.
7. Content audience mismatch: maker interest versus customer intent.
8. Founder capacity overload across engineering, production, content, brand, website, research, and operations.

## Research priorities for daily briefings

Highest priority:

- minimum credible commercial package for first sales
- evidence to collect from first 5, 10, and 20 customers
- founder-led hardware beta structure
- installation objections that suppress conversion
- low-volume premium packaging for 20–50 units
- premium perceived quality in 3D-printed production units
- QA controls for magnetically controlled lighting
- initial white-light pricing across Canada/US
- landing-page structure for unfamiliar tactile interaction
- founder content that creates customer trust/sales rather than only technical interest

Secondary priority:

- product-family naming, including “Pure White”
- dual-white willingness-to-pay and positioning
- fixture/QA design
- first-batch return/warranty/repair/replacement policy
- adhesive/install documentation
- customer-content acquisition
- retail/product photography for warm ambient light
- Shopify configuration for Canadian cross-border hardware sales
- low-volume fulfillment/shipping

Exploratory, not immediate:

- RGB spatial-control interfaces
- seven-plus magnetometer sensing
- larger outsourced production
- OpenPnP/automated assembly
- major paid media spending
- broad product-line expansion
- turning Founder OS into a separate software company

## Decision lens for recommendations

Ask:

1. Does this help Lambenti sell or learn from the first 20–50 units?
2. Does it reduce a real technical, manufacturing, installation, financial, or customer risk?
3. Can Musashi apply it with current resources?
4. Does it preserve the satisfying and premium product experience?
5. Is it more valuable than completing website, customer testing, packaging, or launch content?
6. What measurable evidence would show it worked?

Prefer recommendations that produce a test, artifact, customer interaction, or irreversible-risk reduction within seven days.

## Near-term focus

- freeze white-light MVP except for critical faults
- finalize first commercial product configuration
- produce credible quick-start and installation system
- establish website and purchase funnel
- recruit early customers or structured testers
- generate real customer content
- continue consistent founder-led content
- prepare for Chris Gibbs / potential Eric Muellejans discussion
- protect cash
- convert technical accomplishment into commercial evidence
