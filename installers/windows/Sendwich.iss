#ifndef AppVersion
  #define AppVersion "0.34.1"
#endif

[Setup]
AppId=VectorBridge
AppName=Sendwich
AppVersion={#AppVersion}
AppPublisher=Saniochk
DefaultDirName={localappdata}\Sendwich
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
LicenseFile=..\..\LICENSE
OutputDir=..\..\dist
OutputBaseFilename=Sendwich-{#AppVersion}-Windows
SetupIconFile=..\..\FigmaCommunity\sendwich-installer.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
WizardImageFile=sendwich-wizard.png

[Tasks]
Name: "figma"; Description: "Include the local Figma Desktop plugin (optional)"
Name: "cepdebug"; Description: "Allow unsigned Adobe extensions for this Windows account"

[Files]
Source: "..\..\SendwichAE\*"; DestDir: "{userappdata}\Adobe\CEP\extensions\VectorBridgeAE"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\SendwichAI\*"; DestDir: "{userappdata}\Adobe\CEP\extensions\VectorBridgeAI"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\SendwichFigma\*"; DestDir: "{code:FigmaPluginDir}"; Flags: ignoreversion recursesubdirs createallsubdirs; Tasks: figma

[Registry]
Root: HKCU; Subkey: "Software\Adobe\CSXS.9"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Tasks: cepdebug
Root: HKCU; Subkey: "Software\Adobe\CSXS.10"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Tasks: cepdebug
Root: HKCU; Subkey: "Software\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Tasks: cepdebug
Root: HKCU; Subkey: "Software\Adobe\CSXS.12"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Tasks: cepdebug
Root: HKCU; Subkey: "Software\Adobe\CSXS.13"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Tasks: cepdebug

[Messages]
WizardSelectTasks=Set up Sendwich
SelectTasksDesc=The After Effects and Illustrator panels are included.
SelectTasksLabel2=Leave the Adobe option checked on first install so Adobe can open the panels.
FinishedLabel=Restart After Effects and open Window > Extensions > Sendwich.
FinishedLabelNoIcons=Restart After Effects and open Window > Extensions > Sendwich.

[Code]
function FigmaPluginDir(Param: String): String;
var
  LegacyDir: String;
begin
  Result := ExpandConstant('{userdocs}\Sendwich Figma');
  LegacyDir := ExpandConstant('{userdocs}\Vector Bridge Figma');
  if not FileExists(Result + '\manifest.json') and FileExists(LegacyDir + '\manifest.json') then
    Result := LegacyDir;
end;

procedure InitializeWizard;
var
  ImportLabel: TNewStaticText;
  ManifestPath: TNewEdit;
begin
  WizardForm.TasksList.Height := ScaleY(55);

  ImportLabel := TNewStaticText.Create(WizardForm);
  ImportLabel.Parent := WizardForm.SelectTasksPage;
  ImportLabel.Left := WizardForm.TasksList.Left;
  ImportLabel.Top := WizardForm.TasksList.Top + WizardForm.TasksList.Height + ScaleY(10);
  ImportLabel.Width := WizardForm.TasksList.Width;
  ImportLabel.AutoSize := False;
  ImportLabel.WordWrap := True;
  ImportLabel.Caption :=
    'If you use Figma, add the plugin under Plugins > Development > Import plugin from manifest. ' +
    'Select the file shown below.';
  WizardForm.AdjustLabelHeight(ImportLabel);

  ManifestPath := TNewEdit.Create(WizardForm);
  ManifestPath.Parent := WizardForm.SelectTasksPage;
  ManifestPath.Left := ImportLabel.Left;
  ManifestPath.Top := ImportLabel.Top + ImportLabel.Height + ScaleY(6);
  ManifestPath.Width := ImportLabel.Width;
  ManifestPath.ReadOnly := True;
  ManifestPath.Text := FigmaPluginDir('') + '\manifest.json';
end;
