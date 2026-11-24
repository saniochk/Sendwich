param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$sourceRoot=Split-Path $PSScriptRoot -Parent
if(Test-Path -LiteralPath $OutputDirectory){throw 'Output directory must not exist'}
New-Item -ItemType Directory -Path (Join-Path $OutputDirectory 'CSXS') | Out-Null
[xml]$manifest=Get-Content -LiteralPath (Join-Path $sourceRoot 'SendwichAE/CSXS/manifest.xml')
$manifest.ExtensionManifest.ExtensionBundleId='com.sendwich.suite'
$manifest.ExtensionManifest.ExtensionList.RemoveAll()
$manifest.ExtensionManifest.ExecutionEnvironment.HostList.RemoveAll()
$manifest.ExtensionManifest.DispatchInfoList.RemoveAll()
foreach($app in @('AE','AI')){
  $source=Join-Path $sourceRoot ('Sendwich'+$app)
  $target=Join-Path $OutputDirectory $app
  New-Item -ItemType Directory -Path $target | Out-Null
  Get-ChildItem -LiteralPath $source -Force | Where-Object { $_.Name -notin @('CSXS','META-INF','.debug','.DS_Store') } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse
  }
  [xml]$panel=Get-Content -LiteralPath (Join-Path $source 'CSXS/manifest.xml')
  $null=$manifest.SelectSingleNode('ExtensionManifest/ExtensionList').AppendChild($manifest.ImportNode($panel.ExtensionManifest.ExtensionList.Extension,$true))
  $hostNode=$panel.ExtensionManifest.ExecutionEnvironment.HostList.Host
  $null=$manifest.SelectSingleNode('ExtensionManifest/ExecutionEnvironment/HostList').AppendChild($manifest.ImportNode($hostNode,$true))
  $extension=$manifest.ImportNode($panel.ExtensionManifest.DispatchInfoList.Extension,$true)
  $hostList=$manifest.CreateElement('HostList'); $hostEntry=$manifest.CreateElement('Host'); $hostEntry.SetAttribute('Name',$hostNode.Name)
  $null=$hostList.AppendChild($hostEntry); $null=$extension.PrependChild($hostList)
  foreach($tag in @('MainPath','ScriptPath')){
    $node=$extension.SelectSingleNode('DispatchInfo/Resources/'+$tag)
    $node.InnerText='./'+$app+'/'+$node.InnerText.Substring(2)
    if(-not(Test-Path -LiteralPath (Join-Path $OutputDirectory $node.InnerText))){throw 'Missing resource'}
  }
  foreach($icon in $extension.SelectNodes('DispatchInfo/UI/Icons/Icon')){
    $icon.InnerText='./'+$app+'/'+$icon.InnerText.Substring(2)
    if(-not(Test-Path -LiteralPath (Join-Path $OutputDirectory $icon.InnerText))){throw 'Missing panel icon'}
  }
  $null=$manifest.SelectSingleNode('ExtensionManifest/DispatchInfoList').AppendChild($extension)
}
$jsPath=Join-Path $OutputDirectory 'AI/js/main.js'
$js=[IO.File]::ReadAllText($jsPath)
$anchor='String(CSI.getSystemPath("extension")).replace(/\\/g, "/")'
if(-not $js.Contains($anchor)){throw 'AI animation path anchor changed'}
[IO.File]::WriteAllText($jsPath,$js.Replace($anchor,$anchor+' + "/AI"'),[Text.UTF8Encoding]::new($false))
$manifest.Save((Join-Path $OutputDirectory 'CSXS/manifest.xml'))
Write-Output ('Staged '+$OutputDirectory)
