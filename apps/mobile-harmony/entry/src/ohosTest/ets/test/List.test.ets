import securityTest from './Security.test';
import uiSmokeTest from './UiSmoke.test';
import pairingTest from './Pairing.test';

export default function testsuite(): void { securityTest(); uiSmokeTest(); pairingTest(); }
