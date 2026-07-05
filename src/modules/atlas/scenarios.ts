import type { AtlasMissionControl, AtlasProbabilityInterval, AtlasScenarioInput, AtlasScenarioResult } from "./types";

export function simulateAtlasScenario(base: AtlasMissionControl, input: AtlasScenarioInput): AtlasScenarioResult {
  switch (input.kind) {
    case "FOCUS_HOURS":
      return focusHoursScenario(base, input.focusedHoursPerDay ?? 6);
    case "OUTSOURCE_PCB_ASSEMBLY":
      return blockerReductionScenario(base, {
        title: "Outsource PCB Assembly",
        timelineDeltaDays: -18,
        probabilityLift: 7,
        manufacturingRiskReduction: input.removedBlockerRiskPct ?? 12,
        assumptions: [
          "PCB assembly is currently on the critical manufacturing path.",
          "Outsourcing reduces execution load but may increase cash pressure and supplier coordination risk.",
          "No inventory/accounting mutation is performed by this simulation."
        ],
        valueCreation: "high"
      });
    case "HIRE_MANUFACTURING_HELP":
      return blockerReductionScenario(base, {
        title: "Hire Manufacturing Help",
        timelineDeltaDays: -14,
        probabilityLift: 6,
        manufacturingRiskReduction: input.removedBlockerRiskPct ?? 10,
        cashRiskIncrease: 6,
        assumptions: [
          "Manufacturing help increases throughput only if QA instructions and fixtures are clear enough to delegate.",
          "Cash-shortage risk rises until sales or financing offsets added labor cost.",
          "This scenario does not authorize hiring or spending."
        ],
        valueCreation: "medium"
      });
    case "DELAY_PACKAGING":
      return blockerReductionScenario(base, {
        title: "Delay Packaging Perfection",
        timelineDeltaDays: -10,
        probabilityLift: 4,
        manufacturingRiskReduction: 4,
        assumptions: [
          "Packaging is treated as adequate for first validation shipments rather than fully optimized for scale.",
          "Customer experience risk can rise if protection/unboxing quality falls below acceptable threshold.",
          "Use this only if packaging is not the current safety/shipping blocker."
        ],
        valueCreation: "medium"
      });
    case "LAUNCH_BEFORE_PERFECTION":
      return blockerReductionScenario(base, {
        title: "Launch Before Perfecting Every Detail",
        timelineDeltaDays: -21,
        probabilityLift: 8,
        manufacturingRiskReduction: 3,
        assumptions: [
          "Only non-safety, non-quality, non-core-magnetic-experience polish is deferred.",
          "Firmware/hardware safety and the magnetic interaction differentiator remain non-negotiable.",
          "Customer feedback arrives earlier, but support/customer-experience risk must be managed."
        ],
        valueCreation: "high"
      });
  }
}

export function listDefaultAtlasScenarios(base: AtlasMissionControl): AtlasScenarioResult[] {
  return [
    simulateAtlasScenario(base, { kind: "FOCUS_HOURS", focusedHoursPerDay: 6 }),
    simulateAtlasScenario(base, { kind: "OUTSOURCE_PCB_ASSEMBLY" }),
    simulateAtlasScenario(base, { kind: "HIRE_MANUFACTURING_HELP" }),
    simulateAtlasScenario(base, { kind: "DELAY_PACKAGING" }),
    simulateAtlasScenario(base, { kind: "LAUNCH_BEFORE_PERFECTION" })
  ];
}

function focusHoursScenario(base: AtlasMissionControl, hoursPerDay: number): AtlasScenarioResult {
  const safeHoursPerDay = sanitizeFocusedHoursPerDay(hoursPerDay);
  const remainingHours = base.remainingHours ?? 0;
  const currentWeekly = base.weeklyVelocity.currentHours ?? 0;
  const proposedWeekly = Math.max(safeHoursPerDay * 5, 1);
  const currentDays = remainingHours > 0 && currentWeekly > 0 ? Math.ceil((remainingHours / currentWeekly) * 7) : null;
  const proposedDays = remainingHours > 0 ? Math.ceil((remainingHours / proposedWeekly) * 7) : 0;
  const timelineDeltaDays = currentDays === null ? -Math.min(30, Math.max(0, proposedDays)) : proposedDays - currentDays;
  const lift = clamp(Math.round((proposedWeekly - currentWeekly) / 4), 0, 10);
  return {
    title: `${safeHoursPerDay} Focused Hours / Day`,
    timelineDeltaDays,
    launchProbability: shiftProbability(base.launchProbability, lift),
    manufacturingDelayRisk: shiftRisk(base.manufacturingDelayRisk, -Math.min(lift, 8)),
    cashShortageRisk: base.cashShortageRisk,
    burnoutRisk: shiftRisk(base.burnoutRisk, safeHoursPerDay > 7 ? 12 : safeHoursPerDay > 6 ? 6 : 0),
    estimatedCompanyValueCreation: lift >= 6 ? "high" : lift >= 3 ? "medium" : "low",
    assumptions: [
      `${safeHoursPerDay} hours/day means roughly ${proposedWeekly} focused execution hours/week.`,
      "Only validated execution work changes completion; hours alone only change timeline confidence.",
      "The projection assumes the current bottleneck can actually absorb additional work."
    ]
  };
}

function sanitizeFocusedHoursPerDay(hoursPerDay: number) {
  if (!Number.isFinite(hoursPerDay)) return 6;
  return clamp(Math.round(hoursPerDay * 2) / 2, 1, 12);
}

function blockerReductionScenario(base: AtlasMissionControl, input: {
  title: string;
  timelineDeltaDays: number;
  probabilityLift: number;
  manufacturingRiskReduction: number;
  cashRiskIncrease?: number;
  assumptions: string[];
  valueCreation: "low" | "medium" | "high" | "unknown";
}): AtlasScenarioResult {
  return {
    title: input.title,
    timelineDeltaDays: input.timelineDeltaDays,
    launchProbability: shiftProbability(base.launchProbability, input.probabilityLift),
    manufacturingDelayRisk: shiftRisk(base.manufacturingDelayRisk, -input.manufacturingRiskReduction),
    cashShortageRisk: shiftRisk(base.cashShortageRisk, input.cashRiskIncrease ?? 0),
    burnoutRisk: shiftRisk(base.burnoutRisk, input.title.includes("Hire") ? -6 : 0),
    estimatedCompanyValueCreation: input.valueCreation,
    assumptions: input.assumptions
  };
}

function shiftProbability(interval: AtlasProbabilityInterval, delta: number): AtlasProbabilityInterval {
  return {
    low: clamp(interval.low + delta, 0, 100),
    p50: clamp(interval.p50 + delta, 0, 100),
    high: clamp(interval.high + delta, 0, 100),
    confidencePct: interval.confidencePct
  };
}

function shiftRisk(interval: AtlasProbabilityInterval, delta: number): AtlasProbabilityInterval {
  return shiftProbability(interval, delta);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
