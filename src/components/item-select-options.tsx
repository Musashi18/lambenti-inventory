import { groupItemOptionsByUse, type ItemUseOption } from "@/modules/inventory/item-option-groups";

export function ItemSelectOptions({ items }: { items: ItemUseOption[] }) {
  return (
    <>
      {groupItemOptionsByUse(items).map((group) => (
        <optgroup key={group.key} label={group.label}>
          {group.items.map((item) => (
            <option key={item.id} value={item.id}>{item.sku} — {item.description}</option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
