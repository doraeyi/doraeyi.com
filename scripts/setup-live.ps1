# 一次設好「管理員的工作狀態」：這台電腦的環境變數 + 每個 repo 的 GitHub webhook
# 兩串密碼在這裡輸入（畫面上只會顯示 *），只用在這台電腦跟 GitHub 上，不會印出來、不會存檔
# 用法：powershell -ExecutionPolicy Bypass -File scripts\setup-live.ps1
#       只想改 webhook 的 Secret（例如貼錯了）：後面加 -WebhookOnly
#       重新產生一組 webhook Secret（放進剪貼簿，到 VM 的 .env 貼上）：後面加 -NewWebhookSecret
#       VM 上 GITHUB_WEBHOOK_SECRET 留空、改從 PRESENCE_TOKEN 算：後面加 -FromPresence（用這台電腦的 DORAEYI_PRESENCE_TOKEN 算同一組）
param([switch]$WebhookOnly, [switch]$NewWebhookSecret, [switch]$FromPresence)

$ErrorActionPreference = 'Stop'
$gh = 'C:\Program Files\GitHub CLI\gh.exe'
$hookUrl = 'https://doraeyi.com/api/github'

# 密碼的指紋：SHA-256 的前 8 碼，拿來跟 VM 上算的比對，從指紋推不回密碼
function Get-Fingerprint([string]$text) {
	$sha = [Security.Cryptography.SHA256]::Create()
	(($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)) | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 8)
}

# 把 JSON 寫成暫存檔（UTF-8、不帶 BOM）再交給 gh：用管線傳的話，某些 PowerShell 設定會在前面多一個 BOM，GitHub 就解析不了
function Invoke-GhJson([string]$method, [string]$path, $data, [string]$query) {
	$tmp = [IO.Path]::GetTempFileName()
	try {
		[IO.File]::WriteAllText($tmp, ($data | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
		if ($query) { & $gh api -X $method $path --input $tmp -q $query } else { & $gh api -X $method $path --input $tmp | Out-Null }
	} finally { Remove-Item $tmp -ErrorAction SilentlyContinue }
}

function Read-Secret([string]$prompt) {
	$s = Read-Host $prompt -AsSecureString
	$p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
	try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($p).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
}

if (-not $WebhookOnly -and -not $NewWebhookSecret -and -not $FromPresence) {
	$presence = Read-Secret '貼上 PRESENCE_TOKEN（VM .env 裡的第一串）'
	if (-not $presence) { throw '沒有填' }
	Write-Host "（收到 $($presence.Length) 個字，指紋 $(Get-Fingerprint $presence)）"
	# 先拿它打一次網站確認對不對：送的是 SessionEnd，不會讓任何管理員動起來
	try {
		Invoke-RestMethod -Method Post -Uri 'https://doraeyi.com/api/presence' -Headers @{ authorization = "Bearer $presence" } `
			-ContentType 'application/json' -Body '{"session":"setup-check","event":"SessionEnd","dir":"setup"}' | Out-Null
		Write-Host '✓ PRESENCE_TOKEN 正確'
	} catch {
		throw 'PRESENCE_TOKEN 不對（網站沒收），檢查一下 VM 上 .env 的值有沒有貼完整、容器有沒有重啟'
	}
	[Environment]::SetEnvironmentVariable('DORAEYI_PRESENCE_TOKEN', $presence, 'User')
	Write-Host '✓ 已設定使用者環境變數 DORAEYI_PRESENCE_TOKEN（要重開 Claude 才會生效）'
}

if ($FromPresence) {
	# 跟網站的 src/lib/server/secret.ts 同一個算法：HMAC-SHA256(PRESENCE_TOKEN, 'doraeyi github webhook')
	$token = [Environment]::GetEnvironmentVariable('DORAEYI_PRESENCE_TOKEN', 'User')
	if (-not $token) { throw '這台電腦還沒設 DORAEYI_PRESENCE_TOKEN，先跑一次不加參數的版本' }
	$hmac = New-Object Security.Cryptography.HMACSHA256 (, [Text.Encoding]::UTF8.GetBytes($token))
	$secret = ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes('doraeyi github webhook')) | ForEach-Object { $_.ToString('x2') }) -join ''
} elseif ($NewWebhookSecret) {
	# 32 個隨機位元組 → 64 個十六進位字，不印在畫面上，只放進剪貼簿
	$bytes = New-Object byte[] 32
	[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
	$secret = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
	Set-Clipboard -Value $secret
	Write-Host '已經產生一組新的 Secret，放進剪貼簿了（畫面上不顯示）。接著到 VM 上：'
	Write-Host '  1. cd ~/doraeyi-site && nano .env'
	Write-Host '  2. 移到 GITHUB_WEBHOOK_SECRET= 那一行，按 Ctrl+K 整行刪掉'
	Write-Host '  3. 打 GITHUB_WEBHOOK_SECRET= ，接著按 Ctrl+Shift+V（或滑鼠右鍵）貼上，不要有空格'
	Write-Host '  4. Ctrl+O、Enter 存檔，Ctrl+X 離開，再跑 docker compose up -d'
	Read-Host '都做完了按 Enter'
} else {
	$secret = Read-Secret '貼上 GITHUB_WEBHOOK_SECRET（第二串）'
	if (-not $secret) { throw '沒有填' }
}
Write-Host "（收到 $($secret.Length) 個字，指紋 $(Get-Fingerprint $secret)）"

# 自己的 repo（不含 fork、封存）都加 webhook；已經有的跳過
$repos = & $gh repo list doraeyi --limit 200 --no-archived --source --json nameWithOwner -q '.[].nameWithOwner'
$config = @{ url = $hookUrl; content_type = 'json'; secret = $secret; insecure_ssl = '0' }
$pinged = $null
foreach ($r in $repos) {
	$id = (& $gh api "repos/$r/hooks" | ConvertFrom-Json | Where-Object { $_.config.url -eq $hookUrl } | Select-Object -First 1).id
	if ($id) {
		# 已經有了：只換 Secret
		Invoke-GhJson PATCH "repos/$r/hooks/$id/config" $config
	} else {
		$id = Invoke-GhJson POST "repos/$r/hooks" @{ name = 'web'; active = $true; events = @('push'); config = $config } '.id'
	}
	if ($LASTEXITCODE -ne 0 -or -not $id) { Write-Host "✗ $r 設不上去"; continue }
	Write-Host "✓ $r"
	if (-not $pinged) {
		& $gh api -X POST "repos/$r/hooks/$id/pings" | Out-Null
		$pinged = @($r, $id)
	}
}

# 叫 GitHub 送一次 ping，看網站收不收：收了就代表 Secret 跟 VM 上的一樣
if ($pinged) {
	Start-Sleep -Seconds 4
	$code = & $gh api "repos/$($pinged[0])/hooks/$($pinged[1])" -q '.last_response.code'
	if ($code -eq '200') { Write-Host "✓ 網站收到 GitHub 的 ping，Secret 正確" }
	else { Write-Host "✗ 網站回 $code：Secret 跟 VM 上的 GITHUB_WEBHOOK_SECRET 不一樣，重跑一次並加上 -WebhookOnly" }
}
Write-Host ''
Write-Host '完成。完全關掉 Claude 桌面版再打開，管理員就會跟著你工作了。'
