$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$pins = @{}
Get-Content (Join-Path $PSScriptRoot 'upstreams.env') | ForEach-Object {
    if ($_ -match '^([A-Z_]+)=([0-9a-f]{40})$') { $pins[$Matches[1]] = $Matches[2] }
}

function Invoke-Git([string[]]$Arguments) {
    & git @Arguments
    if ($LASTEXITCODE -ne 0) { throw "git failed: $($Arguments -join ' ')" }
}

function Fetch-Upstream([string]$Name, [string]$Pin, [string[]]$Paths) {
    $target = Join-Path (Join-Path $workspace 'upstream') $Name
    if ((Test-Path $target) -and !(Test-Path (Join-Path $target '.git'))) {
        throw "$target exists but is not a Git checkout"
    }
    if (!(Test-Path $target)) {
        New-Item -ItemType Directory -Path (Join-Path $workspace 'upstream') -Force | Out-Null
        Invoke-Git @('clone', '--filter=blob:none', '--sparse', '--depth=1',
            "https://github.com/duckietm/$Name.git", $target)
    }
    $dirty = & git -C $target status --porcelain
    if ($LASTEXITCODE -ne 0 -or $dirty) { throw "$target has local changes or cannot be inspected" }
    $head = & git -C $target rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw "Cannot read $target HEAD" }
    if ($head -ne $Pin) {
        Invoke-Git @('-C', $target, 'fetch', '--filter=blob:none', '--depth=1', 'origin', $Pin)
        Invoke-Git @('-C', $target, 'checkout', '--detach', $Pin)
    }
    Invoke-Git (@('-C', $target, 'sparse-checkout', 'set') + $Paths)
    $actual = & git -C $target rev-parse HEAD
    $dirty = & git -C $target status --porcelain
    if ($LASTEXITCODE -ne 0 -or $actual -ne $Pin -or $dirty) {
        throw "$Name did not reach a clean pinned checkout"
    }
    Write-Output "[PASS] $Name at $Pin"
}

Fetch-Upstream 'Polaris-Emulator' $pins.POLARIS_REV @('Emulator', 'Database', 'docs')
Fetch-Upstream 'Octane' $pins.OCTANE_REV @('public', 'src', 'scripts', 'docs', 'css-utils')
Fetch-Upstream 'Octane-Renderer' $pins.RENDERER_REV @('packages', 'src', 'scripts', 'docs', 'protocol')
