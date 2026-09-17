import securityTest from './Security.test';
import uiSmokeTest from './UiSmoke.test';
import pairingTest from './Pairing.test';
import richChatTest from './RichChat.test';

export default function testsuite(): void { securityTest(); uiSmokeTest(); pairingTest(); richChatTest(); }
