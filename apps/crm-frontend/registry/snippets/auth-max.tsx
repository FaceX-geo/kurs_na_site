// component-id: ui.auth-max
import { AuthMaxPanel } from "@/shared/ui";

export function AuthMaxSnippet() {
  return (
    <AuthMaxPanel
      mode="verify"
      status="incomplete"
      title="Подтверждение через MAX"
      description="Введите короткоживущий код из заранее привязанного профиля."
      submitLabel="Проверить код"
      developmentStub
      onSubmit={() => undefined}
      onDevelopmentContinue={() => undefined}
    >
      <label>
        Код
        <input name="code" inputMode="numeric" autoComplete="one-time-code" />
      </label>
    </AuthMaxPanel>
  );
}
