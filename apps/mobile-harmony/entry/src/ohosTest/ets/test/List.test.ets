import securityTest from './Security.test';
import uiSmokeTest from './UiSmoke.test';
import pairingTest from './Pairing.test';
import richChatTest from './RichChat.test';
import mathMarkdownTest from './MathMarkdown.test';

export default function testsuite(): void { securityTest(); uiSmokeTest(); pairingTest(); richChatTest(); mathMarkdownTest(); }
