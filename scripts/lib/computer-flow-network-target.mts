export const TEXTEDIT = process.env.XOPC_FLOW_TARGET === 'textedit';
export const APP = TEXTEDIT ? 'com.apple.TextEdit' : 'ai.xopc.computer-flow-validation';
export const WINDOW = TEXTEDIT ? 'Settings' : 'XOPC Native Flow Validation';
export const BASELINE = TEXTEDIT ? 'New Document' : 'Return to Start';
export const BASELINE_TEXT = 'Native navigation start page';
export const DESTINATION = TEXTEDIT ? 'Open and Save' : 'Open Navigation Page';
export const EXPECT = { kind: 'text', text: TEXTEDIT ? 'HTML Saving Options' : 'Verified Native Flow Destination' } as const;
