import { expect, it } from 'vitest';
import { parseAndroidFocusedEditor } from '../adb-driver.js';

const dump = (inputType = '4001') => `Input method client state for android.view.inputmethod.InputMethodManager@123:
  mActive=true
  mServedView=android.widget.EditText{abc VFED}
  mServedConnecting=false
  mCurrentTextBoxAttribute:
    inputType=0x${inputType} imeOptions=0x6
    packageName=com.android.settings fieldId=123
  mServedInputConnectionWrapper=IInputConnectionWrapper{connection=EditableInputConnection@def finished=false mParentInputMethodManager.isActive()=true mServedView=android.widget.EditText{abc VFED}}
Input method service state for keyboard:
  historical inputType=0x81 packageName=other.app`;

it('accepts only a currently active editor whose app and served connection match', () => {
  expect(parseAndroidFocusedEditor(dump(), 'com.android.settings')).toMatchObject({ editable: true, focused: true, password: false, text: '' });
  for (const raw of [dump().replace('mActive=true', 'mActive=false'), dump().replace('finished=false', 'finished=true'),
    dump().replace('mServedConnecting=false', 'mServedConnecting=true'), dump().replace('mServedView=android.widget.EditText{abc VFED}}', 'mServedView=null}}'),
    dump('0')]) expect(parseAndroidFocusedEditor(raw, 'com.android.settings')).toBeUndefined();
  expect(parseAndroidFocusedEditor(dump(), 'other.app')).toBeUndefined();
  expect(parseAndroidFocusedEditor('historical inputType=0x1 packageName=com.android.settings', 'com.android.settings')).toBeUndefined();
});
it('marks text, visible-text, web and numeric password variations as protected', () => {
  for (const type of ['81', '91', 'e1', '12']) expect(parseAndroidFocusedEditor(dump(type), 'com.android.settings')?.password).toBe(true);
  for (const type of ['1', '2', '3', '4', '2002']) expect(parseAndroidFocusedEditor(dump(type), 'com.android.settings')?.password).toBe(false);
});
