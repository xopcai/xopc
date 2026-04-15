[**@xopcai/extension-ui-sdk**](../README.md)

***

[@xopcai/extension-ui-sdk](../README.md) / Transport

# Class: Transport

Defined in: [transport.ts:19](https://github.com/xopcai/xopc/blob/9aec9ce966eaaca634c69c3a5930c9e2d390439d/packages/extension-ui-sdk/src/transport.ts#L19)

## Constructors

### Constructor

> **new Transport**(`options?`): `Transport`

Defined in: [transport.ts:29](https://github.com/xopcai/xopc/blob/9aec9ce966eaaca634c69c3a5930c9e2d390439d/packages/extension-ui-sdk/src/transport.ts#L29)

#### Parameters

##### options?

[`TransportOptions`](../type-aliases/TransportOptions.md)

#### Returns

`Transport`

## Accessors

### id

#### Get Signature

> **get** **id**(): `string`

Defined in: [transport.ts:41](https://github.com/xopcai/xopc/blob/9aec9ce966eaaca634c69c3a5930c9e2d390439d/packages/extension-ui-sdk/src/transport.ts#L41)

##### Returns

`string`

***

### ready

#### Get Signature

> **get** **ready**(): `Promise`\<[`HostInit`](../interfaces/HostInit.md)\>

Defined in: [transport.ts:37](https://github.com/xopcai/xopc/blob/9aec9ce966eaaca634c69c3a5930c9e2d390439d/packages/extension-ui-sdk/src/transport.ts#L37)

##### Returns

`Promise`\<[`HostInit`](../interfaces/HostInit.md)\>

## Methods

### dispose()

> **dispose**(): `void`

Defined in: [transport.ts:45](https://github.com/xopcai/xopc/blob/9aec9ce966eaaca634c69c3a5930c9e2d390439d/packages/extension-ui-sdk/src/transport.ts#L45)

#### Returns

`void`

***

### emit()

> **emit**(`event`, `data?`): `void`

Defined in: [transport.ts:85](https://github.com/xopcai/xopc/blob/9aec9ce966eaaca634c69c3a5930c9e2d390439d/packages/extension-ui-sdk/src/transport.ts#L85)

#### Parameters

##### event

`string`

##### data?

`unknown`

#### Returns

`void`

***

### on()

> **on**(`event`, `handler`): () => `void`

Defined in: [transport.ts:97](https://github.com/xopcai/xopc/blob/9aec9ce966eaaca634c69c3a5930c9e2d390439d/packages/extension-ui-sdk/src/transport.ts#L97)

#### Parameters

##### event

`string`

##### handler

(`data`) => `void`

#### Returns

() => `void`

***

### request()

> **request**\<`T`\>(`method`, `params?`): `Promise`\<`T`\>

Defined in: [transport.ts:57](https://github.com/xopcai/xopc/blob/9aec9ce966eaaca634c69c3a5930c9e2d390439d/packages/extension-ui-sdk/src/transport.ts#L57)

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### method

`string`

##### params?

`unknown`

#### Returns

`Promise`\<`T`\>
