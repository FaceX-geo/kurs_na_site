// component-id: ui.modal
import { useState } from "react";
import { Modal } from "@/shared/ui";

export function ModalSnippet() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Открыть проверку
      </button>
      <Modal
        open={open}
        title="Проверить изменение"
        description="Ничего не будет записано до отдельного подтверждения."
        onClose={() => setOpen(false)}
        footer={<button type="button" onClick={() => setOpen(false)}>Закрыть</button>}
      >
        <p>Тестовое описание будущего изменения.</p>
      </Modal>
    </>
  );
}
