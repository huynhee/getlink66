[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string[]]$ReleaseDirectories,
    [Parameter(Mandatory)] [string]$ReportPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$temporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$root = Join-Path $temporaryBase ('3dipl-exe-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$results = @()
try {
    foreach ($directory in $ReleaseDirectories) {
        $manifest = Get-Content -LiteralPath (Join-Path $directory 'release.json') -Raw | ConvertFrom-Json
        if ($manifest.channel -ne 'live-test' -or $manifest.manifestVersion -ne 3) {
            throw 'Only verified LiveTest V3 packages may be run by this smoke tool.'
        }
        $artifact = $manifest.desktopArtifact
        $name = [IO.Path]::GetFileName(([uri]$artifact.downloadUrl).AbsolutePath)
        $archive = Join-Path $directory $name
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $artifact.sha256) {
            throw 'Desktop ZIP checksum mismatch.'
        }
        $caseRoot = Join-Path $root ([guid]::NewGuid().ToString('N'))
        $payload = Join-Path $caseRoot 'payload'
        $data = Join-Path $caseRoot 'data'
        $updates = Join-Path $data 'updates'
        New-Item -ItemType Directory -Path $updates -Force | Out-Null
        [IO.Compression.ZipFile]::ExtractToDirectory($archive, $payload)
        $desktop = Join-Path $payload ('payload/desktop/' + $manifest.version)
        $executable = Join-Path $desktop 'ThreeDiPL.AssetManager.exe'
        if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'Desktop executable is missing.' }
        $smoke = Join-Path $caseRoot 'smoke.txt'
        $ackPath = Join-Path $updates 'health.json'
        $token = [guid]::NewGuid().ToString('N')
        $arguments = @('--mode', 'live-test', '--smoke', '--data-root', ('"' + $data + '"'),
            '--smoke-result', ('"' + $smoke + '"'), '--update-health-token', $token,
            '--update-health-ack', ('"' + $ackPath + '"'))
        $process = Start-Process -FilePath $executable -WorkingDirectory $desktop -ArgumentList $arguments -WindowStyle Hidden -PassThru
        try {
            if (-not $process.WaitForExit(90000)) { throw 'Desktop EXE smoke timed out.' }
            $process.Refresh()
            if ($process.ExitCode -ne 0) { throw ('Desktop EXE smoke exit code: ' + $process.ExitCode) }
            $health = Get-Content -LiteralPath $ackPath -Raw | ConvertFrom-Json
            $text = Get-Content -LiteralPath $smoke -Raw
            if ($health.token -ne $token -or $health.version -ne $manifest.version -or $health.processId -ne $process.Id) {
                throw 'Desktop health acknowledgement mismatch.'
            }
            if ($text -notmatch '^DESKTOP_UI_OK' -or $text -notmatch 'autodeskLoaded=False') {
                throw ('Desktop UI smoke failed: ' + $text)
            }
            $results += [ordered]@{ version = $manifest.version; channel = $manifest.channel; exitCode = 0;
                healthVersionValid = $true; healthPidValid = $true; healthNonceValid = $true; isolatedData = $true; ui = $text.Trim() }
        } finally {
            if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
            $process.Dispose()
        }
    }
    $report = [ordered]@{ ok = $true; scope = 'Packaged Desktop EXE startup and local health, without a real Max host or installed auto-update chain'; cases = $results }
    $output = [IO.Path]::GetFullPath($ReportPath)
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($output)) -Force | Out-Null
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $output -Encoding UTF8
    $report | ConvertTo-Json -Depth 6
} finally {
    $resolved = [IO.Path]::GetFullPath($root)
    if (-not $resolved.StartsWith($temporaryBase, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolved) -notmatch '^3dipl-exe-smoke-[a-f0-9]{32}$') {
        throw 'Refusing cleanup outside the owned smoke workspace.'
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
