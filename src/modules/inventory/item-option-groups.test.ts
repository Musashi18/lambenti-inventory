import { describe, expect, it } from "vitest";
import { getItemUseGroup, groupItemOptionsByUse, sortItemsByUseGroup, type ItemUseOption } from "./item-option-groups";

const items: ItemUseOption[] = [
  { id: "led", sku: "LED-COB-12V", description: "12V COB LED strip", category: "COMPONENT" },
  { id: "finished", sku: "LAMBENTI_PACKAGE", description: "Assembled package finished good", category: "FINISHED_GOOD" },
  { id: "screw", sku: "M2-SCREW", description: "M2 enclosure screw", category: "COMPONENT" },
  { id: "pcb", sku: "PCB-MAIN", description: "Main controller PCB", category: "COMPONENT" },
  { id: "enclosure", sku: "ENC-SHELL", description: "Outer enclosure shell", category: "RAW_MATERIAL" },
  { id: "magnet", sku: "MAG-N52", description: "Neodymium magnet", category: "COMPONENT" },
  { id: "box", sku: "BOX-RETAIL", description: "Retail box label", category: "CONSUMABLE" },
  { id: "mount", sku: "MOUNT-BRACKET", description: "Wall mounting bracket", category: "COMPONENT" },
  { id: "adhesive", sku: "3M-ADHESIVE-BACKING", description: "3M adhesive backing for LED connector housing", category: "CONSUMABLE" },
  { id: "velcro", sku: "VELCRO-TIES", description: "Velcro ties", category: "CONSUMABLE" },
  { id: "clip", sku: "CLIP-0805", description: "0805 clips", category: "COMPONENT" }
];

describe("item option grouping", () => {
  it("classifies Lambenti items into operator-use groups instead of raw database categories", () => {
    expect(getItemUseGroup(items[1]).label).toBe("Finished Builds");
    expect(getItemUseGroup(items[4]).label).toBe("Enclosures");
    expect(getItemUseGroup(items[2]).label).toBe("Hardware");
    expect(getItemUseGroup(items[3]).label).toBe("PCBs & Controller Boards");
    expect(getItemUseGroup(items[0]).label).toBe("Electronics & Electrical");
    expect(getItemUseGroup(items[5]).label).toBe("Magnets & Magnetic Hardware");
    expect(getItemUseGroup(items[6]).label).toBe("Packaging & Labels");
    expect(getItemUseGroup(items[7]).label).toBe("Hardware");
    expect(getItemUseGroup(items[8]).label).toBe("Fasteners and Accessories");
    expect(getItemUseGroup(items[9]).label).toBe("Fasteners and Accessories");
    expect(getItemUseGroup(items[10]).label).toBe("Fasteners and Accessories");
  });

  it("sorts dropdowns by use group, then by SKU within each group", () => {
    expect(sortItemsByUseGroup(items).map((item) => item.id)).toEqual([
      "finished",
      "enclosure",
      "screw",
      "mount",
      "adhesive",
      "clip",
      "velcro",
      "magnet",
      "pcb",
      "led",
      "box"
    ]);
  });

  it("builds only populated groups for native select optgroups", () => {
    expect(groupItemOptionsByUse(items).map((group) => group.label)).toEqual([
      "Finished Builds",
      "Enclosures",
      "Hardware",
      "Fasteners and Accessories",
      "Magnets & Magnetic Hardware",
      "PCBs & Controller Boards",
      "Electronics & Electrical",
      "Packaging & Labels"
    ]);
  });
});
