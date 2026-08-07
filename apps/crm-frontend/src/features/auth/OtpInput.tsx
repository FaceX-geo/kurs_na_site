import { useRef } from "react";

interface OtpInputProps {
  disabled?: boolean;
  onChange(value: string): void;
  value: string;
}

const OTP_LENGTH = 6;
const OTP_SLOT_IDS = [
  "otp-slot-1",
  "otp-slot-2",
  "otp-slot-3",
  "otp-slot-4",
  "otp-slot-5",
  "otp-slot-6",
] as const;

export function OtpInput({ disabled = false, onChange, value }: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: OTP_LENGTH }, (_, index) => value[index] ?? "");

  function updateDigit(index: number, rawValue: string): void {
    const digit = rawValue.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    onChange(next.join("").slice(0, OTP_LENGTH));
    if (digit && index < OTP_LENGTH - 1) refs.current[index + 1]?.focus();
  }

  function pasteCode(rawValue: string): void {
    const next = rawValue.replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!next) return;
    onChange(next);
    refs.current[Math.min(next.length, OTP_LENGTH) - 1]?.focus();
  }

  return (
    <fieldset className="auth-otp" disabled={disabled}>
      <legend>Код из 6 цифр</legend>
      <div className="auth-otp-grid">
        {OTP_SLOT_IDS.map((slotId, index) => (
          <input
            // The fixed six slots mirror the short-lived MAX code contract.
            key={slotId}
            ref={(node) => {
              refs.current[index] = node;
            }}
            aria-label={`Цифра ${index + 1}`}
            autoComplete={index === 0 ? "one-time-code" : "off"}
            inputMode="numeric"
            maxLength={1}
            pattern="[0-9]*"
            type="text"
            value={digits[index]}
            onChange={(event) => updateDigit(index, event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Backspace" && !digits[index] && index > 0) {
                refs.current[index - 1]?.focus();
              }
            }}
            onPaste={(event) => {
              event.preventDefault();
              pasteCode(event.clipboardData.getData("text"));
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}
