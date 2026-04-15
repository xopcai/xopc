[**@xopcai/extension-ui-sdk**](../README.md)

***

[@xopcai/extension-ui-sdk](../README.md) / ExtensionClient

# Interface: ExtensionClient

Defined in: [types.ts:64](https://github.com/xopcai/xopc/blob/bf6c4f6be661a835975caa62a635aff95b7a0d32/packages/extension-ui-sdk/src/types.ts#L64)

## Properties

### agent

> **agent**: `object`

Defined in: [types.ts:70](https://github.com/xopcai/xopc/blob/bf6c4f6be661a835975caa62a635aff95b7a0d32/packages/extension-ui-sdk/src/types.ts#L70)

#### onStreamEvent()

> **onStreamEvent**(`sessionKey`, `handler`): () => `void`

##### Parameters

###### sessionKey

`string`

###### handler

[`StreamHandler`](../type-aliases/StreamHandler.md)

##### Returns

() => `void`

#### sendMessage()

> **sendMessage**(`message`, `options?`): `Promise`\<\{ `sessionKey`: `string`; \}\>

##### Parameters

###### message

`string`

###### options?

###### newSession?

`boolean`

###### sessionKey?

`string`

##### Returns

`Promise`\<\{ `sessionKey`: `string`; \}\>

***

### config

> **config**: `object`

Defined in: [types.ts:81](https://github.com/xopcai/xopc/blob/bf6c4f6be661a835975caa62a635aff95b7a0d32/packages/extension-ui-sdk/src/types.ts#L81)

#### getExtensionConfig()

> **getExtensionConfig**\<`T`\>(): `Promise`\<`T`\>

##### Type Parameters

###### T

`T` = `Record`\<`string`, `unknown`\>

##### Returns

`Promise`\<`T`\>

#### setExtensionConfig()

> **setExtensionConfig**(`patch`): `Promise`\<`void`\>

##### Parameters

###### patch

`Record`\<`string`, `unknown`\>

##### Returns

`Promise`\<`void`\>

***

### events

> **events**: `object`

Defined in: [types.ts:103](https://github.com/xopcai/xopc/blob/bf6c4f6be661a835975caa62a635aff95b7a0d32/packages/extension-ui-sdk/src/types.ts#L103)

#### emit()

> **emit**(`event`, `data?`): `void`

##### Parameters

###### event

`string`

###### data?

`unknown`

##### Returns

`void`

#### on()

> **on**(`event`, `handler`): () => `void`

##### Parameters

###### event

`string`

###### handler

(`data`) => `void`

##### Returns

() => `void`

***

### session

> **session**: `object`

Defined in: [types.ts:77](https://github.com/xopcai/xopc/blob/bf6c4f6be661a835975caa62a635aff95b7a0d32/packages/extension-ui-sdk/src/types.ts#L77)

#### listSessions()

> **listSessions**(): `Promise`\<`unknown`[]\>

##### Returns

`Promise`\<`unknown`[]\>

#### navigateToSession()

> **navigateToSession**(`sessionKey`): `Promise`\<`void`\>

##### Parameters

###### sessionKey

`string`

##### Returns

`Promise`\<`void`\>

***

### storage

> **storage**: `object`

Defined in: [types.ts:85](https://github.com/xopcai/xopc/blob/bf6c4f6be661a835975caa62a635aff95b7a0d32/packages/extension-ui-sdk/src/types.ts#L85)

#### get()

> **get**\<`T`\>(`key`): `Promise`\<`T` \| `undefined`\>

##### Type Parameters

###### T

`T` = `unknown`

##### Parameters

###### key

`string`

##### Returns

`Promise`\<`T` \| `undefined`\>

#### keys()

> **keys**(): `Promise`\<`string`[]\>

##### Returns

`Promise`\<`string`[]\>

#### remove()

> **remove**(`key`): `Promise`\<`void`\>

##### Parameters

###### key

`string`

##### Returns

`Promise`\<`void`\>

#### set()

> **set**(`key`, `value`): `Promise`\<`void`\>

##### Parameters

###### key

`string`

###### value

`unknown`

##### Returns

`Promise`\<`void`\>

***

### theme

> **theme**: `object`

Defined in: [types.ts:66](https://github.com/xopcai/xopc/blob/bf6c4f6be661a835975caa62a635aff95b7a0d32/packages/extension-ui-sdk/src/types.ts#L66)

#### getTheme()

> **getTheme**(): `Promise`\<[`ThemeInfo`](ThemeInfo.md)\>

##### Returns

`Promise`\<[`ThemeInfo`](ThemeInfo.md)\>

#### onThemeChange()

> **onThemeChange**(`handler`): () => `void`

##### Parameters

###### handler

(`t`) => `void`

##### Returns

() => `void`

***

### ui

> **ui**: `object`

Defined in: [types.ts:91](https://github.com/xopcai/xopc/blob/bf6c4f6be661a835975caa62a635aff95b7a0d32/packages/extension-ui-sdk/src/types.ts#L91)

#### closePanel()

> **closePanel**(): `void`

##### Returns

`void`

#### navigate()

> **navigate**(`path`): `Promise`\<`void`\>

##### Parameters

###### path

`string`

##### Returns

`Promise`\<`void`\>

#### onWidgetResult()

> **onWidgetResult**(`handler`): () => `void`

Chat/tool widget iframe: host sends the tool result via `widget.data` after load.

##### Parameters

###### handler

(`data`) => `void`

##### Returns

() => `void`

#### resize()

> **resize**(`height`): `void`

##### Parameters

###### height

`number`

##### Returns

`void`

#### showNotification()

> **showNotification**(`options`): `Promise`\<`void`\>

##### Parameters

###### options

###### message?

`string`

###### title

`string`

###### type?

`"success"` \| `"error"` \| `"info"`

##### Returns

`Promise`\<`void`\>

## Methods

### onDidChangeVisibility()

> **onDidChangeVisibility**(`handler`): () => `void`

Defined in: [types.ts:108](https://github.com/xopcai/xopc/blob/bf6c4f6be661a835975caa62a635aff95b7a0d32/packages/extension-ui-sdk/src/types.ts#L108)

#### Parameters

##### handler

(`visible`) => `void`

#### Returns

() => `void`

***

### onDispose()

> **onDispose**(`handler`): () => `void`

Defined in: [types.ts:107](https://github.com/xopcai/xopc/blob/bf6c4f6be661a835975caa62a635aff95b7a0d32/packages/extension-ui-sdk/src/types.ts#L107)

#### Parameters

##### handler

() => `void`

#### Returns

() => `void`

***

### whenReady()

> **whenReady**(): `Promise`\<`void`\>

Defined in: [types.ts:65](https://github.com/xopcai/xopc/blob/bf6c4f6be661a835975caa62a635aff95b7a0d32/packages/extension-ui-sdk/src/types.ts#L65)

#### Returns

`Promise`\<`void`\>
