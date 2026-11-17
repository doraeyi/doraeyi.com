# 在另一台電腦（例如公司電腦）裝上 doraeyi.com 的「管理員工作狀態」hook
# 在那台電腦的 PowerShell 貼上這一行（-AllWork：這台電腦上的每個 Claude session 都算公司的，只送 work）：
#   iwr https://raw.githubusercontent.com/doraeyi/doraeyi.com/main/scripts/install-hook.ps1 -OutFile $env:TEMP\doraeyi-hook.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\doraeyi-hook.ps1 -AllWork
# 只想讓某些資料夾算公司的，把 -AllWork 換成 -WorkDir D:\Workspace
param([switch]$AllWork, [string[]]$WorkDir)

$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 預設的 TLS 太舊，GitHub 跟 doraeyi.com 連不上
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
	throw '這台電腦沒有 Node.js，hook 要用它來跑。到 https://nodejs.org 裝 LTS 版，重開 PowerShell 再跑一次'
}

# 1. 下載 hook，讓它自己裝進 ~/.claude（settings.json 會先備份）
$hook = Join-Path $env:TEMP 'doraeyi-presence.mjs'
Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/doraeyi/doraeyi.com/main/scripts/claude-presence.mjs' -OutFile $hook
$opts = @('--install')
if ($AllWork) { $opts += '--all-work' }
foreach ($d in $WorkDir) { $opts += @('--work-dir', $d) }
& node $hook @opts
if ($LASTEXITCODE -ne 0) { throw 'hook 安裝失敗' }

# 2. 密碼：已經設過而且是對的就不用再貼
function Test-Token([string]$t) {
	try {
		Invoke-RestMethod -Method Post -Uri 'https://doraeyi.com/api/presence' -Headers @{ authorization = "Bearer $t" } `
			-ContentType 'application/json' -Body '{"session":"setup-check","event":"SessionEnd","dir":"setup"}' | Out-Null
		return $true
	} catch {
		return $false
	}
}
$token = [Environment]::GetEnvironmentVariable('DORAEYI_PRESENCE_TOKEN', 'User')
if ($token -and (Test-Token $token)) {
	Write-Host '✓ 這台電腦已經設過 DORAEYI_PRESENCE_TOKEN，而且是對的'
} else {
	while ($true) {
		$s = Read-Host '貼上 PRESENCE_TOKEN（VM .env 裡的那串，畫面只會顯示 *）' -AsSecureString
		$p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
		try { $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto($p).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
		if ($token -and (Test-Token $token)) { break }
		Write-Host "✗ 網站沒收（收到 $($token.Length) 個字，正確的應該是 64 個字），再貼一次"
	}
	[Environment]::SetEnvironmentVariable('DORAEYI_PRESENCE_TOKEN', $token, 'User')
	Write-Host '✓ PRESENCE_TOKEN 正確，已設成使用者環境變數'
}

Write-Host ''
Write-Host '完成。完全結束 Claude（系統匣圖示按右鍵 → 結束）再打開，在這台電腦跟 Claude 講話，'
Write-Host 'doraeyi.com 工作室裡那張「公司」桌子的員工就會開始工作。'
