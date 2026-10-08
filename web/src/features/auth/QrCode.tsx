import QRCode from 'qrcode';
import { useMemo } from 'react';

/**
 * QR code as inline SVG <rect> elements built from the module matrix: no data: URLs, no innerHTML,
 * no canvas (CSP-safe). `value` is the otpauth:// URI.
 */
export function QrCode({ value, size = 168 }: { value: string; size?: number }) {
  const matrix = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    return { n: qr.modules.size, data: qr.modules.data };
  }, [value]);
  const quiet = 2;
  const dim = matrix.n + quiet * 2;
  const rects = [];
  for (let y = 0; y < matrix.n; y += 1) {
    for (let x = 0; x < matrix.n; x += 1) {
      if (matrix.data[y * matrix.n + x]) rects.push(<rect key={`${x}-${y}`} x={x + quiet} y={y + quiet} width={1} height={1} />);
    }
  }
  return (
    <svg role="img" aria-label="QR code for your authenticator app" width={size} height={size} viewBox={`0 0 ${dim} ${dim}`} shapeRendering="crispEdges">
      <rect x={0} y={0} width={dim} height={dim} fill="#ffffff" />
      <g fill="#0f172a">{rects}</g>
    </svg>
  );
}
