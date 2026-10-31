export type GatewayConnectionCredentials = Readonly<{ port: number; token: string }>;
export type LocalGatewayOwnership = 'embedded' | 'external-local';

export type LocalGatewayConnectionDescriptor = Readonly<{
  mode: 'local';
  profileId: 'local';
  origin: string;
  port: number;
  ownership: LocalGatewayOwnership;
  epoch: number;
}>;

/** Local-only address construction; an SSH origin must not enter this adapter. */
export function localGatewayOrigin(connection: Pick<GatewayConnectionCredentials, 'port'> & { mode?: 'local' }): string {
  if (connection.mode !== undefined && connection.mode !== 'local') {
    throw new TypeError('Remote Gateway connections are not supported');
  }
  if (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535) {
    throw new TypeError('Invalid local Gateway port');
  }
  return `http://127.0.0.1:${connection.port}`;
}

/** Connection metadata does not confer authority to stop an OS process. */
export class LocalGatewayConnectionRegistry {
  private credentials?: GatewayConnectionCredentials;
  private descriptor?: LocalGatewayConnectionDescriptor;
  private epoch = 0;

  register(
    connection: GatewayConnectionCredentials & { mode?: 'local' },
    ownership: LocalGatewayOwnership = 'external-local',
  ): void {
    if (ownership !== 'embedded' && ownership !== 'external-local') {
      throw new TypeError('Invalid local Gateway ownership');
    }
    const origin = localGatewayOrigin(connection);
    if (typeof connection.token !== 'string') throw new TypeError('Invalid Gateway credential');
    if (this.credentials?.port === connection.port && this.credentials.token === connection.token
      && this.descriptor?.ownership === ownership) return;

    this.epoch += 1;
    this.credentials = Object.freeze({ port: connection.port, token: connection.token });
    this.descriptor = Object.freeze({ mode: 'local', profileId: 'local', origin,
      port: connection.port, ownership, epoch: this.epoch });
  }

  getCredentials(): GatewayConnectionCredentials | undefined {
    return this.credentials ? { ...this.credentials } : undefined;
  }

  describe(): LocalGatewayConnectionDescriptor | undefined {
    return this.descriptor;
  }
}
