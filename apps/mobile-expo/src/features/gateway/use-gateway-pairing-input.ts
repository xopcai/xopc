import { useEffect, useRef, useState } from 'react';

import { GatewayPairingInputError, readGatewayPairingInput, type GatewayPairingInputErrorKey, type GatewayPairingInputSource } from './gateway-pairing-input';
import type { ParsedGatewayQr } from './parse-gateway-qr';

export function useGatewayPairingInput(onScanned: (pairing: ParsedGatewayQr) => void, active: boolean) {
  const [source, setSource] = useState<GatewayPairingInputSource | null>(null);
  const [error, setError] = useState<GatewayPairingInputErrorKey | null>(null);
  const locked = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    setError(null);
    return () => { generation.current += 1; };
  }, [active]);

  const read = async (input: GatewayPairingInputSource) => {
    if (!active || locked.current) return;
    const current = generation.current;
    locked.current = true;
    setSource(input);
    setError(null);
    try {
      const pairing = await readGatewayPairingInput(input);
      if (current === generation.current && pairing) onScanned(pairing);
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof GatewayPairingInputError ? cause.key : 'invalidPairingLink');
    } finally {
      locked.current = false;
      setSource(null);
    }
  };

  return { source, busy: source !== null, error, read };
}
