import { getAccountingWorkbench } from "@/modules/accounting/documents";
import { getAutomationOverview } from "@/modules/automation/service";
import { getDashboardSummary } from "@/modules/dashboard/service";
import { getTrackingDashboard } from "@/modules/tracking/service";
import { getAtlasSeedGraph } from "./seed-graph";
import { buildAtlasMissionControl } from "./scoring";
import { collectAtlasOperationalEvidence } from "./evidence-adapters";
import { loadAtlasActivityEvents } from "./activity-events";
import type { AtlasActivityEvent, AtlasMissionControl } from "./types";

type AtlasSources = {
  dashboard: Awaited<ReturnType<typeof getDashboardSummary>>;
  tracking: Awaited<ReturnType<typeof getTrackingDashboard>>;
  accounting: Awaited<ReturnType<typeof getAccountingWorkbench>>;
  automation: Awaited<ReturnType<typeof getAutomationOverview>>;
};

export async function getAtlasMissionControl(input: { now?: Date; activityEvents?: AtlasActivityEvent[] } = {}): Promise<AtlasMissionControl> {
  const [dashboard, tracking, accounting, automation, activityEvents] = await Promise.all([
    getDashboardSummary(),
    getTrackingDashboard({ now: input.now }),
    getAccountingWorkbench(),
    getAutomationOverview(),
    input.activityEvents ? Promise.resolve(input.activityEvents) : loadAtlasActivityEvents({ now: input.now })
  ]);

  return buildAtlasMissionControlFromSources({
    sources: { dashboard, tracking, accounting, automation },
    now: input.now,
    activityEvents
  });
}

export function buildAtlasMissionControlFromSources(input: {
  sources: AtlasSources;
  now?: Date;
  activityEvents?: AtlasActivityEvent[];
}) {
  const now = input.now ?? new Date();
  const evidence = collectAtlasOperationalEvidence({
    dashboard: input.sources.dashboard,
    tracking: input.sources.tracking,
    accounting: input.sources.accounting,
    automation: input.sources.automation,
    now
  });
  return buildAtlasMissionControl({
    nodes: getAtlasSeedGraph(),
    evidence,
    activityEvents: input.activityEvents ?? [],
    now
  });
}
