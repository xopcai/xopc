import { scanFromURLAsync } from 'expo-camera';
import { getStringAsync } from 'expo-clipboard';
import { launchImageLibraryAsync } from 'expo-image-picker';

import { parseGatewayQrPayload, type ParsedGatewayQr } from './parse-gateway-qr';

export type GatewayPairingInputSource = 'clipboard' | 'image';
export type GatewayPairingInputErrorKey = 'invalidPairingLink' | 'clipboardReadFailed' | 'imageReadFailed' | 'imageQrNotFound' | 'multiplePairingQr';

export class GatewayPairingInputError extends Error {
  constructor(public readonly key: GatewayPairingInputErrorKey) { super(key); }
}

/** Reads only after a user action; selected images are decoded locally. */
export async function readGatewayPairingInput(source: GatewayPairingInputSource): Promise<ParsedGatewayQr | null> {
  try {
    if (source === 'clipboard') {
      const pairing = parseGatewayQrPayload(await getStringAsync());
      if (!pairing) throw new GatewayPairingInputError('invalidPairingLink');
      return pairing;
    }

    const selection = await launchImageLibraryAsync({
      mediaTypes: ['images'], allowsMultipleSelection: false, allowsEditing: false, quality: 1,
    });
    if (selection.canceled) return null;
    const uri = selection.assets[0]?.uri;
    if (!uri) throw new GatewayPairingInputError('imageReadFailed');
    const results = await scanFromURLAsync(uri, ['qr']);
    const pairings = new Map<string, ParsedGatewayQr>();
    for (const result of results) {
      const pairing = parseGatewayQrPayload(result.data);
      if (pairing) pairings.set(pairing.pairingToken, pairing);
    }
    if (pairings.size === 0) throw new GatewayPairingInputError('imageQrNotFound');
    if (pairings.size > 1) throw new GatewayPairingInputError('multiplePairingQr');
    return pairings.values().next().value!;
  } catch (error) {
    if (error instanceof GatewayPairingInputError) throw error;
    throw new GatewayPairingInputError(source === 'clipboard' ? 'clipboardReadFailed' : 'imageReadFailed');
  }
}
