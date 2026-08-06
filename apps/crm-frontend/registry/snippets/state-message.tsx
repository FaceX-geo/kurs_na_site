// component-id: ui.state-message
import { StateMessage } from "@/shared/ui";

export function StateMessageSnippet() {
  return (
    <StateMessage
      state="stale"
      title="Данные обновились"
      message="Сверьте новую версию перед изменением."
      action={{ label: "Обновить", onPress: () => undefined }}
    />
  );
}
