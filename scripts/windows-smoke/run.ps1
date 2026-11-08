# 윈도우에서 FeedEx 앱을 켜 보는 확인. 사이트에 올리는 zip을 그대로 풀어 시험 페이지로 실행하고,
# 앱의 개발 도구 기록과 화면 그림을 남긴다. GitHub Actions의 윈도우 실행기에서 돌린다(.github/workflows/windows-app.yml).
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$temp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$out = Join-Path $temp 'feedex-smoke'
$app = Join-Path $temp 'feedex-app'
Remove-Item $out, $app -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $out, $app | Out-Null
Expand-Archive (Join-Path $root 'public\downloads\FeedEx-for-Windows.zip') -DestinationPath $app
$exe = Join-Path $app 'FeedEx\FeedEx.exe'
$script:failed = $false
function Fail($message) { Write-Host "::error::$message"; $script:failed = $true }
function Lines($name) {
  $file = Join-Path $out $name
  if (-not (Test-Path $file)) { return @() }
  return @(Get-Content $file | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
}
function Messages($type) { return @(Lines 'messages.log' | Where-Object { $_.body -and $_.body.type -eq $type }) }
function Screen($name) {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $bitmap.Save((Join-Path $out $name))
  $graphics.Dispose(); $bitmap.Dispose()
}

# 시험 페이지는 127.0.0.1에서, 다른 출처의 프레임은 localhost에서 연다.
$server = Start-Process python -ArgumentList '-m', 'http.server', '8765', '--directory', (Join-Path $PSScriptRoot 'site') -PassThru -WindowStyle Hidden
Start-Sleep 3
try {
  $env:FEEDEX_HOME = 'http://127.0.0.1:8765/'
  $env:FEEDEX_DEBUG_DIR = $out
  $process = Start-Process $exe -PassThru
  Start-Sleep 22
  Screen 'desktop.png'

  $started = @(Lines 'state.log' | Where-Object { $_.label -eq 'started' })
  if ($started.Count -ne 1 -or -not $started[0].runtime) { Fail 'the app did not start WebView2' } else { Write-Host "WebView2 $($started[0].runtime), dpi $($started[0].dpi)" }
  $dpi = if ($started.Count) { [double]$started[0].dpi } else { 96 }
  $ready = @(Messages 'smokeReady')
  if ($ready.Count -ne 1 -or $ready[0].body.marker -ne $true -or [double]$ready[0].body.scale -ne 0.9) { Fail 'the page did not get the Windows app marker and the default scale' }
  $placed = @(Lines 'state.log' | Where-Object { $_.label -eq 'article' -and $_.articleVisible -eq $true })
  $width = [math]::Round(600 * 0.9 * $dpi / 96)
  if (-not ($placed | Where-Object { [math]::Abs($_.articleBounds[2] - $width) -le 1 })) { Fail "the original view was not shown at the slot width $width" }
  $notify = @(Messages 'smokeNotify')
  if ($notify.Count -ne 1 -or $notify[0].body.permission -notin @('granted', 'denied') -or $notify[0].body.shown -ne $true -or -not $notify[0].body.badError) { Fail 'notification requests were not answered' }
  elseif ([math]::Abs([double]$notify[0].body.dpr - 0.9 * $dpi / 96) -gt 0.02) { Fail "the FeedEx page is not drawn at the default 90% (devicePixelRatio $($notify[0].body.dpr))" }
  $scale = @(Messages 'smokeScale')
  if (-not ($scale | Where-Object { [double]$_.body.scale -eq 1 })) { Fail 'the page was not told about the new scale' }
  elseif (-not ($scale | Where-Object { [math]::Abs([double]$_.body.dpr - $dpi / 96) -le 0.02 })) { Fail 'the new scale was not drawn' }
  $width = [math]::Round(600 * 1.0 * $dpi / 96)
  if (-not (Lines 'state.log' | Where-Object { [double]$_.appScale -eq 1 -and [math]::Abs($_.articleBounds[2] - $width) -le 1 })) { Fail 'the original view did not follow the new scale' }
  if (@(Messages 'frameProbe').Count -ne 0) { Fail 'a frame from another origin reached the app bridge' }

  # 이미 켜져 있으면 두 번째 실행은 주소만 넘기고 끝난다.
  $second = Start-Process $exe -ArgumentList 'feedex-reader://launch' -PassThru
  if (-not $second.WaitForExit(10000)) { Fail 'a second launch did not hand over and exit' }
  if (@(Get-Process FeedEx -ErrorAction SilentlyContinue).Count -ne 1) { Fail 'more than one FeedEx is running' }

  # 로그인: 앱이 시작한 로그인의 상태 값과 맞는 응답만, 한 번만 받는다.
  $deadline = (Get-Date).AddSeconds(30)
  while (-not (Lines 'messages.log' | Where-Object { $_.signInStarted }) -and (Get-Date) -lt $deadline) { Start-Sleep 1 }
  $address = @(Lines 'messages.log' | Where-Object { $_.signInStarted })[0].signInStarted
  if (-not $address) { Fail 'sign-in did not start' }
  else {
    if ($address -notmatch '^http://127\.0\.0\.1:8765/\?native-sign-in=windows&state=([0-9a-f]{64})$') { Fail "unexpected sign-in address $address" }
    $state = $Matches[1]
    $code = 'sfeed_code_' + ('a' * 64)
    $wrong = Start-Process $exe -ArgumentList "feedex-reader://signed-in?code=$code&state=$('b' * 64)" -PassThru
    $wrong.WaitForExit(10000) | Out-Null
    Start-Sleep 2
    if (@(Messages 'smokeSignedIn').Count -ne 0) { Fail 'a sign-in reply with another state was accepted' }
    foreach ($attempt in 1..2) {
      $right = Start-Process $exe -ArgumentList "feedex-reader://signed-in?code=$code&state=$state" -PassThru
      $right.WaitForExit(10000) | Out-Null
      Start-Sleep 2
    }
    $signed = @(Messages 'smokeSignedIn')
    if ($signed.Count -ne 1 -or $signed[0].body.code -ne $code) { Fail "the matching sign-in reply should be used exactly once (got $($signed.Count))" }
  }
  Screen 'desktop-after.png'

  # 창을 닫으면 배율을 이 컴퓨터에 남긴다.
  $process.CloseMainWindow() | Out-Null
  if (-not $process.WaitForExit(15000)) { Fail 'the app did not close'; Stop-Process $process -Force }
  $saved = (Get-ItemProperty 'HKCU:\Software\FeedEx' -ErrorAction SilentlyContinue).AppScale
  if ($saved -ne '1') { Fail "the scale was not saved (got '$saved')" }
}
finally {
  Get-Process FeedEx -ErrorAction SilentlyContinue | Stop-Process -Force
  Stop-Process $server -Force -ErrorAction SilentlyContinue
}
Get-ChildItem $out | ForEach-Object { Write-Host "$($_.Name) $($_.Length)" }
if ($script:failed) { exit 1 }
Write-Host 'PASS: the Windows app starts WebView2, marks only the FeedEx page, places and rescales the original view, answers notification requests, ignores other-origin frames, hands links to the running app, takes only the sign-in reply it started once, and saves its scale.'
