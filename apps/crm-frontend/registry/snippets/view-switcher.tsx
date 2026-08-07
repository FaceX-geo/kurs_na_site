// component-id: ui.view-switcher
import { useState } from "react";
import { ViewSwitcher } from "@/shared/ui";

export function ViewSwitcherSnippet() {
  const [value, setValue] = useState<"kanban" | "list">("kanban");
  return (
    <ViewSwitcher
      value={value}
      options={[
        { value: "kanban", label: "Kanban" },
        { value: "list", label: "Список" },
      ]}
      onChange={setValue}
    />
  );
}
