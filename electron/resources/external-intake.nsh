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
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "xopc"
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '$"$INSTDIR\${APP_EXECUTABLE_FILENAME}$" $"%1$"'
  WriteRegStr HKCU "Software\Classes\xopc.attachment" "" "xopc chat attachment"
  WriteRegStr HKCU "Software\Classes\xopc.attachment\DefaultIcon" "" '$"$INSTDIR\${APP_EXECUTABLE_FILENAME}$",0'
  WriteRegStr HKCU "Software\Classes\xopc.attachment\shell\open\command" "" '$"$INSTDIR\${APP_EXECUTABLE_FILENAME}$" $"%1$"'
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
