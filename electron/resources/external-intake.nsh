!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh

!ifndef BUILD_UNINSTALLER
  Var XopcAutomaticUpdates
  Var XopcUpdateCheckbox
!endif

!macro customInit
  StrCpy $XopcAutomaticUpdates 0
  SetRegView 64
  ReadRegDWORD $0 HKCU "Software\xopc\Desktop" "AutomaticUpdates"
  ${If} $0 == 1
    StrCpy $XopcAutomaticUpdates 1
  ${EndIf}
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/AUTOMATICUPDATES=" $1
  ${IfNot} ${Errors}
    ${If} $1 == 1
      StrCpy $XopcAutomaticUpdates 1
    ${ElseIf} $1 == 0
      StrCpy $XopcAutomaticUpdates 0
    ${Else}
      MessageBox MB_ICONSTOP "AUTOMATICUPDATES must be 0 or 1"
      Abort
    ${EndIf}
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Page custom XopcPrivacyPage XopcPrivacyLeave

Function XopcPrivacyPage
  !insertmacro MUI_HEADER_TEXT "Privacy and desktop updates / 隐私与桌面更新" "Choose automatic updates; model and tool permissions remain separate."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    MessageBox MB_ICONSTOP "Cannot display privacy options. Installation cancelled."
    Quit
  ${EndIf}
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=desktop-privacy.utf16.txt "${BUILD_RESOURCES_DIR}\desktop-privacy.utf16.txt"
  nsDialogs::CreateControl EDIT ${WS_VISIBLE}|${WS_CHILD}|${WS_TABSTOP}|${WS_VSCROLL}|${ES_MULTILINE}|${ES_READONLY}|${ES_AUTOVSCROLL} ${WS_EX_CLIENTEDGE} 0 0 100% 100u ""
  Pop $4
  ; Load the complete UTF-16 document without a bounded NSIS string or per-line message loop.
  System::Call 'kernel32::CreateFileW(w "$PLUGINSDIR\desktop-privacy.utf16.txt", i 0x80000000, i 1, p 0, i 3, i 0x80, p 0) p.r1'
  ${If} $1 == -1
    Goto xopc_privacy_failed
  ${EndIf}
  System::Call 'kernel32::GetFileSize(p r1, p 0) i.r2'
  ${If} $2 < 2
  ${OrIf} $2 > 1048576
    System::Call 'kernel32::CloseHandle(p r1)'
    Goto xopc_privacy_failed
  ${EndIf}
  IntOp $6 $2 + 2
  System::Alloc $6
  Pop $3
  ${If} $3 == 0
    System::Call 'kernel32::CloseHandle(p r1)'
    Goto xopc_privacy_failed
  ${EndIf}
  System::Call 'kernel32::ReadFile(p r1, p r3, i r2, *i.r5, p 0) i.r6'
  System::Call 'kernel32::CloseHandle(p r1)'
  ${If} $6 == 0
  ${OrIf} $5 != $2
    System::Free $3
    Goto xopc_privacy_failed
  ${EndIf}
  IntOp $5 $3 + $2
  System::Call '*$5(&i2 0)'
  ; Skip the generated UTF-16 BOM; WM_SETTEXT copies the entire buffer synchronously.
  IntOp $5 $3 + 2
  SendMessage $4 ${WM_SETTEXT} 0 $5
  System::Free $3
  ${NSD_CreateCheckbox} 0 102u 100% 15u "Enable automatic desktop updates / 开启桌面自动更新"
  Pop $XopcUpdateCheckbox
  ${NSD_SetState} $XopcUpdateCheckbox $XopcAutomaticUpdates
  ${NSD_CreateLink} 0 120u 100% 12u "Read full desktop privacy and code signing policy"
  Pop $0
  ${NSD_OnClick} $0 XopcOpenPrivacy
  nsDialogs::Show
  Return
  xopc_privacy_failed:
  MessageBox MB_ICONSTOP "Cannot read privacy information. Installation cancelled."
  Quit
FunctionEnd

Function XopcOpenPrivacy
  Pop $0
  ExecShell "open" "https://xopcai.github.io/xopc/code-signing#desktop-privacy-disclosure"
FunctionEnd

Function XopcPrivacyLeave
  ${NSD_GetState} $XopcUpdateCheckbox $XopcAutomaticUpdates
FunctionEnd
!macroend

; Register as an Open With candidate without changing the user's default application.
!macro xopcOpenWithExtension EXT
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".${EXT}" ""
  WriteRegStr HKCU "Software\Classes\.${EXT}\OpenWithProgids" "xopc.attachment" ""
!macroend

!macro xopcRemoveOpenWithExtension EXT
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "xopc.attachment"
  DeleteRegKey /ifempty HKCU "Software\Classes\.${EXT}\OpenWithProgids"
  DeleteRegKey /ifempty HKCU "Software\Classes\.${EXT}"
!macroend

!macro customInstall
  SetOutPath "$INSTDIR"
  SetRegView 64
  WriteRegDWORD HKCU "Software\xopc\Desktop" "AutomaticUpdates" $XopcAutomaticUpdates
  SetRegView lastused
  File /oname=desktop-privacy.txt "${BUILD_RESOURCES_DIR}\desktop-privacy.txt"
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "xopc"
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr HKCU "Software\Classes\xopc.attachment" "" "xopc chat attachment"
  WriteRegStr HKCU "Software\Classes\xopc.attachment\DefaultIcon" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "Software\Classes\xopc.attachment\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  !insertmacro xopcOpenWithExtension png
  !insertmacro xopcOpenWithExtension jpg
  !insertmacro xopcOpenWithExtension jpeg
  !insertmacro xopcOpenWithExtension webp
  !insertmacro xopcOpenWithExtension gif
  !insertmacro xopcOpenWithExtension pdf
  !insertmacro xopcOpenWithExtension txt
  !insertmacro xopcOpenWithExtension md
  !insertmacro xopcOpenWithExtension csv
  !insertmacro xopcOpenWithExtension tsv
  !insertmacro xopcOpenWithExtension json
  !insertmacro xopcOpenWithExtension docx
  !insertmacro xopcOpenWithExtension xlsx
  !insertmacro xopcOpenWithExtension pptx
  System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend

!macro customUnInstall
  SetRegView 64
  DeleteRegValue HKCU "Software\xopc\Desktop" "AutomaticUpdates"
  DeleteRegKey /ifempty HKCU "Software\xopc\Desktop"
  SetRegView lastused
  !insertmacro xopcRemoveOpenWithExtension png
  !insertmacro xopcRemoveOpenWithExtension jpg
  !insertmacro xopcRemoveOpenWithExtension jpeg
  !insertmacro xopcRemoveOpenWithExtension webp
  !insertmacro xopcRemoveOpenWithExtension gif
  !insertmacro xopcRemoveOpenWithExtension pdf
  !insertmacro xopcRemoveOpenWithExtension txt
  !insertmacro xopcRemoveOpenWithExtension md
  !insertmacro xopcRemoveOpenWithExtension csv
  !insertmacro xopcRemoveOpenWithExtension tsv
  !insertmacro xopcRemoveOpenWithExtension json
  !insertmacro xopcRemoveOpenWithExtension docx
  !insertmacro xopcRemoveOpenWithExtension xlsx
  !insertmacro xopcRemoveOpenWithExtension pptx
  DeleteRegKey HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  DeleteRegKey HKCU "Software\Classes\xopc.attachment"
  System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend
