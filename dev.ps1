# IntelaCraft quick launch (PowerShell)
# Usage:
#   .\dev.ps1              start controller
#   .\dev.ps1 setup        install + build
#   .\dev.ps1 health       connection status
#   .\dev.ps1 inspect players
#   .\dev.ps1 deploy       deploy Bedrock packs

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Show-Help {
  Write-Host ""
  Write-Host "  IntelaCraft"
  Write-Host ""
  Write-Host "  .\dev.ps1              start controller"
  Write-Host "  .\dev.ps1 setup        install + build"
  Write-Host "  .\dev.ps1 health       check controller / BDS"
  Write-Host "  .\dev.ps1 inspect <tool> [json]"
  Write-Host "  .\dev.ps1 deploy       deploy packs + configure BDS (if BDS_PATH set)"
  Write-Host "  .\dev.ps1 configure-bds write BDS variables/secrets/permissions + packs"
  Write-Host "  .\dev.ps1 test         run tests"
  Write-Host "  .\dev.ps1 build        build all packages"
  Write-Host ""
}

$cmd = if ($args.Count -gt 0) { $args[0] } else { "dev" }
$rest = @()
if ($args.Count -gt 1) { $rest = $args[1..($args.Count - 1)] }

switch ($cmd) {
  "setup" { npm run setup }
  "dev" { npm run dev }
  "start" { npm run start }
  "health" { npm run health }
  "inspect" {
    if ($rest.Count -eq 0) { npm run inspect; exit 1 }
    npm run inspect -- $rest
  }
  "deploy" { npm run deploy }
  "configure-bds" { npm run configure-bds }
  "test" { npm test }
  "build" { npm run build }
  "help" { Show-Help }
  "-h" { Show-Help }
  "--help" { Show-Help }
  default {
    Write-Host "Unknown command: $cmd"
    Show-Help
    exit 1
  }
}
