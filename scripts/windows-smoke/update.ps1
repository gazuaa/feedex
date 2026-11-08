# 윈도우 앱 자동 업데이트를 실제 윈도우에서 해 본다. 받기 zip의 앱을 켜고, 소스로 만든 9.9를 시험용 키로 서명해 내려 준다.
# 다른 키로 서명한 업데이트는 설치하지 않아야 하고, 맞는 서명이면 설치한 뒤 9.9로 다시 열리고 예전 파일을 지워야 한다.
# 시험용 키는 이 실행 안에서만 만들고 버린다. 앱은 개발 도구로 이 컴퓨터의 시험 서버를 열 때만 시험용 키를 쓴다.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$temp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$out = Join-Path $temp 'feedex-update'
$app = Join-Path $temp 'feedex-update-app'
$site = Join-Path $temp 'feedex-update-site'
$build = Join-Path $temp 'feedex-next-build'
$next = Join-Path $temp 'feedex-next'
Remove-Item $out, $app, $site, $build, $next -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $out, $app, (Join-Path $site 'downloads'), $next | Out-Null
$script:failed = $false
function Fail($message) { Write-Host "::error::$message"; $script:failed = $true }
function Lines($name) {
  $file = Join-Path $out $name
  if (-not (Test-Path $file)) { return @() }
  return @(Get-Content $file | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
}
function Updates() { return @(Lines 'messages.log' | Where-Object { $_.update } | ForEach-Object { $_.update }) }
function WaitFor($seconds, [scriptblock]$condition) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) { if (& $condition) { return $true }; Start-Sleep 1 }
  return $false
}

Expand-Archive (Join-Path $root 'public\downloads\FeedEx-for-Windows.zip') -DestinationPath $app
$exe = Join-Path $app 'FeedEx\FeedEx.exe'
$current = (Get-Item $exe).VersionInfo.FileVersion
Write-Host "released app $current"

# 9.9: 같은 소스를 버전만 올려 만든다. zip 구성은 받기 zip과 같게 둔다.
dotnet build (Join-Path $root 'native\windows\FeedEx.csproj') -c Release -o $build -p:Version=9.9 --nologo -v quiet | Out-Host
Copy-Item (Join-Path $app 'FeedEx') $next -Recurse
Copy-Item (Join-Path $build 'FeedEx.exe'), (Join-Path $build 'FeedEx.exe.config') (Join-Path $next 'FeedEx') -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = Join-Path $site 'downloads\next.zip'
[System.IO.Compression.ZipFile]::CreateFromDirectory($next, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
Copy-Item (Join-Path $PSScriptRoot 'site\update.html') (Join-Path $site 'index.html')

$sha = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
$message = [Text.Encoding]::UTF8.GetBytes("FeedEx for Windows update`n9.9`n$sha")
$key = [System.Security.Cryptography.ECDsa]::Create([System.Security.Cryptography.ECCurve+NamedCurves]::nistP256)
$other = [System.Security.Cryptography.ECDsa]::Create([System.Security.Cryptography.ECCurve+NamedCurves]::nistP256)
$point = $key.ExportParameters($false).Q
$public = [Convert]::ToBase64String([byte[]]($point.X + $point.Y))
$good = [Convert]::ToBase64String($key.SignData($message, [System.Security.Cryptography.HashAlgorithmName]::SHA256))
$bad = [Convert]::ToBase64String($other.SignData($message, [System.Security.Cryptography.HashAlgorithmName]::SHA256))
function Publish($signature) {
  @{ version = '9.9'; download = 'http://127.0.0.1:8766/downloads/next.zip'; sha256 = $sha; signature = $signature } | ConvertTo-Json -Compress | Set-Content (Join-Path $site 'downloads\FeedEx-for-Windows.json') -Encoding utf8NoBOM
}
Publish $bad

$server = Start-Process python -ArgumentList '-m', 'http.server', '8766', '--directory', $site -PassThru -WindowStyle Hidden
Start-Sleep 3
try {
  $env:FEEDEX_HOME = 'http://127.0.0.1:8766/'
  $env:FEEDEX_DEBUG_DIR = $out
  $env:FEEDEX_DEBUG_UPDATE_KEY = $public
  $env:FEEDEX_DEBUG_ACCEPT_UPDATES = '1'
  Start-Process $exe | Out-Null

  if (-not (WaitFor 40 { (Updates) -contains 'rejected' })) { Fail 'an update signed with another key was not rejected' }
  if ((Get-Item $exe).VersionInfo.FileVersion -ne $current) { Fail 'a wrongly signed update changed the app' }

  Publish $good
  if (-not (WaitFor 60 { (Updates) -contains 'installed 9.9' })) { Fail "the signed update was not installed: $((Updates) -join ', ')" }
  if (-not (WaitFor 60 { Lines 'state.log' | Where-Object { $_.label -eq 'started' -and $_.version -eq '9.9' } })) { Fail 'the app did not reopen as 9.9' }
  if (-not ((Get-Item $exe).VersionInfo.FileVersion -like '9.9*')) { Fail "the app folder still has $((Get-Item $exe).VersionInfo.FileVersion)" }
  if (-not (WaitFor 40 { -not (Get-ChildItem (Join-Path $app 'FeedEx') -Recurse -Filter '*.feedex-old') })) { Fail 'old files were not removed after the restart' }
  if (@(Get-Process FeedEx -ErrorAction SilentlyContinue).Count -ne 1) { Fail 'more than one FeedEx is running after the update' }
  Write-Host "update log: $((Updates) -join ' | ')"
  Get-ChildItem (Join-Path $app 'FeedEx') -Recurse -File | ForEach-Object { Write-Host "$($_.FullName.Substring($app.Length)) $($_.VersionInfo.FileVersion)" }
}
finally {
  Get-Process FeedEx -ErrorAction SilentlyContinue | Stop-Process -Force
  Stop-Process $server -Force -ErrorAction SilentlyContinue
  $key.Dispose(); $other.Dispose()
}
if ($script:failed) { exit 1 }
Write-Host 'PASS: the released Windows app refuses an update signed with another key, installs a signed one, reopens as the new version, and removes the old files.'
