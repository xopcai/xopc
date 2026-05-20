import QRCode from 'qrcode';

export const MOBILE_PAIR_QR_OPTIONS = {
  width: 216,
  margin: 2,
  errorCorrectionLevel: 'M' as const,
  color: { dark: '#000000ff', light: '#ffffffff' },
};

export async function encodeMobilePairQr(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, MOBILE_PAIR_QR_OPTIONS);
}
