!macro customInstall
  WriteRegStr HKCU "Software\Classes\Directory\shell\ToolHub" "MUIVerb" "Send to Tool Hub"
  WriteRegStr HKCU "Software\Classes\Directory\shell\ToolHub" "Icon" "$INSTDIR\m72b Tool Hub.exe"
  WriteRegStr HKCU "Software\Classes\Directory\shell\ToolHub\command" "" "$\"$INSTDIR\m72b Tool Hub.exe$\" --open-folder $\"%1$\""
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\ToolHub"
!macroend
