# One-time demo cleanup: the smoke suites (test-api.ps1, api-contract.test.ts,
# realtime.test.ts) leave their created files behind — RF-TEST-* / RF-RT-* rows
# with scan pages, maps and documents. This removes them in dependency order
# (scans, then maps, then documents, then the file) so the demo registry only
# shows seeded + user-created rows.
param(
    [string]$BaseUrl = 'http://localhost:5199'
)

$ErrorActionPreference = 'Stop'

function Invoke-Api($Method, $Path, $Token, $Body) {
    $args = @{
        Method      = $Method
        Uri         = "$BaseUrl$Path"
        Headers     = @{ Authorization = "Bearer $Token" }
        ContentType = 'application/json'
    }
    if ($Body) { $args.Body = $Body | ConvertTo-Json -Depth 4 }
    Invoke-RestMethod @args
}

$login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login" `
    -ContentType 'application/json' -Body '{"userName":"admin","password":"Demo@12345"}'
$admin = $login.data.token
Write-Host "signed in as admin"

$removed = 0
$skipped = 0
foreach ($prefix in @('RF-TEST-', 'RF-RT-', 'RF-RT2-')) {
    while ($true) {
        $result = Invoke-Api GET "/api/files?search=$prefix&page=1&pageSize=50" $admin
        $items = @($result.data.items | Where-Object { $_.fileBarcode.StartsWith($prefix) })
        if ($items.Count -eq 0) { break }
        $progress = $false
        foreach ($file in $items) {
            Write-Host "removing $($file.fileBarcode) (id $($file.id))..."
            try {
                foreach ($scan in @(Invoke-Api GET "/api/files/$($file.id)/scans" $admin).data) {
                    Invoke-Api DELETE "/api/scans/$($scan.id)" $admin | Out-Null
                }
                foreach ($map in @(Invoke-Api GET "/api/uploads/maps?fileBarcode=$($file.fileBarcode)" $admin).data) {
                    Invoke-Api DELETE "/api/uploads/maps/$($map.id)" $admin | Out-Null
                }
                foreach ($doc in @(Invoke-Api GET "/api/files/$($file.id)/documents" $admin).data) {
                    Invoke-Api DELETE "/api/files/$($file.id)/documents/$($doc.id)" $admin | Out-Null
                }
                Invoke-Api DELETE "/api/files/$($file.id)" $admin | Out-Null
                $removed++
                $progress = $true
            }
            catch {
                $skipped++
                Write-Warning "could not remove $($file.fileBarcode): $($_.Exception.Message)"
            }
        }
        if (-not $progress) {
            Write-Warning "no file under '$prefix' could be removed; stopping"
            break
        }
    }
}

Write-Host "done: $removed file(s) removed, $skipped skipped"
