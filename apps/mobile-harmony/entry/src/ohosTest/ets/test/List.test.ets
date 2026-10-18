import waitingReplyTest from './WaitingReply.test';
import securityTest from './Security.test';
import uiSmokeTest from './UiSmoke.test';
import pairingTest from './Pairing.test';
import richChatTest from './RichChat.test';
import chartMarkdownTest from './ChartMarkdown.test';
import mathMarkdownTest from './MathMarkdown.test';

export default function testsuite(): void { waitingReplyTest(); securityTest(); uiSmokeTest(); pairingTest(); richChatTest(); mathMarkdownTest(); chartMarkdownTest(); }
