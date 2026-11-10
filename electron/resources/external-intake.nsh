!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh

Var XopcInstallerPid

!macro xopcLog MESSAGE
  Push $R7
  FileOpen $R7 "$TEMP\xopc-install-$XopcInstallerPid.log" a
  FileWriteUTF16LE $R7 "${MESSAGE}$\r$\n"
  FileClose $R7
  Pop $R7
!macroend

!macro xopcProcessCommand MODE
  !ifdef BUILD_UNINSTALLER
    !define /redef XOPC_REGISTRY_ARGUMENT ""
  !else
    !define /redef XOPC_REGISTRY_ARGUMENT '-InstallRegistryKey "${INSTALL_REGISTRY_KEY}"'
  !endif
  nsExec::ExecToStack /TIMEOUT=30000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\xopc-installer-processes.ps1" -Mode ${MODE} -InstallDirectory "$INSTDIR\." -InstallerProcessId $XopcInstallerPid ${XOPC_REGISTRY_ARGUMENT} -StateFile "$PLUGINSDIR\xopc-owned-processes.json" -LogFile "$TEMP\xopc-install-$XopcInstallerPid.log"'
  Pop $R0
  Pop $R9
!macroend

; Override electron-builder's directory-prefix matching for both installation and removal.
!macro customCheckAppRunning
  InitPluginsDir
  File /oname=$PLUGINSDIR\xopc-installer-processes.ps1 "${BUILD_RESOURCES_DIR}\installer-processes.ps1"
  File /oname=$PLUGINSDIR\installer-file-locks.ps1 "${BUILD_RESOURCES_DIR}\installer-file-locks.ps1"
  System::Call 'kernel32::GetCurrentProcessId() i.r0'
  StrCpy $XopcInstallerPid $0
  !insertmacro xopcProcessCommand check
  ${If} $R0 == 0
    Goto xopc_processes_stopped
  ${EndIf}
  ${If} $R0 != 10
    Goto xopc_process_check_failed
  ${EndIf}

  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDCANCEL IDOK xopc_request_quit
  SetErrorLevel 2
  Quit
  xopc_request_quit:
  DetailPrint "$(appClosing)"
  !insertmacro xopcProcessCommand request
  ${If} $R0 == 0
    Goto xopc_processes_stopped
  ${EndIf}
  xopc_process_check_failed:
  DetailPrint "Installer process check result $R0: $R9"
  !insertmacro xopcLog "phase=preflight exitCode=$R0 output=$R9"
  ${If} $R0 != 10
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Cannot verify installation file usage. / 无法检查安装文件占用。$\r$\n$R9$\r$\nLog / 日志: $TEMP\xopc-install-$XopcInstallerPid.log" /SD IDCANCEL IDRETRY xopc_retry_check
    SetErrorLevel 2
    Quit
  ${EndIf}
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)$\r$\nExit xopc from its tray menu. If it runs as administrator, close it in Task Manager. / 请从托盘退出；若以管理员身份运行，请在任务管理器中结束。" /SD IDCANCEL IDRETRY xopc_retry_check
  SetErrorLevel 2
  Quit
  xopc_retry_check:
  !insertmacro xopcProcessCommand check
  ${If} $R0 == 0
    Goto xopc_processes_stopped
  ${EndIf}
  ${If} $R0 != 10
    Goto xopc_process_check_failed
  ${EndIf}
  MessageBox MB_YESNOCANCEL|MB_ICONEXCLAMATION "xopc is still running. Force close it? Unsaved work and running tasks may be lost.$\r$\nYes: force close. No: request exit again. Cancel: stop installation.$\r$\nxopc 仍在运行。强制结束可能丢失未保存内容和运行任务。是：强制结束；否：重新请求退出；取消：停止安装。" /SD IDCANCEL IDYES xopc_force_quit IDNO xopc_request_quit
  SetErrorLevel 2
  Quit
  xopc_force_quit:
  !insertmacro xopcProcessCommand force
  ${If} $R0 != 0
    Goto xopc_process_check_failed
  ${EndIf}
  xopc_processes_stopped:
!macroend

!ifndef BUILD_UNINSTALLER
; Legacy NSIS skips its unsafe prefix scan when the copied uninstaller has the app
; executable name. Our precise preflight runs first, including the previous directory.
!macro customPrepareOldUninstaller
  Push $0
  Push $R0
  Push $R9
  Push $INSTDIR
  StrCpy $INSTDIR $installationDir
  !insertmacro customCheckAppRunning
  Pop $INSTDIR
  Pop $R9
  Pop $R0
  Pop $0
  StrCpy $uninstallerFileNameTemp "$PLUGINSDIR\${APP_EXECUTABLE_FILENAME}"
  !insertmacro xopcLog "phase=legacy-uninstall directory=$installationDir executable=$uninstallerFileNameTemp"
!macroend

!macro customOldUninstallerRetry
  !insertmacro xopcLog "phase=legacy-uninstall exitCode=$R0 directory=$installationDir attempts=$R5"
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Previous version uninstall failed. / 旧版本卸载失败。$\r$\nExit code / 退出码: $R0$\r$\nDirectory / 目录: $installationDir$\r$\nLog / 日志: $TEMP\xopc-install-$XopcInstallerPid.log" /SD IDCANCEL IDRETRY OneMoreAttempt
  SetErrorLevel 2
  Quit
!macroend

; Do not fall back to executing a legacy uninstaller with its unsafe prefix scan.
!macro customOldUninstallerLaunchFailed
  !insertmacro xopcLog "phase=legacy-launch result=failed directory=$installationDir executable=$uninstallerFileNameTemp"
  MessageBox MB_OK|MB_ICONEXCLAMATION "Cannot launch the previous uninstaller. Check application-control or antivirus rules for temporary executables. / 无法启动旧版卸载器，请检查临时程序的安全策略。$\r$\nLog / 日志: $TEMP\xopc-install-$XopcInstallerPid.log" /SD IDOK
  SetErrorLevel 2
  Quit
!macroend

!macro customUnInstallCheck
  ${If} ${Errors}
    StrCpy $R0 "launch-error"
  ${EndIf}
  !insertmacro xopcLog "phase=legacy-uninstall result=$R0 directory=$installationDir"
  ${If} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Previous version uninstall failed. / 旧版本卸载失败。$\r$\nExit code / 退出码: $R0$\r$\nLog / 日志: $TEMP\xopc-install-$XopcInstallerPid.log" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro customUnInstallCheck
!macroend
!endif

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
    SetErrorLevel 2
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
  SetErrorLevel 2
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
