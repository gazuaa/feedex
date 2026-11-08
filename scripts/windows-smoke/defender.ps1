# Download the same release users receive, then scan the ZIP and extracted files.
# A scan with cloud protection unavailable is inconclusive and must not pass CI.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$temp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$out = Join-Path $temp 'feedex-defender'
New-Item -ItemType Directory -Force $out | Out-Null
Start-Transcript -Path (Join-Path $out 'scan.log') -Force | Out-Null
$started = Get-Date
$failed = $false
$scans = @()
$realTimeVerified = $false
try {
  $mp = Join-Path $env:ProgramFiles 'Windows Defender\MpCmdRun.exe'
  $platform = Get-ChildItem (Join-Path $env:ProgramData 'Microsoft\Windows Defender\Platform') -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
  if ($platform -and (Test-Path (Join-Path $platform.FullName 'MpCmdRun.exe'))) { $mp = Join-Path $platform.FullName 'MpCmdRun.exe' }
  if (-not (Test-Path $mp)) { throw 'Microsoft Defender command-line scanner is unavailable.' }

  # Only configure the disposable CI machine; never change a developer's PC.
  if ($env:GITHUB_ACTIONS -eq 'true') {
    Set-MpPreference -MAPSReporting 2 -SubmitSamplesConsent 1 -DisableRealtimeMonitoring $false -DisableIOAVProtection $false -DisableArchiveScanning $false -DisableBlockAtFirstSeen $false
  }
  $status = Get-MpComputerStatus
  $prefs = Get-MpPreference
  $status | Select-Object AMServiceEnabled, AntivirusEnabled, RealTimeProtectionEnabled, AntivirusSignatureVersion, AMProductVersion | ConvertTo-Json | Set-Content (Join-Path $out 'status.json')
  $prefs | Select-Object MAPSReporting, SubmitSamplesConsent, DisableIOAVProtection, DisableArchiveScanning, DisableBlockAtFirstSeen, CloudBlockLevel | ConvertTo-Json | Set-Content (Join-Path $out 'preferences.json')
  Get-Content (Join-Path $out 'status.json'), (Join-Path $out 'preferences.json') | Out-Host
  if (-not $status.AMServiceEnabled -or -not $status.AntivirusEnabled) { throw 'Defender antivirus is unavailable; result is inconclusive.' }
  $realTimeVerified = [bool]$status.RealTimeProtectionEnabled
  if (-not $realTimeVerified) { Write-Host '::warning::Hosted runner real-time protection is unavailable. The cloud/archive scan cannot reproduce all browser-download checks.' }
  if ([int]$prefs.MAPSReporting -eq 0 -or $prefs.DisableIOAVProtection -or $prefs.DisableArchiveScanning -or $prefs.DisableBlockAtFirstSeen) { throw 'Defender cloud/download/archive protection is not enabled; result is inconclusive.' }

  & $mp -SignatureUpdate | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Signature update failed ($LASTEXITCODE)." }
  & $mp -ValidateMapsConnection | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Defender cloud service is unreachable ($LASTEXITCODE); result is inconclusive." }

  $release = Get-Content (Join-Path $root 'public\downloads\FeedEx-for-Windows.json') -Raw | ConvertFrom-Json
  $url = [Uri]$release.download
  if ($url.Scheme -ne 'https' -or $url.Host -ne 'feedex.jyk.workers.dev' -or $url.AbsolutePath -notmatch '^/downloads/FeedEx-for-Windows-[0-9.]+\.zip$') { throw 'Unexpected release URL.' }
  $local = Join-Path $root 'public\downloads\FeedEx-for-Windows.zip'
  if ((Get-FileHash $local -Algorithm SHA256).Hash.ToLower() -ne $release.sha256) { throw 'Repository ZIP differs from release manifest.' }
  $zip = Join-Path $out 'FeedEx-for-Windows.zip'
  Invoke-WebRequest -Uri $url.AbsoluteUri -OutFile $zip
  if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $release.sha256) { throw 'Downloaded ZIP differs from the pinned release manifest.' }
  # Retain Internet origin metadata as a browser download would.
  Set-Content -Path $zip -Stream Zone.Identifier -Value "[ZoneTransfer]`r`nZoneId=3`r`nHostUrl=$($url.AbsoluteUri)"

  foreach ($target in @($local, $zip)) {
    $output = & $mp -Scan -ScanType 3 -File $target -DisableRemediation 2>&1 | Out-String
    $code = $LASTEXITCODE
    $scans += @{ target = $target; exitCode = $code; output = $output }
    Write-Host "ZIP scan exit=$code $target`n$output"
    if ($code -ne 0 -or -not (Test-Path $target)) { $failed = $true }
  }
  $folder = Join-Path $out 'expanded'
  Expand-Archive $zip -DestinationPath $folder -Force
  $exe = Join-Path $folder 'FeedEx\FeedEx.exe'
  $files = Get-ChildItem $folder -File -Recurse | ForEach-Object {
    $signature = if ($_.Extension -in @('.exe', '.dll')) { Get-AuthenticodeSignature $_.FullName } else { $null }
    if ($_.Extension -eq '.dll' -and $signature.Status -ne 'Valid') { throw "Dependency signature is invalid: $($_.FullName) ($($signature.Status))" }
    @{ path = $_.FullName.Substring($folder.Length + 1); sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(); signature = if ($signature) { $signature.Status.ToString() } else { $null }; signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null } }
  }
  $files | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $out 'files.json')
  $output = & $mp -Scan -ScanType 3 -File $folder -DisableRemediation 2>&1 | Out-String
  $code = $LASTEXITCODE
  $scans += @{ target = $folder; exitCode = $code; output = $output }
  Write-Host "Expanded scan exit=$code`n$output"
  if ($code -ne 0 -or -not (Test-Path $exe)) { $failed = $true }
}
catch {
  Write-Host "::error::$($_.Exception.Message)"
  $failed = $true
}
finally {
  $detections = @(Get-MpThreatDetection -ErrorAction SilentlyContinue | Where-Object { $_.InitialDetectionTime -ge $started })
  $detections | Select-Object ThreatID, Resources, InitialDetectionTime, ActionSuccess | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $out 'detections.json')
  if ($detections.Count -gt 0) { $failed = $true; $detections | Format-List | Out-Host }
  @{ checkedAt = (Get-Date).ToUniversalTime().ToString('o'); cloudArchiveScanPassed = -not $failed; realTimeProtectionVerified = $realTimeVerified; browserDownloadReproduced = $false; scans = $scans } | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $out 'result.json')
  Stop-Transcript | Out-Null
}
if ($failed) { exit 1 }
