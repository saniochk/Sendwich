#ifndef SignedPanelsDir
  #error Signed CEP panels are required. Run build.ps1.
#endif

#ifndef AppVersion
  #define AppVersion "0.34.3"
#endif

[Setup]
AppId=Sendwich
AppName=Sendwich
AppVersion={#AppVersion}
AppPublisher=Saniochk
DefaultDirName={localappdata}\Sendwich\Setup
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

[Files]
Source: "{#SignedPanelsDir}\SendwichAE\*"; DestDir: "{userappdata}\Adobe\CEP\extensions\SendwichAE"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SignedPanelsDir}\SendwichAI\*"; DestDir: "{userappdata}\Adobe\CEP\extensions\SendwichAI"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\SendwichFigma\*"; DestDir: "{userdocs}\Sendwich\Figma"; Flags: ignoreversion recursesubdirs createallsubdirs; Tasks: figma

[Messages]
WizardSelectTasks=Set up Sendwich
SelectTasksDesc=The After Effects and Illustrator panels are included.
SelectTasksLabel2=Choose whether to install the optional Figma Desktop development plugin.
FinishedLabel=Restart After Effects and open Window > Extensions > Sendwich.
FinishedLabelNoIcons=Restart After Effects and open Window > Extensions > Sendwich.

[Code]

var
  MovedFrom, MovedTo: TArrayOfString;
  SetupCompleted: Boolean;

function IsEarlierPanel(const Folder: String): Boolean;
var
  Host: AnsiString;
begin
  Result := FileExists(Folder + '\CSXS\manifest.xml') and
            LoadStringFromFile(Folder + '\jsx\host.jsx', Host);
  if Result then
    Result := ((Pos('function vb_begin(', String(Host)) > 0) and (Pos('function vb_step(', String(Host)) > 0)) or
              ((Pos('function vb_send(', String(Host)) > 0) and (Pos('function vb_flag(', String(Host)) > 0));
end;

procedure RestoreMovedPanels;
var
  I: Integer;
begin
  for I := GetArrayLength(MovedFrom) - 1 downto 0 do
    if DirExists(MovedTo[I]) and not DirExists(MovedFrom[I]) then
      if not RenameFile(MovedTo[I], MovedFrom[I]) then
        Log('Previous panel is still backed up at ' + MovedTo[I]);
  SetArrayLength(MovedFrom, 0);
  SetArrayLength(MovedTo, 0);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Root, Folder, Backup, Dest: String;
  Entry: TFindRec;
  N: Integer;
begin
  Result := '';
  Root := ExpandConstant('{userappdata}\Adobe\CEP\extensions');
  Backup := ExpandConstant('{userappdata}\Sendwich\Previous Panels\') +
            GetDateTimeString('yyyymmdd-hhnnss', #0, #0);
  if FindFirst(Root + '\*', Entry) then
    try
      repeat
        if ((Entry.Attributes and FILE_ATTRIBUTE_DIRECTORY) <> 0) and
           ((Entry.Attributes and $400) = 0) and
           (Entry.Name <> '.') and (Entry.Name <> '..') and
           (CompareText(Entry.Name, 'SendwichAE') <> 0) and
           (CompareText(Entry.Name, 'SendwichAI') <> 0) then
        begin
          Folder := Root + '\' + Entry.Name;
          if IsEarlierPanel(Folder) then
          begin
            Dest := Backup + '\' + Entry.Name;
            if not ForceDirectories(Backup) or not RenameFile(Folder, Dest) then
            begin
              RestoreMovedPanels;
              Result := 'Could not back up an earlier Sendwich panel. Close After Effects and Illustrator and try again.';
              Exit;
            end;
            N := GetArrayLength(MovedFrom);
            SetArrayLength(MovedFrom, N + 1);
            SetArrayLength(MovedTo, N + 1);
            MovedFrom[N] := Folder;
            MovedTo[N] := Dest;
          end;
        end;
      until not FindNext(Entry);
    finally
      FindClose(Entry);
    end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssDone then SetupCompleted := True;
end;

procedure DeinitializeSetup;
begin
  if not SetupCompleted then RestoreMovedPanels;
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
  ManifestPath.Text := ExpandConstant('{userdocs}\Sendwich\Figma\manifest.json');
end;
