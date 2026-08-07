// component-id: ui.preview-confirm-receipt
import { useState } from "react";
import { PreviewConfirmReceipt, type OperationPhase } from "@/shared/ui";

export function PreviewConfirmReceiptSnippet() {
  const [phase, setPhase] = useState<OperationPhase>("draft");
  return (
    <PreviewConfirmReceipt
      phase={phase}
      title="Изменить этап"
      description="Проверьте этап и обязательные условия."
      operationId="TransitionCase"
      previewItems={[{ label: "Этап", before: "Новое", after: "В работе" }]}
      onRequestPreview={() => setPhase("preview")}
      onConfirm={() => setPhase("executing")}
      onCancel={() => setPhase("draft")}
    />
  );
}
