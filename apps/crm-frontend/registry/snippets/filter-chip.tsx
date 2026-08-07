// component-id: ui.filter-chip
import { useState } from "react";
import { FilterChip } from "@/shared/ui";

export function FilterChipSnippet() {
  const [selected, setSelected] = useState(false);
  return (
    <FilterChip
      label="Требует внимания"
      value="attention"
      selected={selected}
      count={3}
      onToggle={(event) => setSelected(event.selected)}
    />
  );
}
