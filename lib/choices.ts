/**
 * Rules for choosing modifiers and combo parts on the till. They mirror the
 * checks submit_order makes, so the cashier sees a problem before sending.
 */
import type { CartComboChoice } from "./cart";
import {
  availableOptions,
  type MenuIndex,
  type MenuItem,
  type MenuModifierGroup,
} from "./menu";

/** Pre-selects the first available options in required groups (e.g. "Regular"). */
export function defaultModifiers(groups: MenuModifierGroup[]): string[] {
  const chosen: string[] = [];
  for (const group of groups) {
    if (group.min_select === 0) continue;
    chosen.push(
      ...group.modifiers
        .filter((m) => m.is_available)
        .slice(0, group.min_select)
        .map((m) => m.id),
    );
  }
  return chosen;
}

/**
 * Taps a modifier: in a pick-one group it replaces the current choice; in a
 * pick-several group it toggles, up to the group's maximum.
 */
export function toggleModifier(
  group: MenuModifierGroup,
  selected: string[],
  modifierId: string,
): string[] {
  const inGroup = new Set(group.modifiers.map((m) => m.id));
  const current = selected.filter((id) => inGroup.has(id));
  if (current.includes(modifierId)) {
    // Pick-one groups that need an answer keep their choice.
    if (group.max_select === 1 && group.min_select === 1) return selected;
    return selected.filter((id) => id !== modifierId);
  }
  if (group.max_select === 1) {
    return [...selected.filter((id) => !inGroup.has(id)), modifierId];
  }
  if (current.length >= group.max_select) return selected;
  return [...selected, modifierId];
}

/** Problems with the modifiers chosen for one item (empty when fine). */
export function modifierProblems(item: MenuItem, selected: string[]): string[] {
  const problems: string[] = [];
  const known = new Map(
    item.modifier_groups.flatMap((g) =>
      g.modifiers.map((m) => [m.id, m] as const),
    ),
  );
  for (const id of selected) {
    const modifier = known.get(id);
    if (!modifier)
      problems.push(`${item.name} no longer offers one of the chosen options`);
    else if (!modifier.is_available)
      problems.push(`${modifier.name} is out of stock`);
  }
  for (const group of item.modifier_groups) {
    const count = group.modifiers.filter((m) => selected.includes(m.id)).length;
    if (count < group.min_select)
      problems.push(`Choose ${group.name.toLowerCase()} for ${item.name}`);
    if (count > group.max_select)
      problems.push(
        `Choose at most ${group.max_select} ${group.name.toLowerCase()} for ${item.name}`,
      );
  }
  return problems;
}

/** Default choices for a combo: each slot's default (or first available) option. */
export function defaultComboChoices(
  combo: MenuItem,
  index: MenuIndex,
): CartComboChoice[] {
  const choices: CartComboChoice[] = [];
  for (const slot of combo.combo_slots) {
    const options = availableOptions(slot, index);
    const pick =
      options.find((o) => o.is_default) ??
      (slot.required ? options[0] : undefined);
    if (!pick) continue;
    const part = index.items.get(pick.menu_item_id);
    choices.push({
      slotId: slot.id,
      menuItemId: pick.menu_item_id,
      modifierIds: part ? defaultModifiers(part.modifier_groups) : [],
    });
  }
  return choices;
}

/** Problems with a combo's choices (empty when fine). */
export function comboProblems(
  combo: MenuItem,
  choices: CartComboChoice[],
  index: MenuIndex,
): string[] {
  const problems: string[] = [];
  for (const slot of combo.combo_slots) {
    const choice = choices.find((c) => c.slotId === slot.id);
    if (!choice) {
      if (slot.required)
        problems.push(
          `Choose the ${slot.name.toLowerCase()} for ${combo.name}`,
        );
      continue;
    }
    const option = slot.options.find(
      (o) => o.menu_item_id === choice.menuItemId,
    );
    const part = index.items.get(choice.menuItemId);
    if (!option || !part) {
      problems.push(
        `That isn't a ${slot.name.toLowerCase()} choice for ${combo.name}`,
      );
      continue;
    }
    if (!part.is_available) problems.push(`${part.name} is out of stock`);
    problems.push(...modifierProblems(part, choice.modifierIds));
  }
  return problems;
}
