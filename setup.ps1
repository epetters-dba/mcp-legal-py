$ErrorActionPreference = "Stop"

$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$IndexJs = Join-Path $Dir "src\index.js"

Write-Host "==> Instalando dependencias..."
Push-Location $Dir
npm install
Pop-Location

$ConfigDir = Join-Path $env:APPDATA "Claude"
$ConfigFile = Join-Path $ConfigDir "claude_desktop_config.json"

if (!(Test-Path $ConfigDir)) {
    New-Item -ItemType Directory -Path $ConfigDir | Out-Null
}

if (!(Test-Path $ConfigFile)) {
    '{"mcpServers": {}}' | Out-File -FilePath $ConfigFile -Encoding utf8
}

Write-Host "==> Registrando mcp-legal-py en $ConfigFile"
$config = Get-Content $ConfigFile -Raw | ConvertFrom-Json
if (-not $config.mcpServers) {
    $config | Add-Member -MemberType NoteProperty -Name mcpServers -Value (New-Object PSObject)
}
$entry = New-Object PSObject -Property @{ command = "node"; args = @($IndexJs) }
$config.mcpServers | Add-Member -MemberType NoteProperty -Name "mcp-legal-py" -Value $entry -Force
$config | ConvertTo-Json -Depth 10 | Out-File -FilePath $ConfigFile -Encoding utf8

Write-Host "==> Listo. Reiniciá Claude Desktop por completo (clic derecho en el ícono de la bandeja del sistema -> Salir, y volver a abrir)."
