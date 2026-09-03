import QRCode from 'qrcode';

const MOBILE_PAIR_QR_OPTIONS = {
  width: 216,
  margin: 4,
  errorCorrectionLevel: 'M' as const,
  color: { dark: '#000000ff', light: '#ffffffff' },
};

export async function encodeMobilePairQr(payload: string): Promise<string> {
  const svg = await QRCode.toString(payload, { ...MOBILE_PAIR_QR_OPTIONS, type: 'svg' });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
