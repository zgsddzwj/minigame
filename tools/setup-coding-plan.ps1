$ErrorActionPreference = 'Stop'
$secret = Read-Host '粘贴已绑定火山 Coding Plan 的 API Key（输入不会显示）' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ([string]::IsNullOrWhiteSpace($plain)) { throw 'API Key 不能为空' }
    [Environment]::SetEnvironmentVariable('ARK_API_KEY', $plain, [EnvironmentVariableTarget]::User)
    Write-Host '已保存为当前 Windows 用户的 ARK_API_KEY。请关闭并重新打开终端，然后运行 npm run doctor。'
} finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $plain = $null
    $secret = $null
}
