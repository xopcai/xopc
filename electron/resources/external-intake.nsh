!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh

Var XopcAutomaticUpdates
Var XopcUpdateCheckbox

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
!macroend

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
  FileOpen $1 "$PLUGINSDIR\desktop-privacy.utf16.txt" r
  IfErrors xopc_privacy_failed
  xopc_read_privacy:
    ClearErrors
    FileReadUTF16LE $1 $3
    IfErrors xopc_privacy_loaded
    SendMessage $4 ${EM_SETSEL} -1 -1
    SendMessage $4 ${EM_REPLACESEL} 0 "STR:$3"
    Goto xopc_read_privacy
  xopc_privacy_loaded:
  FileClose $1
  SendMessage $4 ${EM_SETSEL} 0 0
  SendMessage $4 ${EM_SCROLLCARET} 0 0
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
