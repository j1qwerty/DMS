<#
.SYNOPSIS
    End-to-end API smoke test. Exercises the real HTTP surface against a real
    SQL Server: auth, the legacy guards, multi-file issue with a partial
    return, location hierarchy rules, digitization versioning, bulk ingest,
    reports, audit and role-based access.

.DESCRIPTION
    No browser involved. Starts nothing itself: point -BaseUrl at a running API
    (dotnet run) or let it use http://localhost:5199.

    Exits non-zero on the first failed assertion so CI can gate on it.

.EXAMPLE
    pwsh scripts/test-api.ps1
.EXAMPLE
    pwsh scripts/test-api.ps1 -BaseUrl http://localhost:5199 -Verbose
#>
[CmdletBinding()]
param(
    [string] $BaseUrl = 'http://localhost:5199',
    [string] $AdminUser = 'admin',
    [string] $AdminPassword = 'Demo@12345',
    [switch] $SkipDestructive
)

$ErrorActionPreference = 'Stop'
$script:Passed = 0
$script:Failed = 0
$script:FailList = New-Object System.Collections.ArrayList

function Write-Step { param([string] $Text) Write-Host "`n=== $Text ===" -ForegroundColor Cyan }
function Write-Ok   { param([string] $Text) Write-Host "  PASS  $Text" -ForegroundColor Green; $script:Passed++ }
function Write-Fail { param([string] $Text) Write-Host "  FAIL  $Text" -ForegroundColor Red; $script:Failed++; [void]$script:FailList.Add($Text) }

function Assert-True {
    # [object] on purpose: call sites pass comparisons, counts and raw values.
    # A [bool] parameter rejects a non-empty string at binding time.
    param([object] $Condition, [string] $Message)
    if ($Condition) { Write-Ok $Message } else { Write-Fail $Message }
}

function Assert-Equal {
    param($Expected, $Actual, [string] $Message)
    if ($Expected -eq $Actual) { Write-Ok $Message }
    else { Write-Fail "$Message (expected '$Expected', got '$Actual')" }
}

function Invoke-Api {
    param(
        [string] $Method = 'GET',
        [string] $Path,
        $Body,
        [string] $Token,
        [switch] $Raw
    )
    $uri = "$BaseUrl$Path"
    $headers = @{}
    if ($Token) { $headers['Authorization'] = "Bearer $Token" }

    $params = @{
        Uri             = $uri
        Method          = $Method
        Headers         = $headers
        TimeoutSec      = 60
        ErrorAction     = 'Stop'
        UseBasicParsing = $true
    }
    if ($null -ne $Body) {
        $params['Body'] = ($Body | ConvertTo-Json -Depth 8 -Compress)
        $params['ContentType'] = 'application/json'
    }

    try {
        $response = Invoke-WebRequest @params
        $text = $response.Content
    }
    catch {
        $status = [int]$_.Exception.Response.StatusCode
        $text = ''
        try {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $text = $reader.ReadToEnd()
        } catch { }
        if ($Raw) { return [pscustomobject]@{ Status = $status; Body = $text } }
        return [pscustomobject]@{ Status = $status; Body = $text }
    }

    if ($Raw) { return [pscustomobject]@{ Status = 200; Body = $text } }

    $data = $null
    if ($text.Length -gt 0) { try { $data = $text | ConvertFrom-Json } catch { $data = $text } }
    return [pscustomobject]@{ Status = 200; Body = $text; Data = $data }
}

function Get-Token {
    param([string] $User, [string] $Password)
    $r = Invoke-Api -Method POST -Path '/api/auth/login' -Body @{ userName = $User; password = $Password }
    if ($r.Status -eq 200 -and $r.Data.success) { return $r.Data.data.token }

    # D4 (work plan §2.1): a throttled or failed sign-in used to cascade —
    # every later call went out with no token and 401'd, so one rate-limit
    # hit read as nineteen broken assertions. Abort here, with the reason.
    throw (
        "Sign-in for '$User' failed (HTTP $($r.Status)). " +
        "The API rate-limits logins (10 per 60s): wait at least 110 seconds " +
        "after another run and retry. Aborting so this fails once, not as a 401 cascade."
    )
}

# D4: keep a readable verdict when the suite aborts mid-flight instead of a
# bare stack trace.
trap {
    Write-Host "`n================================" -ForegroundColor Cyan
    Write-Host "  ABORTED after $script:Passed passing assertions" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "================================" -ForegroundColor Cyan
    exit 1
}

# ============================================================ health
Write-Step 'Health'
$health = Invoke-Api -Path '/api/health'
Assert-Equal 200 $health.Status 'GET /api/health responds'
Assert-Equal 'Connected' $health.Data.database 'SQL Server is reachable'

# ============================================================ config
Write-Step 'Product config and feature switch'
$config = Invoke-Api -Path '/api/config'
Assert-Equal 200 $config.Status 'GET /api/config is public'
Assert-Equal 'Document Management System' $config.Data.appName 'the product is named Document Management System'
Assert-True ($config.Data.features.barcode -is [bool]) 'config reports the barcode feature as true/false'
$barcodeOn = [bool]$config.Data.features.barcode
$movementOn = [bool]$config.Data.features.movement
$supportOn = [bool]$config.Data.features.support
$bulkImportOn = [bool]$config.Data.features.bulkImport
Assert-True ($config.Data.features.movement -is [bool]) 'config reports the movement feature as true/false'
Assert-True ($config.Data.features.support -is [bool]) 'config reports the support feature as true/false'
Assert-True ($config.Data.features.bulkImport -is [bool]) 'config reports the bulk-import feature as true/false'
Write-Host "  (optional features: barcode=$barcodeOn movement=$movementOn support=$supportOn bulkImport=$bulkImportOn)"

# ============================================================ auth
Write-Step 'Authentication'
$admin = Get-Token $AdminUser $AdminPassword
Assert-True ($null -ne $admin) "admin can sign in and receives a token"

# Every role token is fetched once, here: the login limiter is a shared
# 10-per-60s budget and the suite already spends several attempts on the
# negative auth cases below.
$employeeToken = Get-Token 'employee' $AdminPassword
$operatorToken = Get-Token 'operator' $AdminPassword
$supervisorToken = Get-Token 'supervisor' $AdminPassword

$me = Invoke-Api -Path '/api/auth/me' -Token $admin
Assert-Equal 200 $me.Status 'GET /api/auth/me accepts the token'
Assert-Equal 'Admin' $me.Data.data.user.role 'role claim round-trips'

$bad = Invoke-Api -Method POST -Path '/api/auth/login' -Body @{ userName = $AdminUser; password = 'nope' }
Assert-Equal 400 $bad.Status 'a wrong password is rejected with 400'
Assert-True ($bad.Body -match 'password') 'the rejection names the offending field'

$unknown = Invoke-Api -Method POST -Path '/api/auth/login' -Body @{ userName = 'ghost'; password = 'x' }
Assert-Equal 400 $unknown.Status 'an unknown user name is rejected'

$deactivated = Invoke-Api -Method POST -Path '/api/auth/login' -Body @{ userName = 'deputy.ceo'; password = $AdminPassword }
Assert-Equal 400 $deactivated.Status 'a deactivated account cannot sign in'

$noAuth = Invoke-Api -Path '/api/files'
Assert-Equal 401 $noAuth.Status 'protected endpoints reject anonymous callers'

$badToken = Invoke-Api -Path '/api/files' -Token 'not.a.jwt'
Assert-Equal 401 $badToken.Status 'a malformed token is rejected'

# OTP and PIN flows
$otp = Invoke-Api -Method POST -Path '/api/auth/otp/request' -Body @{ userName = 'operator' }
Assert-Equal 200 $otp.Status 'OTP can be requested'
Assert-True ($null -eq $otp.Data.data.otp) 'the OTP is never echoed back over HTTP'
$pin = Invoke-Api -Method POST -Path '/api/auth/pin' -Body @{ userName = 'operator'; pin = '1234' }
Assert-Equal 200 $pin.Status 'PIN sign-in works with the demo PIN'
$badPin = Invoke-Api -Method POST -Path '/api/auth/pin' -Body @{ userName = 'operator'; pin = '9999' }
Assert-Equal 400 $badPin.Status 'a wrong PIN is rejected'

# ============================================================ locations
Write-Step 'Location hierarchy and guards'
$rooms = Invoke-Api -Path '/api/locations/rooms' -Token $admin
Assert-Equal 200 $rooms.Status 'GET /api/locations/rooms responds'
$roomCount = @($rooms.Data.data).Count
Assert-True ($roomCount -ge 3) "rooms are returned (got $roomCount)"
$room1 = @($rooms.Data.data)[0]
Assert-True (@($room1.sections).Count -gt 0) 'a room carries its sections'
$section1 = @($room1.sections)[0]
Assert-True (@($section1.storageUnits).Count -gt 0) 'a section carries its almirahs'
$almirah1 = @($section1.storageUnits)[0]
Assert-True (@($almirah1.shelves).Count -gt 0) 'an almirah carries its shelves'

$areas = Invoke-Api -Path '/api/locations/areas' -Token $admin
Assert-True (@($areas.Data.data).Count -gt 0) 'master areas are available for the pincode lookup'

if (-not $SkipDestructive) {
    # ---- rooms: add, edit, delete, and the guards around them
    $roomName = "TEST-ROOM-$([guid]::NewGuid().ToString('N').Substring(0,6))"
    $newRoom = Invoke-Api -Method POST -Path '/api/locations/rooms' -Token $admin `
        -Body @{ name = $roomName; building = 'Annex'; floor = 'Ground' }
    Assert-Equal 200 $newRoom.Status 'a room can be added'
    Assert-True ($newRoom.Data.data.code -match '^RM-\d{3}$') 'a new room gets a generated RM-### code'
    $newRoomId = $newRoom.Data.data.id

    $dupRoom = Invoke-Api -Method POST -Path '/api/locations/rooms' -Token $admin -Body @{ name = $roomName.ToLower() }
    Assert-Equal 400 $dupRoom.Status 'a duplicate room name is refused (case-insensitive)'
    $blankRoom = Invoke-Api -Method POST -Path '/api/locations/rooms' -Token $admin -Body @{ name = '  ' }
    Assert-Equal 400 $blankRoom.Status 'a blank room name is refused'

    $editedRoom = Invoke-Api -Method PUT -Path "/api/locations/rooms/$newRoomId" -Token $admin `
        -Body @{ name = "$roomName-EDITED"; status = 'Maintenance' }
    Assert-Equal 200 $editedRoom.Status 'a room can be edited'
    Assert-Equal 'Maintenance' $editedRoom.Data.data.status 'the room status change is saved'
    Assert-Equal $newRoom.Data.data.code $editedRoom.Data.data.code 'a room keeps its code when edited'

    $employeeAddRoom = Invoke-Api -Method POST -Path '/api/locations/rooms' -Token $employeeToken -Body @{ name = 'Nope' }
    Assert-Equal 403 $employeeAddRoom.Status 'an employee cannot add a room'

    $deleteFullRoom = Invoke-Api -Method DELETE -Path "/api/locations/rooms/$($room1.id)" -Token $admin
    Assert-Equal 400 $deleteFullRoom.Status 'a room that still has sections cannot be deleted'
    $deleteNewRoom = Invoke-Api -Method DELETE -Path "/api/locations/rooms/$newRoomId" -Token $admin
    Assert-Equal 200 $deleteNewRoom.Status 'an empty room can be deleted'
    $deleteAgain = Invoke-Api -Method DELETE -Path "/api/locations/rooms/$newRoomId" -Token $admin
    Assert-Equal 400 $deleteAgain.Status 'deleting a room twice reports it missing'

    $dup = Invoke-Api -Method POST -Path "/api/locations/rooms/$($room1.id)/sections" -Token $admin `
        -Body @{ name = $section1.name }
    Assert-Equal 400 $dup.Status 'a duplicate section name in the same room is refused'

    $deleteWithChildren = Invoke-Api -Method DELETE -Path "/api/locations/sections/$($section1.id)" -Token $admin
    Assert-Equal 400 $deleteWithChildren.Status 'a section holding almirahs cannot be deleted'

    $deleteShelfWithFiles = Invoke-Api -Method DELETE -Path "/api/locations/shelves/$($almirah1.shelves[0].id)" -Token $admin
    Assert-Equal 400 $deleteShelfWithFiles.Status 'a shelf holding files cannot be deleted'

    # Add then remove a section so the round trip is covered.
    $created = Invoke-Api -Method POST -Path "/api/locations/rooms/$($room1.id)/sections" -Token $admin `
        -Body @{ name = "TEST-$([guid]::NewGuid().ToString('N').Substring(0,6))" }
    Assert-Equal 200 $created.Status 'a new section can be added'
    $newSectionId = $created.Data.data.id
    $removed = Invoke-Api -Method DELETE -Path "/api/locations/sections/$newSectionId" -Token $admin
    Assert-Equal 200 $removed.Status 'an empty section can be removed'

    $layout = Invoke-Api -Method POST -Path "/api/locations/rooms/$($room1.id)/layout" -Token $admin `
        -Body @{ note = 'api smoke test' }
    Assert-Equal 200 $layout.Status 'a layout revision is saved'
    $revisions = Invoke-Api -Path "/api/locations/rooms/$($room1.id)/layout/revisions" -Token $admin
    Assert-True (@($revisions.Data.data).Count -ge 1) 'layout revisions are listed'

    $dupShelf = Invoke-Api -Method POST -Path "/api/locations/almirahs/$($almirah1.id)/shelves" -Token $admin `
        -Body @{ code = 'DUPE-S-01'; name = 'Duplicate'; barcode = $almirah1.shelves[0].barcode; capacity = 80 }
    Assert-Equal 400 $dupShelf.Status 'a duplicate shelf barcode is refused'
}

# ============================================================ files
Write-Step 'File registry and validation guards'
$files = Invoke-Api -Path '/api/files?pageSize=50' -Token $admin
Assert-Equal 200 $files.Status 'GET /api/files responds'
$page = $files.Data.data
Assert-True ($page.total -gt 0) "files are returned (got $($page.total))"
Assert-Equal 2478450 $page.collectionTotal 'collectionTotal reports the legacy registry size'
Assert-True ($page.items.Count -le 50) 'pageSize caps the returned window'

$first = @($page.items)[0]
Assert-True ($first.fileBarcode) 'each file carries a barcode'
Assert-True ($null -ne $first.lastMovement) 'each file carries a last-movement stamp'

$byBarcode = Invoke-Api -Path "/api/files/by-barcode/$($first.fileBarcode)" -Token $admin
if ($barcodeOn) {
    Assert-Equal 200 $byBarcode.Status 'a file resolves by barcode'
    Assert-Equal $first.id $byBarcode.Data.data.id 'barcode lookup returns the same row'
} else {
    Assert-Equal 404 $byBarcode.Status 'barcode lookup is blocked while barcode features are off'
    $barcodeApi = Invoke-Api -Path '/api/barcodes/jobs' -Token $admin
    Assert-Equal 404 $barcodeApi.Status 'the barcode endpoints are blocked while barcode features are off'
}

$departments = Invoke-Api -Path '/api/files/departments' -Token $admin
Assert-True (@($departments.Data.data).Count -gt 0) 'departments are listed for filtering'

$search = Invoke-Api -Path '/api/files?search=land&pageSize=10' -Token $admin
Assert-True ($search.Data.data.total -ge 1) 'search narrows the result set'

# Find an active shelf to file against.
$roomsFresh = Invoke-Api -Path '/api/locations/rooms' -Token $admin
$activeShelf = $null
$blockedShelf = $null
foreach ($r in @($roomsFresh.Data.data)) {
    foreach ($s in @($r.sections)) {
        foreach ($u in @($s.storageUnits)) {
            foreach ($sh in @($u.shelves)) {
                if ($sh.status -eq 'Active' -and $null -eq $activeShelf) { $activeShelf = $sh }
                if ($sh.status -ne 'Active' -and $null -eq $blockedShelf) { $blockedShelf = $sh }
            }
        }
    }
}
Assert-True ($null -ne $activeShelf) 'the seed contains an active shelf'
Assert-True ($null -ne $blockedShelf) 'the seed contains a non-active shelf for the guard tests'

$dupBarcode = Invoke-Api -Method POST -Path '/api/files' -Token $admin -Body @{
    fileBarcode   = $first.fileBarcode
    subject       = 'Duplicate barcode attempt'
    department    = 'Revenue'
    year          = 2026
    fileType      = 'File'
    shelfId       = $activeShelf.id
    position      = 10
    pincode       = ''
    area          = ''
    propertyNo    = ''
    propertyArea  = ''
    dealer        = ''
    codalLife     = '25 years'
    description   = ''
}
Assert-Equal 400 $dupBarcode.Status 'a duplicate file barcode is refused'

$blockedShelfCreate = Invoke-Api -Method POST -Path '/api/files' -Token $admin -Body @{
    fileBarcode   = "RF-TEST-$([guid]::NewGuid().ToString('N').Substring(0,8))"
    subject       = 'Blocked shelf attempt'
    department    = 'Revenue'
    year          = 2026
    fileType      = 'File'
    shelfId       = $blockedShelf.id
    position      = 10
    pincode       = ''
    area          = ''
    propertyNo    = ''
    propertyArea  = ''
    dealer        = ''
    codalLife     = '25 years'
    description   = ''
}
Assert-Equal 400 $blockedShelfCreate.Status 'a file cannot be placed on a non-active shelf'
Assert-True ($blockedShelfCreate.Body -match 'shelfId') 'the blocked-shelf error names the field'

$badArea = Invoke-Api -Method POST -Path '/api/files' -Token $admin -Body @{
    fileBarcode   = "RF-TEST-$([guid]::NewGuid().ToString('N').Substring(0,8))"
    subject       = 'Unknown area'
    department    = 'Revenue'
    year          = 2026
    fileType      = 'File'
    shelfId       = $activeShelf.id
    position      = 10
    pincode       = ''
    area          = 'NOWHERE-LAND'
    propertyNo    = ''
    propertyArea  = ''
    dealer        = ''
    codalLife     = '25 years'
    description   = ''
}
Assert-Equal 400 $badArea.Status 'an unknown area is refused (getpincode guard)'

$badPosition = Invoke-Api -Method POST -Path '/api/files' -Token $admin -Body @{
    fileBarcode   = "RF-TEST-$([guid]::NewGuid().ToString('N').Substring(0,8))"
    subject       = 'Bad position'
    department    = 'Revenue'
    year          = 2026
    fileType      = 'File'
    shelfId       = $activeShelf.id
    position      = 0
    pincode       = ''
    area          = ''
    propertyNo    = ''
    propertyArea  = ''
    dealer        = ''
    codalLife     = '25 years'
    description   = ''
}
Assert-Equal 400 $badPosition.Status 'a position outside 1..100 is refused'

$newBarcode = "RF-TEST-$([guid]::NewGuid().ToString('N').Substring(0,8))"
$createdFile = Invoke-Api -Method POST -Path '/api/files' -Token $admin -Body @{
    fileBarcode   = $newBarcode
    subject       = 'Created by the API smoke test'
    department    = 'Revenue'
    year          = 2026
    fileType      = 'File'
    shelfId       = $activeShelf.id
    position      = 12
    pincode       = ''
    area          = ''
    propertyNo    = 'PROP-TEST'
    propertyArea  = '1 hectare'
    dealer        = 'Test dealer'
    codalLife     = '25 years'
    description   = 'Created by the smoke test.'
}
Assert-Equal 200 $createdFile.Status 'a valid file is created'
$newFileId = $createdFile.Data.data.id
Assert-Equal $newBarcode $createdFile.Data.data.fileBarcode 'the created file keeps its barcode'
Assert-Equal 'Available' $createdFile.Data.data.status 'a new file starts Available'

$relocated = Invoke-Api -Method POST -Path "/api/files/$newFileId/relocate" -Token $admin -Body @{
    shelfId = $activeShelf.id; position = 30; reason = 'Smoke test relocation'
}
Assert-Equal 200 $relocated.Status 'a file can be relocated'
Assert-Equal 30 $relocated.Data.data.position 'the new position is stored'

# Optional placement (user decision 2026-10-28): a file can be registered
# without a shelf, shows "Not placed", is issuable by barcode, and can be
# shelved later via the same relocate endpoint.
$unplacedBarcode = "RF-TEST-$([guid]::NewGuid().ToString('N').Substring(0,8))"
$unplacedCreate = Invoke-Api -Method POST -Path '/api/files' -Token $admin -Body @{
    fileBarcode   = $unplacedBarcode
    subject       = 'Registered before placement'
    department    = 'Revenue'
    year          = 2026
    fileType      = 'File'
    shelfId       = $null
    position      = 1
    pincode       = ''
    area          = ''
    propertyNo    = ''
    propertyArea  = ''
    dealer        = ''
    codalLife     = '25 years'
    description   = ''
}
Assert-Equal 200 $unplacedCreate.Status 'a file without a shelf is created (placement optional)'
Assert-Equal 'Not placed' $unplacedCreate.Data.data.location 'an unplaced file reports Not placed'
Assert-True ($null -eq $unplacedCreate.Data.data.roomId) 'an unplaced file has no room'
$unplacedId = $unplacedCreate.Data.data.id

$issueUnplaced = Invoke-Api -Method POST -Path '/api/issues' -Token $admin -Body @{
    borrowerType = 'Employee'; borrowerEmployeeCode = 'EMP0002'; borrowerName = 'Sita Devi'
    department = 'Establishment'; purpose = 'Smoke test unplaced issue'
    fileIds = @($unplacedId)
    dueAt = (Get-Date).AddDays(7).ToString('yyyy-MM-ddTHH:mm:ss'); remark = ''
}
Assert-Equal 200 $issueUnplaced.Status 'an unplaced file is issuable by barcode'
$backUnplaced = Invoke-Api -Method POST -Path "/api/issues/$($issueUnplaced.Data.data.id)/return" -Token $admin -Body @{
    fileIds = @($unplacedId); condition = 'Good'
}
Assert-Equal 200 $backUnplaced.Status 'the unplaced-file receipt is returned'

$placedLater = Invoke-Api -Method POST -Path "/api/files/$unplacedId/relocate" -Token $admin -Body @{
    shelfId = $activeShelf.id; position = 5; reason = 'Shelved after registration'
}
Assert-Equal 200 $placedLater.Status 'an unplaced file can be shelved later'
Assert-Equal 5 $placedLater.Data.data.position 'the placement position is stored'
Assert-True ($placedLater.Data.data.location -ne 'Not placed') 'the placed file has a real location'

# ============================================================ issue / return
Write-Step 'Multi-file issue and partial return'
$available = Invoke-Api -Path '/api/files?status=Available&pageSize=10' -Token $admin
$targets = @($available.Data.data.items | Where-Object { $_.fileBarcode -ne $newBarcode -and $_.fileBarcode -ne $unplacedBarcode }) | Select-Object -First 2
Assert-True ($targets.Count -eq 2) 'two available files are available to issue'

$nextReceipt = Invoke-Api -Path '/api/issues/next-receipt-number' -Token $admin
Assert-True ($nextReceipt.Data.data -match '^ISS-\d{4}-\d{4}$') 'the next receipt number is well formed'

$noBorrower = Invoke-Api -Method POST -Path '/api/issues' -Token $admin -Body @{
    borrowerType = 'Employee'; borrowerEmployeeCode = ''; borrowerName = ''
    department = 'Establishment'; purpose = 'test'
    fileIds = @($targets[0].id); dueAt = (Get-Date).AddDays(14).ToString('yyyy-MM-ddTHH:mm:ss'); remark = ''
}
Assert-Equal 400 $noBorrower.Status 'issuing without a borrower is refused'

$dupeScan = Invoke-Api -Method POST -Path '/api/issues' -Token $admin -Body @{
    borrowerType = 'Employee'; borrowerEmployeeCode = 'EMP0001'; borrowerName = 'Ramesh Kumar'
    department = 'Establishment'; purpose = 'test'
    fileIds = @($targets[0].id, $targets[0].id)
    dueAt = (Get-Date).AddDays(14).ToString('yyyy-MM-ddTHH:mm:ss'); remark = ''
}
Assert-Equal 400 $dupeScan.Status 'scanning the same file twice on one receipt is refused'

$issued = Invoke-Api -Method POST -Path '/api/issues' -Token $admin -Body @{
    borrowerType = 'Employee'; borrowerEmployeeCode = 'EMP0001'; borrowerName = 'Ramesh Kumar'
    department = 'Establishment'; purpose = 'Smoke test multi-file issue'
    fileIds = @($targets[0].id, $targets[1].id)
    dueAt = (Get-Date).AddDays(14).ToString('yyyy-MM-ddTHH:mm:ss'); remark = 'created by the smoke test'
}
Assert-Equal 200 $issued.Status 'a multi-file receipt is created'
$receiptId = $issued.Data.data.id
Assert-Equal 2 @($issued.Data.data.lines).Count 'both files are on the receipt'
Assert-Equal 'Issued' $issued.Data.data.status 'the receipt starts Issued'

foreach ($t in $targets) {
    $after = Invoke-Api -Path "/api/files/$($t.id)" -Token $admin
    Assert-Equal 'Issued' $after.Data.data.status "$($t.fileBarcode) flipped to Issued"
}

$borrowers = Invoke-Api -Path '/api/issues/borrowers' -Token $admin
Assert-True (@($borrowers.Data.data).Count -gt 0) 'the borrower list includes the new receipt'

$partial = Invoke-Api -Method POST -Path "/api/issues/$receiptId/return" -Token $admin -Body @{
    fileIds = @($targets[0].id); condition = 'Good'
}
Assert-Equal 200 $partial.Status 'a partial return is accepted'
Assert-Equal 'Partially returned' $partial.Data.data.status 'the receipt becomes Partially returned'
$backFirst = Invoke-Api -Path "/api/files/$($targets[0].id)" -Token $admin
Assert-Equal 'Available' $backFirst.Data.data.status 'the returned file is Available again'
$stillOut = Invoke-Api -Path "/api/files/$($targets[1].id)" -Token $admin
Assert-Equal 'Issued' $stillOut.Data.data.status 'the other file is still out'

$foreign = Invoke-Api -Method POST -Path "/api/issues/$receiptId/return" -Token $admin -Body @{
    fileIds = @($createdFile.Data.data.id); condition = 'Good'
}
Assert-Equal 400 $foreign.Status 'returning a file from another receipt is refused'

$rest = Invoke-Api -Method POST -Path "/api/issues/$receiptId/return" -Token $admin -Body @{
    fileIds = @($targets[1].id); condition = 'Minor damage'
}
Assert-Equal 200 $rest.Status 'the remainder is returned'
Assert-Equal 'Returned' $rest.Data.data.status 'the receipt settles as Returned'
Assert-True ($null -ne $rest.Data.data.returnedAt) 'the settlement timestamp is recorded'

# ============================================================ movements + audit
Write-Step 'Movement log and audit trail'
if ($movementOn) {
    $movements = Invoke-Api -Path "/api/movements?fileId=$newFileId" -Token $admin
    Assert-Equal 200 $movements.Status 'GET /api/movements responds while enabled'
    Assert-True (@($movements.Data.data).Count -ge 2) 'create + relocate events were recorded'
} else {
    $hiddenMovement = Invoke-Api -Path '/api/movements' -Token $admin
    Assert-Equal 404 $hiddenMovement.Status 'movement history is hidden when disabled'
}

$audit = Invoke-Api -Path '/api/audit?limit=50' -Token $admin
Assert-Equal 200 $audit.Status 'GET /api/audit responds'
$entries = @($audit.Data.data.entries)
Assert-True ($entries.Count -gt 0) 'audit entries exist'
$hasIp = ($entries | Where-Object { $_.ip }).Count -gt 0
Assert-True $hasIp 'audit entries carry an IP'
$hasBeforeAfter = ($entries | Where-Object { $_.before -and $_.after }).Count -gt 0
Assert-True $hasBeforeAfter 'audit entries carry before and after states'
$issueAudit = ($entries | Where-Object { $_.summary -like "*$receiptId*" -or $_.summary -like '*Issued 2 file*' }).Count
Assert-True ($issueAudit -gt 0) 'the multi-file issue is on the audit trail'

$logins = Invoke-Api -Path '/api/audit/login-history' -Token $admin
Assert-Equal 200 $logins.Status 'GET /api/audit/login-history responds'
Assert-True (@($logins.Data.data.entries).Count -gt 0) 'login attempts are recorded'
$failures = @($logins.Data.data.entries | Where-Object { $_.outcome -eq 'Failed' }).Count
Assert-True ($failures -gt 0) 'failed sign-in attempts are recorded'

# ============================================================ file scan pages (digitization)
Write-Step 'File scan pages — add, version, review (file-centric)'
$scans = Invoke-Api -Path "/api/files/$newFileId/scans" -Token $admin
Assert-Equal 200 $scans.Status 'GET /api/files/{id}/scans responds'

$badPageNo = Invoke-Api -Method POST -Path "/api/files/$newFileId/scans" -Token $admin -Body @{
    fileName = ''; pageNo = 0; documentSize = 'A4'
}
Assert-Equal 400 $badPageNo.Status 'a page number below 1 is refused'

$badSize = Invoke-Api -Method POST -Path "/api/files/$newFileId/scans" -Token $admin -Body @{
    fileName = ''; pageNo = 1; documentSize = 'Letter'
}
Assert-Equal 400 $badSize.Status 'an unknown document size is refused'

if (-not $SkipDestructive) {
    # Pages are registered as metadata rows; the scanned image follows as its
    # own version. The re-scan of the same page becomes the next version.
    $page1 = Invoke-Api -Method POST -Path "/api/files/$newFileId/scans" -Token $admin -Body @{
        fileName = ''; pageNo = 1; documentSize = 'A4'
    }
    Assert-Equal 200 $page1.Status 'a scanned page is registered'
    Assert-Equal 1 $page1.Data.data.version 'the first page is version 1'
    Assert-Equal 'Pending review' $page1.Data.data.status 'a new page awaits review'
    Assert-Equal 'A4' $page1.Data.data.documentSize 'the page keeps its document size'

    $page2 = Invoke-Api -Method POST -Path "/api/files/$newFileId/scans" -Token $admin -Body @{
        fileName = ''; pageNo = 1; documentSize = ''
    }
    Assert-Equal 200 $page2.Status 'a re-scan of the same page is accepted'
    Assert-Equal 2 $page2.Data.data.version 'the re-scan is stored as the next version'
    Assert-Equal $createdFile.Data.data.documentSize $page2.Data.data.documentSize 'a blank document size inherits the file size'

    $scanPdf = Join-Path $env:TEMP 'rr-smoke-scan.pdf'
    [IO.File]::WriteAllBytes($scanPdf, [Text.Encoding]::ASCII.GetBytes(
        "%PDF-1.4`n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj`n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj`n" +
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj`ntrailer<</Size 4/Root 1 0 R>>`n%%EOF"))
    $raw = curl.exe -s -X POST "$BaseUrl/api/scans/$($page1.Data.data.id)/document" `
        -H "Authorization: Bearer $admin" `
        -F "document=@$scanPdf;type=application/pdf"
    $uploaded = $raw | ConvertFrom-Json
    Assert-True ([bool]$uploaded.success) 'the scanned image is attached to the page row'
    $page3 = $uploaded.data
    Assert-Equal $page1.Data.data.id $page3.id 'attaching the scan fills the registration row in place'
    Assert-Equal 1 $page3.version 'the attached scan keeps version 1'
    Assert-True ($page3.pageCount -eq 1) 'the pdf page count is stored on the scan'

    $scanContent = Invoke-Api -Path "/api/scans/$($page1.Data.data.id)/content" -Token $admin -Raw
    Assert-Equal 200 $scanContent.Status 'a digitized scan can be opened by an authorized user'
    $scanAccess = Invoke-Api -Path "/api/audit?action=Access&entity=FileScanPage&search=$($page1.Data.data.id)" -Token $admin
    Assert-Equal 200 $scanAccess.Status 'scan access audit can be queried'
    Assert-True (@($scanAccess.Data.data.entries).Count -gt 0) 'opening a scan writes a document-access audit event'

    $empAdd = Invoke-Api -Method POST -Path "/api/files/$newFileId/scans" -Token $employeeToken -Body @{
        fileName = ''; pageNo = 2; documentSize = 'A4'
    }
    Assert-Equal 403 $empAdd.Status 'an employee cannot register scan pages'
    $opReview = Invoke-Api -Method POST -Path "/api/scans/$($page2.Data.data.id)/review" -Token $operatorToken -Body @{
        decision = 'Approved'; note = ''
    }
    Assert-Equal 403 $opReview.Status 'an operator cannot review scan pages'
    $supRemove = Invoke-Api -Method DELETE -Path "/api/scans/$($page1.Data.data.id)" -Token $supervisorToken
    Assert-Equal 200 $supRemove.Status 'a supervisor can remove a pending scan page'
    $supRemoveAgain = Invoke-Api -Method DELETE -Path "/api/scans/$($page1.Data.data.id)" -Token $supervisorToken
    Assert-Equal 400 $supRemoveAgain.Status 'removing an already removed scan page is refused'

    $noReason = Invoke-Api -Method POST -Path "/api/scans/$($page2.Data.data.id)/review" -Token $admin -Body @{
        decision = 'Rejected'; note = '  '
    }
    Assert-Equal 400 $noReason.Status 'a rejection without a reason is refused'
    $approved = Invoke-Api -Method POST -Path "/api/scans/$($page2.Data.data.id)/review" -Token $admin -Body @{
        decision = 'Approved'; note = ''
    }
    Assert-Equal 200 $approved.Status 'a scan page can be approved'

    # A fresh page for the bulk review: the two rows above are already resolved.
    $page3 = Invoke-Api -Method POST -Path "/api/files/$newFileId/scans" -Token $admin -Body @{
        fileName = ''; pageNo = 3; documentSize = ''
    }
    Assert-Equal 200 $page3.Status 'another page is registered for the bulk review'

    # Leave the smoke-test file clean: approve everything pending so repeated
    # runs do not accumulate queue entries.
    $pendingBefore = Invoke-Api -Path '/api/digitization/pending-review-count' -Token $admin
    Assert-Equal 200 $pendingBefore.Status 'pending review count responds'
    $queue = Invoke-Api -Path '/api/digitization/pending' -Token $admin
    Assert-Equal 200 $queue.Status 'the pending-review queue responds'
    Assert-True ($null -ne $queue.Data.data) 'the queue returns rows'

    $reviewAll = Invoke-Api -Method POST -Path "/api/files/$newFileId/scans/review-all" -Token $admin -Body @{
        decision = 'Approved'; note = ''
    }
    Assert-Equal 200 $reviewAll.Status 'every pending page of a file can be approved at once'
    Assert-Equal 1 $reviewAll.Data.data 'the bulk review reports how many pages moved'
    $reviewAllAgain = Invoke-Api -Method POST -Path "/api/files/$newFileId/scans/review-all" -Token $admin -Body @{
        decision = 'Approved'; note = ''
    }
    Assert-Equal 400 $reviewAllAgain.Status 'a bulk review with nothing pending is refused'

    $supRemoveApproved = Invoke-Api -Method DELETE -Path "/api/scans/$($page2.Data.data.id)" -Token $supervisorToken
    Assert-Equal 400 $supRemoveApproved.Status 'a supervisor cannot remove an approved scan'
    $adminRemoveApproved = Invoke-Api -Method DELETE -Path "/api/scans/$($page2.Data.data.id)" -Token $admin
    Assert-Equal 200 $adminRemoveApproved.Status 'an admin can remove an approved scan'
}

# ============================================================ barcodes
if ($barcodeOn) {
Write-Step 'Barcode payloads and validation'
$payload = Invoke-Api -Path "/api/barcodes/payload/File/$newFileId" -Token $admin
Assert-Equal 200 $payload.Status 'a file payload can be built'
Assert-True ($payload.Data.data.value -like 'RR|FILE|*') 'the payload follows RR|SUBJECT|VALUE'
Assert-True ($payload.Data.data.value -like "*|$newBarcode") 'the payload embeds the file barcode'
# services/impl/barcodes.ts: buildPayload('File', file.fileBarcode, file.fileNumber)
Assert-Equal $createdFile.Data.data.fileNumber $payload.Data.data.label 'the label is the human file number'
Assert-Equal 'File' $payload.Data.data.subject 'the payload names its subject'

$validScan = Invoke-Api -Method POST -Path '/api/barcodes/validate' -Token $admin -Body @{ value = "RR|FILE|$newBarcode" }
Assert-Equal 200 $validScan.Status 'a well-formed payload validates'
Assert-True ($validScan.Data.data.ok) 'validation accepts a good payload'

$badScan = Invoke-Api -Method POST -Path '/api/barcodes/validate' -Token $admin -Body @{ value = 'not-a-payload' }
Assert-True (-not $badScan.Data.data.ok) 'a malformed payload is refused'
Assert-True ($badScan.Data.data.message -match 'Unrecognised') 'the refusal explains the grammar'

$unknownSubject = Invoke-Api -Method POST -Path '/api/barcodes/validate' -Token $admin -Body @{ value = 'RR|WIDGET|X' }
Assert-True (-not $unknownSubject.Data.data.ok) 'an unknown subject code is refused'

$qrUrl = "RR|FILE|$newBarcode"
$qr = Invoke-Api -Path "/api/barcodes/qr?value=$([uri]::EscapeDataString($qrUrl))" -Token $admin
Assert-True ($qr.Data.data -match '/scan\?p=') 'a QR sticker URL is produced'

$job = Invoke-Api -Method POST -Path '/api/barcodes/jobs' -Token $admin -Body @{
    subject = 'File'; targetId = "$newFileId"; quantity = 3
}
Assert-Equal 200 $job.Status 'a print job is queued'
$tooMany = Invoke-Api -Method POST -Path '/api/barcodes/jobs' -Token $admin -Body @{
    subject = 'File'; targetId = "$newFileId"; quantity = 9999
}
Assert-Equal 400 $tooMany.Status 'an absurd print quantity is refused'


} else {
    $hiddenBarcode = Invoke-Api -Path "/api/barcodes/payload/File/$newFileId" -Token $admin
    Assert-Equal 404 $hiddenBarcode.Status 'barcode endpoints are hidden when disabled'
}

# ============================================================ bulk
if ($bulkImportOn) {
Write-Step 'Bulk import classification'
$bulkCsv = @"
barcode,subject,shelf
RF-BULK-$([guid]::NewGuid().ToString('N').Substring(0,8)),Fresh row,$($activeShelf.barcode)
$($first.fileBarcode),Duplicate row,$($activeShelf.barcode)
RF-BULK-UNKNOWN,Bad shelf,RM-NOPE-99
"@
$bulk = Invoke-Api -Method POST -Path '/api/bulk/validate' -Token $admin -Body @{ csv = $bulkCsv; folder = 'bulk/Temp99999/' }
Assert-Equal 200 $bulk.Status 'a CSV batch validates'
Assert-Equal 1 $bulk.Data.data.accepted 'only the free barcode is accepted'
Assert-Equal 2 $bulk.Data.data.rejected 'the duplicate and the bad shelf are rejected'
Assert-Equal 1 $bulk.Data.data.duplicates 'the duplicate is counted'

$badHeader = Invoke-Api -Method POST -Path '/api/bulk/validate' -Token $admin -Body @{
    csv = "a,b,c`n1,2,3"; folder = 'bulk/Temp99999/'
}
Assert-Equal 400 $badHeader.Status 'a CSV without the required headers is refused'

if (-not $SkipDestructive) {
    $commit = Invoke-Api -Method POST -Path "/api/bulk/jobs/$($bulk.Data.data.id)/commit" -Token $admin
    Assert-Equal 200 $commit.Status 'the accepted rows commit'
    $committedBarcode = "RF-BULK-$([guid]::NewGuid().ToString('N').Substring(0,8))"
    $reCommit = Invoke-Api -Method POST -Path "/api/bulk/jobs/$($bulk.Data.data.id)/commit" -Token $admin
    Assert-Equal 400 $reCommit.Status 'a committed job cannot be committed twice'
}


} else {
    $hiddenBulk = Invoke-Api -Path '/api/bulk/jobs' -Token $admin
    Assert-Equal 404 $hiddenBulk.Status 'bulk import endpoints are hidden when disabled'
}

# ============================================================ maps
Write-Step 'Map uploads'
$maps = Invoke-Api -Path '/api/uploads/maps' -Token $admin
Assert-Equal 200 $maps.Status 'GET /api/uploads/maps responds'

if (-not $SkipDestructive) {
    $map = Invoke-Api -Method POST -Path '/api/uploads/maps' -Token $admin -Body @{
        fileBarcode = $newBarcode; pageNo = 5; fileName = "$newBarcode-MAP-5.png"; sizeKb = 1500
    }
    Assert-Equal 200 $map.Status 'a map page is stored'
    Assert-Equal 1 $map.Data.data.version 'the first map page is version 1'
    $map2 = Invoke-Api -Method POST -Path '/api/uploads/maps' -Token $admin -Body @{
        fileBarcode = $newBarcode; pageNo = 5; fileName = "$newBarcode-MAP-5-v2.png"; sizeKb = 1600
    }
    Assert-Equal 2 $map2.Data.data.version 'a re-scan supersedes as the next version'
    $badMap = Invoke-Api -Method POST -Path '/api/uploads/maps' -Token $admin -Body @{
        fileBarcode = 'RF-NOPE'; pageNo = 1; fileName = 'x.png'; sizeKb = 10
    }
    Assert-Equal 400 $badMap.Status 'a map for an unknown barcode is refused'
}

# ============================================================ reports
Write-Step 'Reports'
$defs = Invoke-Api -Path '/api/reports' -Token $admin
Assert-Equal 200 $defs.Status 'GET /api/reports responds'
Assert-True (@($defs.Data.data).Count -ge $(if ($movementOn) { 8 } else { 7 })) 'the report catalogue contains the in-scope reports'

$issueReport = Invoke-Api -Path '/api/reports/issue-register' -Token $admin
Assert-Equal 200 $issueReport.Status 'a report builds'
Assert-Equal $issueReport.Data.data.columns.Count @($issueReport.Data.data.rows[0]).Count 'every row matches the column set'

$overdue = Invoke-Api -Path '/api/reports/overdue-files' -Token $admin
Assert-Equal 200 $overdue.Status 'the overdue report builds'
if (-not $movementOn) {
    $hiddenMovementReport = Invoke-Api -Path '/api/reports/movement-log' -Token $admin
    Assert-Equal 400 $hiddenMovementReport.Status 'the standalone movement report is hidden when disabled'
}

$export = Invoke-Api -Path '/api/reports/file-registry/export' -Token $admin -Raw
Assert-Equal 200 $export.Status 'a report exports as CSV'
Assert-True ($export.Body -match 'Barcode,Number,Subject') 'the CSV has the expected header'

# ============================================================ dashboard
Write-Step 'Dashboard aggregates'
$stats = Invoke-Api -Path '/api/dashboard/stats' -Token $admin
Assert-Equal 200 $stats.Status 'GET /api/dashboard/stats responds'
Assert-Equal 2478450 $stats.Data.data.totalRecords 'the dashboard reports the registry size'
Assert-True ($stats.Data.data.mappedPercent -ge 0 -and $stats.Data.data.mappedPercent -le 100) 'mapped percent is a real percentage'
$activity = Invoke-Api -Path '/api/dashboard/activity?limit=5' -Token $admin
Assert-Equal 200 $activity.Status 'GET /api/dashboard/activity responds'
Assert-True (@($activity.Data.data).Count -gt 0) 'activity is derived from movement events'

# ============================================================ roles
Write-Step 'Role-based access control'
Assert-True ($null -ne $operatorToken) 'the operator account can sign in'
Assert-True ($null -ne $employeeToken) 'the employee account can sign in'

$opUsers = Invoke-Api -Path '/api/users' -Token $operatorToken
Assert-Equal 403 $opUsers.Status 'an operator cannot manage logins'

$empUsers = Invoke-Api -Path '/api/users' -Token $employeeToken
Assert-Equal 403 $empUsers.Status 'an employee cannot manage logins'

$empAudit = Invoke-Api -Path '/api/audit' -Token $employeeToken
Assert-Equal 403 $empAudit.Status 'an employee cannot read the audit trail'

$empFiles = Invoke-Api -Path '/api/files' -Token $employeeToken
Assert-Equal 200 $empFiles.Status 'an employee can still read the registry'

$opMe = Invoke-Api -Path '/api/auth/me' -Token $operatorToken
Assert-True ($opMe.Data.data.permissions -contains 'issue.issue') 'the operator is granted issue.issue'
Assert-True (-not ($opMe.Data.data.permissions -contains 'users.edit')) 'the operator is not granted users.edit'

# ============================================================ file scan versions
Write-Step 'File scan versions (upload + admin delete)'
$scanList = Invoke-Api -Path "/api/files/$newFileId/documents" -Token $admin
Assert-Equal 200 $scanList.Status 'GET /api/files/{id}/documents responds'

if (-not $SkipDestructive) {
    # Invoke-WebRequest on Windows PowerShell 5.1 cannot post a multipart form,
    # so the upload goes through curl.exe. A minimal one-page PDF is enough:
    # this section exercises the version row lifecycle, not pdf parsing.
    $scanPdf = Join-Path $env:TEMP 'rr-smoke-scan.pdf'
    [IO.File]::WriteAllBytes($scanPdf, [Text.Encoding]::ASCII.GetBytes(
        "%PDF-1.4`n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj`n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj`n" +
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj`ntrailer<</Size 4/Root 1 0 R>>`n%%EOF"))
    $raw = curl.exe -s -X POST "$BaseUrl/api/files/$newFileId/documents" `
        -H "Authorization: Bearer $admin" `
        -F "document=@$scanPdf;type=application/pdf"
    $uploaded = $raw | ConvertFrom-Json
    Assert-True ([bool]$uploaded.success) 'a scan version is uploaded'
    $scanId = $uploaded.data.id
    Assert-True ($scanId -gt 0) 'the upload returns the stored version id'

    $documentContent = Invoke-Api -Path "/api/files/$newFileId/documents/$scanId/content" -Token $admin -Raw
    Assert-Equal 200 $documentContent.Status 'an authorized user can open the uploaded document'
    $documentAccess = Invoke-Api -Path "/api/audit?action=Access&entity=RecordFileDocument&search=$scanId" -Token $admin
    Assert-Equal 200 $documentAccess.Status 'file-document access audit can be queried'
    Assert-True (@($documentAccess.Data.data.entries).Count -gt 0) 'opening a file document writes an access audit event'

    $empDelete = Invoke-Api -Method DELETE -Path "/api/files/$newFileId/documents/$scanId" -Token $employeeToken
    Assert-Equal 403 $empDelete.Status 'an employee cannot delete a scan version'
    $opDelete = Invoke-Api -Method DELETE -Path "/api/files/$newFileId/documents/$scanId" -Token $operatorToken
    Assert-Equal 403 $opDelete.Status 'an operator cannot delete a scan version'
    $supDelete = Invoke-Api -Method DELETE -Path "/api/files/$newFileId/documents/$scanId" -Token $supervisorToken
    Assert-Equal 403 $supDelete.Status 'a supervisor cannot delete a scan version'

    $adminDelete = Invoke-Api -Method DELETE -Path "/api/files/$newFileId/documents/$scanId" -Token $admin
    Assert-Equal 200 $adminDelete.Status 'an admin can delete a scan version'
    $gone = Invoke-Api -Method DELETE -Path "/api/files/$newFileId/documents/$scanId" -Token $admin
    Assert-Equal 400 $gone.Status 'deleting an already removed scan version is refused'
}

# ============================================================ inquiry + media
if ($supportOn) {
Write-Step 'Inquiry and media links'
$inq = Invoke-Api -Method POST -Path '/api/inquiries' -Token $employeeToken -Body @{
    name = 'Smoke Tester'; email = 'tester@example.invalid'; department = 'Audit'
    message = 'Automated smoke test inquiry with enough detail.'
}
Assert-Equal 200 $inq.Status 'an inquiry is accepted'
$shortMsg = Invoke-Api -Method POST -Path '/api/inquiries' -Token $employeeToken -Body @{
    name = 'Smoke Tester'; email = 'tester@example.invalid'; department = 'Audit'; message = 'hi'
}
Assert-Equal 400 $shortMsg.Status 'a too-short inquiry is refused'

$media = Invoke-Api -Method POST -Path '/api/media-links' -Token $employeeToken -Body @{
    title = 'Smoke test image'; url = 'https://example.invalid/a.png'; alt = 'A test image'
}
Assert-Equal 200 $media.Status 'an https media link is accepted'
$unsafe = Invoke-Api -Method POST -Path '/api/media-links' -Token $employeeToken -Body @{
    title = 'Unsafe'; url = 'javascript:alert(1)'; alt = 'nope'
}
Assert-Equal 400 $unsafe.Status 'a non-http(s) media URL is refused'


} else {
    $hiddenInquiry = Invoke-Api -Path '/api/inquiries' -Token $employeeToken
    Assert-Equal 404 $hiddenInquiry.Status 'support and inquiry endpoints are hidden when disabled'
}

# ============================================================ custody chain
Write-Step 'Custody chain — intake register and return sign-off'

$empCustodyList = Invoke-Api -Path '/api/custody' -Token $employeeToken
Assert-Equal 200 $empCustodyList.Status 'any authenticated user can read the custody register'

$empCustodyWrite = Invoke-Api -Method POST -Path '/api/custody' -Token $employeeToken -Body @{
    direction = 'Intake'; department = 'Audit'; fileCount = 3
}
Assert-Equal 403 $empCustodyWrite.Status 'an employee cannot record custody'

$opCustodyWrite = Invoke-Api -Method POST -Path '/api/custody' -Token $operatorToken -Body @{
    direction = 'Intake'; department = 'Audit'; fileCount = 3
}
Assert-Equal 403 $opCustodyWrite.Status 'an operator cannot record custody'

$badCustody = Invoke-Api -Method POST -Path '/api/custody' -Token $admin -Body @{
    direction = 'Intake'; department = ''; fileCount = 0
}
Assert-Equal 400 $badCustody.Status 'an intake without a department or count is refused'

$intake = Invoke-Api -Method POST -Path '/api/custody' -Token $admin -Body @{
    direction = 'Intake'; department = 'Audit'; fileCount = 5
    batchRef = 'DIG-SMOKE'; vendor = 'ScanServe'; remarks = 'Smoke-test intake.'
}
Assert-Equal 200 $intake.Status 'an intake is recorded'
$custodyId = $intake.Data.data.id
Assert-Equal 'Intake' $intake.Data.data.direction 'the intake keeps the contract direction word'
Assert-Equal 'Farida Begum' $intake.Data.data.recordedBy 'the intake names the recorder by display name'

$reconcile = Invoke-Api -Method POST -Path "/api/custody/$custodyId/reconcile" -Token $admin -Body @{
    reconciledCount = 4; remarks = 'One file short at counting.'
}
Assert-Equal 200 $reconcile.Status 'the intake is reconciled'
Assert-Equal 4 $reconcile.Data.data.reconciledCount 'the counted total is stored'

$return = Invoke-Api -Method POST -Path '/api/custody' -Token $admin -Body @{
    direction = 'Return'; department = 'Audit'; fileCount = 4; batchRef = 'DIG-SMOKE'
}
Assert-Equal 200 $return.Status 'a return is recorded'
$returnId = $return.Data.data.id

$returnCount = Invoke-Api -Method POST -Path "/api/custody/$returnId/reconcile" -Token $admin -Body @{
    reconciledCount = 4
}
Assert-Equal 400 $returnCount.Status 'a return cannot be reconciled'

$signOff = Invoke-Api -Method POST -Path "/api/custody/$returnId/sign-off" -Token $admin -Body @{
    signedOffBy = 'Audit Officer'
}
Assert-Equal 200 $signOff.Status 'the return is signed off'
Assert-Equal 'Audit Officer' $signOff.Data.data.signedOffBy 'the sign-off names the signer'
Assert-True ($null -ne $signOff.Data.data.signedOffAt) 'the sign-off stamps a time'

$reSign = Invoke-Api -Method POST -Path "/api/custody/$returnId/sign-off" -Token $admin -Body @{ }
Assert-Equal 400 $reSign.Status 'a signed-off event cannot be signed off twice'

$earlyIntakeSign = Invoke-Api -Method POST -Path "/api/custody/$custodyId/sign-off" -Token $admin -Body @{ }
Assert-Equal 400 $earlyIntakeSign.Status 'an intake cannot be signed off before reconciliation'

$intakeSign = Invoke-Api -Method POST -Path "/api/custody/$custodyId/sign-off" -Token $admin -Body @{ }
Assert-Equal 200 $intakeSign.Status 'a reconciled intake can be signed off'
Assert-Equal 'Farida Begum' $intakeSign.Data.data.signedOffBy 'a blank sign-off defaults to the current user'

$reCount = Invoke-Api -Method POST -Path "/api/custody/$custodyId/reconcile" -Token $admin -Body @{
    reconciledCount = 5
}
Assert-Equal 400 $reCount.Status 'a signed-off event can no longer be changed'

$filtered = Invoke-Api -Path '/api/custody?direction=Intake&search=SMOKE' -Token $admin
Assert-Equal 200 $filtered.Status 'the register filters by direction and text'
Assert-True ($filtered.Data.data.items.Count -ge 1) 'the smoke-test intake appears in the filtered register'

# ============================================================ summary
Write-Host "`n================================" -ForegroundColor Cyan
Write-Host "  passed: $script:Passed   failed: $script:Failed" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
if ($script:Failed -gt 0) {
    Write-Host "`nFailures:" -ForegroundColor Red
    foreach ($failure in $script:FailList) { Write-Host "  - $failure" -ForegroundColor Red }
    exit 1
}
exit 0
