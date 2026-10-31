<#
.SYNOPSIS
    Launch the DeepSeek Harness desktop app together with the remote-access proxy
    (and optionally a tunnel), so a phone can use the SAME live session over the internet.

.DESCRIPTION
    Pipeline:
      DeepSeek Harness (loopback, random port)
        -> tools/dsh-tunnel-proxy.mjs   (password login, injects DSH owner cookie)
        -> tunnel (Tailscale Serve / Cloudflare named tunnel / none)

    The desktop app is started by THIS script so its stdout can be captured: the host prints
    `dsh web: http://127.0.0.1:<port>/?token=...` and the proxy needs that token to mint the
    30-day DSH cookie. Nothing in the DSH profile has to be modified.

    Before running: quit DeepSeek Harness from the tray (the script must own the launch).
    After it starts: phone opens the printed URL, logs in with the remote password
    (tools/../.dsh/remote-access/password.txt), and gets the normal Web UI.

.PARAMETER Tunnel
    none            expose on loopback only (test locally)
    tailscale       Tailscale Serve -> https://<machine>.<tailnet>.ts.net/ (private, needs
                    Tailscale installed + logged in on PC and phone)
    cloudflare-named  an existing Cloudflare named tunnel (needs a domain); pass -CloudflareConfig

.EXAMPLE
    pwsh -File tools/start-dsh-remote.ps1
    pwsh -File tools/start-dsh-remote.ps1 -Tunnel none
    pwsh -File tools/start-dsh-remote.ps1 -Tunnel tailscale
#>
[CmdletBinding()]
param(
    [string]$DshExe,
    [string]$DshCmd,
    [ValidateSet('none', 'tailscale', 'cloudflare-named')]
    [string]$Tunnel = 'none',
    [int]$ProxyPort = 63200,
    [string]$StateDir,
    [string]$DshHome,
    [string]$CloudflaredExe,
    [string]$CloudflareConfig,
    [string]$PublicHostname,
    [string]$Password,
    [switch]$ResetPassword,
    [switch]$InstallStartup,
    [switch]$UninstallStartup,
    [switch]$UseCli,
    [switch]$SecureCookie,
    [switch]$ServeHttps
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot
if (-not $DshHome) { $DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' } }
if (-not $StateDir) { $StateDir = Join-Path $DshHome 'remote-access' }
if (-not $CloudflaredExe) { $CloudflaredExe = Join-Path $scriptRoot 'bin\cloudflared.exe' }
# Defaults follow the stock Windows install; override with -DshExe/-DshCmd or DSH_EXE/DSH_CMD.
$harnessDir = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness'
if (-not $DshExe) { $DshExe = if ($env:DSH_EXE) { $env:DSH_EXE } else { Join-Path $harnessDir 'DeepSeek Harness.exe' } }
if (-not $DshCmd) { $DshCmd = if ($env:DSH_CMD) { $env:DSH_CMD } else { Join-Path $harnessDir 'resources\runtime\cli\bin\dsh.cmd' } }
$proxyScript = Join-Path $scriptRoot 'dsh-tunnel-proxy.mjs'

# ── optional config file (explicit command-line arguments win) ───────────────
$configPath = Join-Path $scriptRoot 'remote-config.json'
if (Test-Path $configPath) {
    $config = Get-Content $configPath -Raw | ConvertFrom-Json
    if ($config.tunnel -and -not $PSBoundParameters.ContainsKey('Tunnel')) { $Tunnel = $config.tunnel }
    if ($config.proxyPort -and -not $PSBoundParameters.ContainsKey('ProxyPort')) { $ProxyPort = [int]$config.proxyPort }
    if ($config.cloudflareConfig -and -not $PSBoundParameters.ContainsKey('CloudflareConfig')) { $CloudflareConfig = $config.cloudflareConfig }
    if ($config.publicHostname -and -not $PSBoundParameters.ContainsKey('PublicHostname')) { $PublicHostname = $config.publicHostname }
    if ($config.secureCookie) { $SecureCookie = [switch]$true }
}

New-Item -ItemType Directory -Force $StateDir | Out-Null
# Unique log names per run: a previous run may still hold its own log file open, and
# truncating/deleting a locked file is what produced "The process cannot access the file".
$runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdoutLog = Join-Path $StateDir "dsh-stdout-$runStamp.log"
$stderrLog = Join-Path $StateDir "dsh-stderr-$runStamp.log"
$proxyOut = Join-Path $StateDir "proxy-$runStamp.out.log"
$proxyErr = Join-Path $StateDir "proxy-$runStamp.err.log"
$tunnelOut = Join-Path $StateDir "tunnel-$runStamp.out.log"
$tunnelErr = Join-Path $StateDir "tunnel-$runStamp.err.log"
$urlFile = Join-Path $StateDir 'public-url.txt'
Get-ChildItem $StateDir -Filter '*.log' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

function Write-Step($message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Write-Ok($message) { Write-Host "    $message" -ForegroundColor Green }
function Write-Warn2($message) { Write-Host "    $message" -ForegroundColor Yellow }

# ── logon autostart (scheduled task) ────────────────────────────────────────
$taskName = 'DSH Remote Access'
if ($InstallStartup -or $UninstallStartup) {
    if ($UninstallStartup) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
        Write-Ok "removed scheduled task '$taskName'"
        return
    }
    $selfPath = $MyInvocation.MyCommand.Path
    $pwshExe = (Get-Command pwsh).Source
    $action = New-ScheduledTaskAction -Execute $pwshExe `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$selfPath`" -Tunnel $Tunnel"
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
        -Description 'Start DeepSeek Harness together with the remote-access proxy and Tailscale Serve at logon.' -Force | Out-Null
    Write-Ok "installed scheduled task '$taskName' (runs at logon with a hidden window)"
    Write-Warn2 'make sure DeepSeek Harness itself does not autostart separately, or this launcher will refuse to run.'
    return
}

# ── preflight ────────────────────────────────────────────────────────────────
if (-not $UseCli) {
    $running = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
    if ($running) {
        throw 'DeepSeek Harness is already running. Quit it from the tray (or Task Manager), then run this script again — it must start the app itself to capture the pairing token.'
    }
    if (-not (Test-Path $DshExe)) { throw "DSH executable not found: $DshExe (pass -DshExe <path> or set DSH_EXE)" }
} else {
    if (-not (Test-Path $DshCmd)) { throw "dsh CLI wrapper not found: $DshCmd (pass -DshCmd <path> or set DSH_CMD)" }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node.exe not found on PATH.' }
if (-not (Test-Path $proxyScript)) { throw "proxy script missing: $proxyScript" }

# ── single-instance guard ───────────────────────────────────────────────────
$launcherMutex = [System.Threading.Mutex]::new($false, 'Global\DeepSeekHarnessRemoteLauncher')
$mutexHeld = $false
try { $mutexHeld = $launcherMutex.WaitOne(0) }
catch [System.Threading.AbandonedMutexException] { $mutexHeld = $true }
if (-not $mutexHeld) { throw 'Another start-dsh-remote window is already running. Close it first.' }

# ── stale proxy from a previous run (this is what used to break the log files) ─
$proxyOwner = (Get-NetTCPConnection -State Listen -LocalPort $ProxyPort -ErrorAction SilentlyContinue |
    Select-Object -First 1).OwningProcess
if ($proxyOwner) {
    $ownerCmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$proxyOwner" -ErrorAction SilentlyContinue).CommandLine
    if ($ownerCmd -and $ownerCmd.Contains('dsh-tunnel-proxy.mjs')) {
        Write-Warn2 "stopping a leftover proxy from a previous run (pid $proxyOwner, port $ProxyPort)"
        Stop-Process -Id $proxyOwner -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 800
    } else {
        throw "Port $ProxyPort is already in use by pid $proxyOwner. Close that program or start with -ProxyPort <other port>."
    }
}

# ── the proxy port must be bindable: Windows reserves changing port blocks ────
function Test-LoopbackPort([int]$port) {
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($listener) { try { $listener.Stop() } catch { /* ignore */ } }
    }
}

if (-not (Test-LoopbackPort $ProxyPort)) {
    Write-Warn2 "port $ProxyPort is unusable (reserved by Windows or taken); picking a free port"
    $picked = $null
    foreach ($candidate in @(64700, 64701, 64702, 55400, 55401, 50100, 50101)) {
        if (Test-LoopbackPort $candidate) { $picked = $candidate; break }
    }
    if (-not $picked) {
        for ($attempt = 0; $attempt -lt 200 -and -not $picked; $attempt++) {
            $candidate = Get-Random -Minimum 50000 -Maximum 65000
            if (Test-LoopbackPort $candidate) { $picked = $candidate }
        }
    }
    if (-not $picked) { throw 'Could not find a free loopback port for the proxy. Close other programs or pass -ProxyPort.' }
    $ProxyPort = $picked
    Write-Ok "using proxy port $ProxyPort"
}

function Stop-Tree([int]$rootId) {
    foreach ($child in (Get-CimInstance Win32_Process -Filter "ParentProcessId=$rootId" -ErrorAction SilentlyContinue)) {
        Stop-Tree ([int]$child.ProcessId)
    }
    Stop-Process -Id $rootId -Force -ErrorAction SilentlyContinue
}

$processes = @{}

try {
    # ── start DSH and capture the launch URL ────────────────────────────────
    Write-Step 'Starting DeepSeek Harness ...'
    if ($UseCli) {
        $processes.App = Start-Process -FilePath $env:ComSpec `
            -ArgumentList '/c', "`"$DshCmd`" web --no-open --host 127.0.0.1 --port 0" `
            -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog `
            -WindowStyle Hidden -PassThru
    } else {
        $processes.App = Start-Process -FilePath $DshExe `
            -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog `
            -WindowStyle Hidden -PassThru
    }
    Write-Ok "pid $($processes.App.Id), waiting for the host URL ..."

    $launchUrl = $null
    $deadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 400
        $text = ''
        foreach ($file in @($stdoutLog, $stderrLog)) {
            if (Test-Path $file) { $text += (Get-Content $file -Raw -ErrorAction SilentlyContinue) }
        }
        if ($text -match '(http://127\.0\.0\.1:(\d+)/\?token=([A-Za-z0-9_\-]+))') {
            $launchUrl = $Matches[1]
            break
        }
        if ($processes.App.HasExited) { break }
    }
    if (-not $launchUrl) {
        $tail = @()
        foreach ($file in @($stdoutLog, $stderrLog)) {
            if (Test-Path $file) { $tail += (Get-Content $file -Tail 20 -ErrorAction SilentlyContinue) }
        }
        throw "Could not capture the dsh web launch URL. Last log lines: $($tail -join ' | ')"
    }
    $upstreamPort = $Matches[2]
    Write-Ok "host URL captured (port $upstreamPort)"

    # ── start the proxy ────────────────────────────────────────────────────
    Write-Step "Starting remote proxy on 127.0.0.1:$ProxyPort ..."
    $proxyArgs = @(
        $proxyScript,
        '--listen', "$ProxyPort",
        '--upstream', "127.0.0.1:$upstreamPort",
        '--token-url', $launchUrl,
        '--state-dir', $StateDir
    )
    if ($SecureCookie) { $proxyArgs += '--secure-cookie' }
    if ($ResetPassword -or $Password) {
        $proxyArgs += '--reset-password'
        if ($Password) { $proxyArgs += @('--pass', $Password) }
    }
    $processes.Proxy = Start-Process -FilePath 'node' -ArgumentList $proxyArgs `
        -RedirectStandardOutput $proxyOut -RedirectStandardError $proxyErr `
        -WindowStyle Hidden -PassThru

    $proxyReady = $false
    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 400
        if (Test-Path $proxyOut) {
            $proxyText = Get-Content $proxyOut -Raw -ErrorAction SilentlyContinue
            if ($proxyText -match 'dsh-tunnel-proxy listening') { $proxyReady = $true; break }
        }
        if ($processes.Proxy.HasExited) { break }
    }
    if (-not $proxyReady) {
        $detail = if (Test-Path $proxyErr) { Get-Content $proxyErr -Tail 10 -ErrorAction SilentlyContinue } else { @() }
        throw "Proxy did not start. $($detail -join ' | ')"
    }
    Write-Ok "proxy ready (pid $($processes.Proxy.Id))"

    # ── tunnel ─────────────────────────────────────────────────────────────
    $publicUrl = $null
    switch ($Tunnel) {
        'none' {
            $publicUrl = "http://127.0.0.1:$ProxyPort"
            Write-Warn2 'no tunnel: reachable on this machine only (use for local testing)'
        }
        'tailscale' {
            Write-Step 'Configuring Tailscale Serve ...'
            $tailscale = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
            if (-not $tailscale) {
                $candidate = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
                if (Test-Path $candidate) { $tailscale = $candidate }
            }
            if (-not $tailscale) { throw 'tailscale.exe not found. Install Tailscale and run: tailscale up' }
            $status = & $tailscale status --json 2>$null | ConvertFrom-Json
            if (-not $status.Self -or $status.BackendState -ne 'Running') {
                throw 'Tailscale is not logged in. Run: tailscale up  (complete the browser login), then try again.'
            }
            & $tailscale serve reset 2>$null | Out-Null
            if ($ServeHttps) {
                $serveOutput = & $tailscale serve --bg --https=443 "http://127.0.0.1:$ProxyPort" 2>&1
            } else {
                $serveOutput = & $tailscale serve --bg --http=80 "http://127.0.0.1:$ProxyPort" 2>&1
            }
            if ($LASTEXITCODE -ne 0) {
                throw "tailscale serve failed: $($serveOutput -join ' | ')"
            }
            $dnsName = ($status.Self.DNSName -replace '\.$', '')
            $scheme = if ($ServeHttps) { 'https' } else { 'http' }
            $publicUrl = "${scheme}://$dnsName/"
            Write-Ok "tailnet URL: $publicUrl"
            Write-Warn2 'phone must be on the same tailnet (install the Tailscale app and log in)'
            if (-not $ServeHttps) {
                Write-Warn2 'served over tailnet HTTP inside WireGuard (encrypted in transit); add -ServeHttps after enabling HTTPS certificates for a PWA-installable URL'
            }
        }
        'cloudflare-named' {
            if (-not $CloudflareConfig -or -not (Test-Path $CloudflareConfig)) {
                throw 'cloudflare-named needs -CloudflareConfig <path to cloudflared config.yml>'
            }
            if (-not (Test-Path $CloudflaredExe)) { throw "cloudflared not found: $CloudflaredExe" }
            if (-not $PublicHostname) { throw 'cloudflare-named needs -PublicHostname dsh.example.com' }
            Write-Step 'Starting cloudflared named tunnel ...'
            $processes.Tunnel = Start-Process -FilePath $CloudflaredExe `
                -ArgumentList 'tunnel', '--config', $CloudflareConfig, '--no-autoupdate', 'run' `
                -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr `
                -WindowStyle Hidden -PassThru
            Start-Sleep -Seconds 3
            if ($processes.Tunnel.HasExited) {
                throw "cloudflared exited: $((Get-Content $tunnelErr -Tail 10 -ErrorAction SilentlyContinue) -join ' | ')"
            }
            $publicUrl = "https://$PublicHostname/"
            Write-Ok "public URL: $publicUrl"
        }
    }

    $publicUrl | Set-Content $urlFile -Encoding utf8
    $passwordFile = Join-Path $StateDir 'password.txt'
    $passwordHint = if (Test-Path $passwordFile) { (Get-Content $passwordFile -Raw).Trim() } else { 'see proxy log' }

    Write-Host ''
    Write-Host '────────────────────────────────────────────────────────' -ForegroundColor DarkCyan
    Write-Host ' Remote access is up' -ForegroundColor White
    Write-Host "   URL      : $publicUrl"
    Write-Host "   Password : $passwordHint"
    Write-Host "   Saved to : $passwordFile"
    Write-Host "   Logs     : $StateDir"
    Write-Host '   Stop     : Ctrl+C (or quit DeepSeek Harness from the tray)'
    Write-Host '────────────────────────────────────────────────────────' -ForegroundColor DarkCyan
    Write-Host ''

    # ── keep alive ─────────────────────────────────────────────────────────
    while (-not $processes.App.HasExited) {
        Start-Sleep -Seconds 2
        if ($processes.Proxy.HasExited) {
            Write-Warn2 "proxy exited unexpectedly; see $proxyErr"
            break
        }
    }
}
finally {
    Write-Step 'Shutting down ...'
    foreach ($name in @('Tunnel', 'Proxy')) {
        if ($processes[$name] -and -not $processes[$name].HasExited) {
            Stop-Process -Id $processes[$name].Id -Force -ErrorAction SilentlyContinue
        }
    }
    if ($UseCli -and $processes.App) {
        # cmd.exe -> Electron host: kill the whole tree so no orphan keeps the logs/port busy
        Stop-Tree $processes.App.Id
    } elseif (-not $UseCli -and $processes.App -and -not $processes.App.HasExited) {
        Write-Warn2 'DeepSeek Harness is still running (close it from the tray if you want it stopped).'
    }
    if ($launcherMutex) {
        if ($mutexHeld) { try { $launcherMutex.ReleaseMutex() } catch { /* ignore */ } }
        $launcherMutex.Dispose()
    }
}
