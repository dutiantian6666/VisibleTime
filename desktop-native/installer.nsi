Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
!include "FileFunc.nsh"
Var InstallTest

Name "VisibleTime"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\VisibleTime-Light"
InstallDirRegKey HKCU "Software\VisibleTime\Native" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32
BrandingText "VisibleTime"
Icon "${APPDIR}\icon.ico"
UninstallIcon "${APPDIR}\icon.ico"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductName" "VisibleTime"
VIAddVersionKey /LANG=1033 "FileDescription" "VisibleTime Setup"
VIAddVersionKey /LANG=1033 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "dutiantian6666"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\VisibleTime.exe"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/TEST" $1
  StrCpy $InstallTest "0"
  ${IfNot} ${Errors}
    StrCpy $InstallTest "1"
  ${EndIf}
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "VisibleTime requires Windows x64."
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "VisibleTime requires Windows 10 or Windows 11."
    Abort
  ${EndIf}
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" "Release"
  ${If} $0 < 394802
    MessageBox MB_ICONSTOP "Please install .NET Framework 4.6.2 or later before installing VisibleTime."
    Abort
  ${EndIf}
  FindWindow $0 "" "VisibleTime"
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "请先从系统托盘退出 VisibleTime，再安装新版本。"
    Abort
  ${EndIf}
FunctionEnd

Section "VisibleTime" SecMain
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File "${APPDIR}\VisibleTime.exe"
  File "${APPDIR}\VisibleTime.exe.config"
  File "${APPDIR}\Microsoft.Web.WebView2.Core.dll"
  File "${APPDIR}\Microsoft.Web.WebView2.WinForms.dll"
  File "${APPDIR}\WebView2Loader.dll"
  File "${APPDIR}\icon.ico"
  File "${APPDIR}\bridge.js"
  File "${APPDIR}\WebView2-LICENSE.txt"
  SetOutPath "$INSTDIR\ui"
  File "${APPDIR}\ui\*.*"
  SetOutPath "$INSTDIR"
  ExecWait '"$INSTDIR\VisibleTime.exe" --check-runtime' $0
  ${If} $0 != 0
    IfSilent runtime_install
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "需要安装 Microsoft Edge WebView2 Runtime。这一步需要联网；安装后，VisibleTime 可离线使用。" IDOK runtime_install
    Abort
    runtime_install:
    InitPluginsDir
    File /oname=$PLUGINSDIR\WebView2Setup.exe "${BOOTSTRAPPER}"
    ExecWait '"$PLUGINSDIR\WebView2Setup.exe" /silent /install' $0
    ExecWait '"$INSTDIR\VisibleTime.exe" --check-runtime' $0
    ${If} $0 != 0
      MessageBox MB_ICONSTOP "WebView2 未安装成功。请联网安装 Microsoft Edge WebView2 Runtime 后重新运行安装程序。"
      Abort
    ${EndIf}
  ${EndIf}
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  ${If} $InstallTest == "1"
    FileOpen $0 "$INSTDIR\.installation-test" w
    FileClose $0
    Goto installed
  ${EndIf}
  WriteRegStr HKCU "Software\VisibleTime\Native" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VisibleTime-Light" "DisplayName" "VisibleTime"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VisibleTime-Light" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VisibleTime-Light" "Publisher" "dutiantian6666"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VisibleTime-Light" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VisibleTime-Light" "DisplayIcon" "$INSTDIR\VisibleTime.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VisibleTime-Light" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  CreateDirectory "$SMPROGRAMS\VisibleTime"
  CreateShortcut "$SMPROGRAMS\VisibleTime\VisibleTime.lnk" "$INSTDIR\VisibleTime.exe"
  CreateShortcut "$DESKTOP\VisibleTime.lnk" "$INSTDIR\VisibleTime.exe"
  installed:
SectionEnd

Function un.onInit
  FindWindow $0 "" "VisibleTime"
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "请先从系统托盘退出 VisibleTime，再卸载软件。"
    Abort
  ${EndIf}
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$INSTDIR\ui\index.html"
  Delete "$INSTDIR\ui\styles.css"
  Delete "$INSTDIR\ui\app.js"
  Delete "$INSTDIR\ui\core.js"
  Delete "$INSTDIR\ui\history.js"
  Delete "$INSTDIR\ui\calendar.js"
  Delete "$INSTDIR\ui\favicon.svg"
  RMDir "$INSTDIR\ui"
  Delete "$INSTDIR\VisibleTime.exe"
  Delete "$INSTDIR\VisibleTime.exe.config"
  Delete "$INSTDIR\Microsoft.Web.WebView2.Core.dll"
  Delete "$INSTDIR\Microsoft.Web.WebView2.WinForms.dll"
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\bridge.js"
  Delete "$INSTDIR\WebView2-LICENSE.txt"
  Delete "$INSTDIR\Uninstall.exe"
  IfFileExists "$INSTDIR\.installation-test" test_uninstall normal_uninstall
  test_uninstall:
  Delete "$INSTDIR\.installation-test"
  RMDir "$INSTDIR"
  Goto uninstall_done
  normal_uninstall:
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\VisibleTime\VisibleTime.lnk"
  RMDir "$SMPROGRAMS\VisibleTime"
  Delete "$DESKTOP\VisibleTime.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VisibleTime-Light"
  DeleteRegKey HKCU "Software\VisibleTime\Native"
  uninstall_done:
  ; Personal SQLite records and backups remain in AppData.
SectionEnd
