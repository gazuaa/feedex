# 받기 zip을 Windows Defender로 검사한다. 1.0은 사용자 PC에서 Trojan:Win32/Wacatac.B!ml(머신러닝 추정)로 잡혔다.
# 예전 버전 결과는 참고로만 남기고, 최신 받기 파일(FeedEx-for-Windows.zip)이 잡히면 실패로 본다.
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$temp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$mp = Join-Path $env:ProgramFiles 'Windows Defender\MpCmdRun.exe'
Get-MpComputerStatus | Select-Object AMServiceEnabled, AntivirusEnabled, RealTimeProtectionEnabled, AntivirusSignatureVersion | Format-List | Out-Host
Get-MpPreference | Select-Object MAPSReporting, SubmitSamplesConsent, CloudBlockLevel | Format-List | Out-Host
& $mp -SignatureUpdate | Out-Host
$failed = $false
foreach ($zip in Get-ChildItem (Join-Path $root 'public\downloads\FeedEx-for-Windows*.zip')) {
  $folder = Join-Path $temp ('defender-' + $zip.BaseName)
  Remove-Item $folder -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive $zip.FullName -DestinationPath $folder
  $hash = (Get-FileHash (Join-Path $folder 'FeedEx\FeedEx.exe') -Algorithm SHA256).Hash.ToLower()
  $output = & $mp -Scan -ScanType 3 -File $folder -DisableRemediation 2>&1 | Out-String
  $code = $LASTEXITCODE
  Write-Host "== $($zip.Name) FeedEx.exe $hash exit $code"
  Write-Host $output.Trim()
  if ($code -eq 2 -and $zip.Name -eq 'FeedEx-for-Windows.zip') { Write-Host "::error::Defender flags the current download"; $failed = $true }
}
Get-MpThreatDetection -ErrorAction SilentlyContinue | Select-Object ThreatID, Resources, InitialDetectionTime | Format-List | Out-Host
if ($failed) { exit 1 }
exit 0
