// component-id: ui.icon-button
import { IconBell } from "@tabler/icons-react";
import { IconButton } from "@/shared/ui";

export function IconButtonSnippet() {
  return <IconButton icon={IconBell} label="Открыть уведомления" badge={2} onPress={() => undefined} />;
}
