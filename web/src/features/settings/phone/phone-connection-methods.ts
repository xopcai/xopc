/** Connection methods are separate from model providers and Agent permissions. */
export const phoneConnectionMethods = [
  { id: 'wireless', available: true, name: ['无线连接 Android 手机', 'Wireless Android phone'], description: ['Android 11+，扫码或输入配对码，无需数据线。', 'Android 11+ · Pair with a QR code or pairing code.'] },
  { id: 'local-adb', available: true, name: ['Gateway 电脑上的手机 / 模拟器', 'Phone or emulator on the Gateway host'], description: ['通过 USB 或已配对的无线 ADB 连接。', 'Connect over USB or previously paired wireless ADB.'] },
  { id: 'remote-connector', available: false, name: ['通过本地连接器连接', 'Local connector'], description: ['Gateway 在服务器上，手机连接在你的电脑上。', 'Connect a phone on your computer to a remote Gateway.'] },
  { id: 'aliyun', available: true, name: ['阿里云手机', 'Alibaba Cloud Phone'], description: ['填写 ADB 地址并上传私钥，连接已有云手机。', 'Connect an existing cloud phone with its ADB address and private key.'] },
  { id: 'tencent', available: false, name: ['腾讯云手机', 'Tencent Cloud Phone'], description: ['连接云账号，选择地域和已有实例。', 'Connect an account, then choose a region and existing instance.'] },
] as const;
export type PhoneConnectionMethod = typeof phoneConnectionMethods[number]['id'];
