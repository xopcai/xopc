export type PairingBroadcastPayload = {
  channel: string;
  accountId: string;
  senderId: string;
};

type PairingBroadcastSink = (type: string, payload: PairingBroadcastPayload) => void;

let sink: PairingBroadcastSink | null = null;

export function setPairingBroadcastSink(next: PairingBroadcastSink | null): void {
  sink = next;
}

export function broadcastPairingEvent(type: string, payload: PairingBroadcastPayload): void {
  sink?.(type, payload);
}
