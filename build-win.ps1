$ErrorActionPreference = 'Stop'

Push-Location $PSScriptRoot
try {
    npm run build-win
    if ($LASTEXITCODE -ne 0) {
        throw "Windows build failed with exit code $LASTEXITCODE."
    }

    $package = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json
    $installerName = "m72b-tool-hub-Setup-$($package.version).exe"
    $installer = Join-Path $PSScriptRoot "m72b's test build\$installerName"
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
        throw "Build completed, but the installer was not found at: $installer"
    }

    Write-Host "Windows installer created: $installer"
}
finally {
    Pop-Location
}
