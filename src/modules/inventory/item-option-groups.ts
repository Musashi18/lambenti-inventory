export type ItemUseOption = ItemUseClassificationInput & {
  id: string;
};

export type ItemUseClassificationInput = {
  sku: string;
  description: string;
  category?: string | null;
  useGroupOverride?: string | null;
};

export type ItemUseGroup<T extends ItemUseOption = ItemUseOption> = {
  key: string;
  label: string;
  items: T[];
};

type ItemUseGroupRule = {
  key: string;
  label: string;
  matches: (item: ItemUseClassificationInput, text: string, category: string) => boolean;
};

export const ITEM_USE_GROUP_RULES: readonly ItemUseGroupRule[] = [
  {
    key: "finished-builds",
    label: "Finished Builds",
    matches: (_item, text, category) => category === "FINISHED_GOOD" || /\b(finished|assembled|assembly|subassembly|build|unit)\b/.test(text)
  },
  {
    key: "enclosures",
    label: "Enclosures",
    matches: (_item, text) => /\b(enclosure|shell|housing|case|casing|diffuser|lens|cover|lid|frame|body|shade|faceplate|front\s*plate|back\s*plate)\b/.test(text)
      && !/\b(screw|bolt|nut|washer|standoff|stand\s*off|spacer|insert|clip|clips|bracket|mount|fastener|hinge|grommet|foot|feet|bumper|adhesive|backing|3m|velcro|tie|ties|accessory|accessories)\b/.test(text)
  },
  {
    key: "mechanical-hardware",
    label: "Hardware",
    matches: (_item, text) => /\b(screw|bolt|nut|washer|standoff|stand\s*off|spacer|insert|bracket|mount|mounting|hinge|rail|plate|mechanical\s+hardware|hardware)\b/.test(text)
      && !/\b(clip|clips|adhesive|backing|velcro|tie|ties|accessory|accessories)\b/.test(text)
  },
  {
    key: "fasteners-accessories",
    label: "Fasteners and Accessories",
    matches: (_item, text) => /\b(screw|bolt|nut|washer|standoff|stand\s*off|spacer|insert|clip|clips|fastener|grommet|foot|feet|bumper|adhesive\s+backing|adhesive\s+pad|3m|velcro|tie|ties|cable\s*tie|accessory|accessories)\b/.test(text)
  },
  {
    key: "magnetic-hardware",
    label: "Magnets & Magnetic Hardware",
    matches: (_item, text) => /\b(magnet|magnetic|neodymium)\b/.test(text)
  },
  {
    key: "pcbs-boards",
    label: "PCBs & Controller Boards",
    matches: (_item, text) => /\b(pcb|pcba|printed\s+circuit|circuit\s+board|controller\s+board|control\s+board|board|proto\s*board|dev\s*board)\b/.test(text)
  },
  {
    key: "electronics-electrical",
    label: "Electronics & Electrical",
    matches: (_item, text, category) => (
      /\b(led|cob|strip|sensor|magnetometer|hall\s*effect|mcu|microcontroller|esp32|ic|chip|diode|transistor|mosfet|resistor|capacitor|connector|socket|terminal|header|cable|wire|wiring|power|psu|supply|adapter|driver|regulator|fuse|switch|battery|electronics?|electrical)\b/.test(text)
      || category === "COMPONENT"
    )
  },
  {
    key: "packaging-labels",
    label: "Packaging & Labels",
    matches: (_item, text) => /\b(packaging|package|box|carton|mailer|foam|insert|label|sticker|barcode|manual|card|sleeve|bag)\b/.test(text)
  },
  {
    key: "consumables-shop-supplies",
    label: "Consumables & Shop Supplies",
    matches: (_item, text, category) => category === "CONSUMABLE" || /\b(tape|adhesive|glue|epoxy|solder|flux|alcohol|wipe|cleaner|paint|primer|sandpaper|filament|resin|consumable)\b/.test(text)
  },
  {
    key: "raw-materials-stock",
    label: "Raw Materials & Stock",
    matches: (_item, text, category) => category === "RAW_MATERIAL" || /\b(raw|sheet|bar|rod|tube|wire\s*stock|acrylic\s*sheet|aluminum|steel|plastic\s*stock|stock\s*material)\b/.test(text)
  },
  {
    key: "other-components",
    label: "Other Components",
    matches: () => true
  }
] as const;

export function getItemUseGroup(item: ItemUseClassificationInput) {
  const override = getItemUseGroupRule(item.useGroupOverride);
  if (override) return override;

  const category = normalizeCategory(item.category);
  const text = normalizeSearchText(`${item.sku} ${item.description}`);
  return ITEM_USE_GROUP_RULES.find((rule) => rule.matches(item, text, category)) ?? ITEM_USE_GROUP_RULES[ITEM_USE_GROUP_RULES.length - 1];
}

export function getItemUseGroupRule(key: string | null | undefined) {
  const normalized = key?.trim();
  if (!normalized) return null;
  return ITEM_USE_GROUP_RULES.find((rule) => rule.key === normalized) ?? null;
}

export function groupItemOptionsByUse<T extends ItemUseOption>(items: T[]): ItemUseGroup<T>[] {
  const groups = new Map<string, ItemUseGroup<T>>();

  for (const item of sortItemsByUseGroup(items)) {
    const group = getItemUseGroup(item);
    const existing = groups.get(group.key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(group.key, { key: group.key, label: group.label, items: [item] });
    }
  }

  return ITEM_USE_GROUP_RULES
    .map((rule) => groups.get(rule.key))
    .filter((group): group is ItemUseGroup<T> => Boolean(group?.items.length));
}

export function sortItemsByUseGroup<T extends ItemUseClassificationInput>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const leftGroup = getItemUseGroup(left);
    const rightGroup = getItemUseGroup(right);
    const groupDelta = getGroupOrder(leftGroup.key) - getGroupOrder(rightGroup.key);
    if (groupDelta !== 0) return groupDelta;

    return compareItemOption(left, right);
  });
}

function getGroupOrder(key: string) {
  const index = ITEM_USE_GROUP_RULES.findIndex((rule) => rule.key === key);
  return index === -1 ? ITEM_USE_GROUP_RULES.length : index;
}

function compareItemOption(left: ItemUseClassificationInput, right: ItemUseClassificationInput) {
  const skuCompare = left.sku.localeCompare(right.sku, undefined, { numeric: true, sensitivity: "base" });
  if (skuCompare !== 0) return skuCompare;
  return left.description.localeCompare(right.description, undefined, { numeric: true, sensitivity: "base" });
}

function normalizeCategory(category: string | null | undefined) {
  return (category ?? "").trim().toUpperCase();
}

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase().replace(/[_\-/]+/g, " ");
}
