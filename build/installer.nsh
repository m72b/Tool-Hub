!macro customInstall
  WriteRegStr HKCU "Software\Classes\Directory\shell\ToolHub" "MUIVerb" "Send to Tool Hub"
  WriteRegStr HKCU "Software\Classes\Directory\shell\ToolHub" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Directory\shell\ToolHub\command" "" "$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" --open-folder $\"%1$\""
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\ToolHub"
!macroend
