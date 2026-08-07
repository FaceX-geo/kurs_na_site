// component-id: ui.filter-bar
import { useState } from "react";
import { FilterBar } from "@/shared/ui";

export function FilterBarSnippet() {
  const [city, setCity] = useState("Мурманск");
  const activeFilters = city
    ? [{ id: "city", label: "Город", valueLabel: city }]
    : [];

  return (
    <FilterBar
      activeFilters={activeFilters}
      resultSummary="Найдено: 28"
      onRemoveFilter={() => setCity("")}
      onClearAll={() => setCity("")}
    >
      <label>
        Город
        <select value={city} onChange={(event) => setCity(event.currentTarget.value)}>
          <option value="">Все города</option>
          <option value="Мурманск">Мурманск</option>
        </select>
      </label>
    </FilterBar>
  );
}
