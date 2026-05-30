/**
 * Canonical QR surface. The ONLY file in the app allowed to import from
 * `qrcode.react`. Everything else imports `<Qr/>` from here so the QR vendor
 * is swappable in exactly one place — mirrors the `ui/toast.tsx` single-swap-
 * point pin (CLAUDE.md G11 "Library choices (pinned)").
 *
 * Monochrome contract (G24 paper artifact, cycle-27 ADR): QRs render with
 * LITERAL hex `#000000` on `#FFFFFF`, NEVER design tokens / CSS vars /
 * currentColor, so the printed label is theme-invariant. `level="M"` is a
 * good error-correction tradeoff for short deep-link URLs.
 *
 * `data-qr-value` is exposed on the wrapper so e2e can assert the encoded
 * value without decoding the SVG.
 */
import { QRCodeSVG } from 'qrcode.react';

export function Qr({ value, size }: { value: string; size: number }) {
  return (
    <span className="qr" data-qr-value={value}>
      <QRCodeSVG
        value={value}
        size={size}
        fgColor="#000000"
        bgColor="#FFFFFF"
        level="M"
      />
    </span>
  );
}
