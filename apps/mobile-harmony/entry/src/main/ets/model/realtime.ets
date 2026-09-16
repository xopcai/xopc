export interface XopcEndpointHello {
  principalId: string; endpointId: string; connectionInstanceId: string; displayName: string;
  kind: string; platform: string; appVersion: string; availability: string;
  nonce: string; signedAt: number; signature: string; tools: Object[];
}
export interface XopcEndpointRegistration {
  principalId: string; displayName: string; kind: string; platform: string; publicKey: string;
}
export interface XopcTicketRequest { clientId: string; clientKind: string; }
export interface XopcTicket { ticket: string; }
export interface XopcPayload<T> { payload: T; }
export interface XopcSubscription { topic: string; afterSeq?: number; }
export interface XopcSubscriptions { subscriptions: XopcSubscription[]; }
export interface XopcTopics { topics: string[]; }
export interface XopcHello extends XopcTicketRequest, XopcSubscriptions { ticket: string; endpoint: XopcEndpointHello; }
export interface XopcFrame<T> { protocolVersion: number; messageId: string; kind: string; sentAt: number; payload: T; }
export interface XopcTurnClaim { type: string; endpointId: string; token: string; }
export interface XopcEndpointReady { endpointId: string; turnToken: string; }
export interface XopcReady { endpoint?: XopcEndpointReady; heartbeatIntervalMs: number; heartbeatTimeoutMs: number; }
export interface XopcEvent { topic: string; seq: number; event: string; data: Object; }
export interface XopcGap { topic: string; requestedSeq: number; earliestSeq: number; recoverable: boolean; }
export interface XopcSubscribed { topic: string; cursor: number; }
export interface XopcRealtimeError { code: string; message: string; }
