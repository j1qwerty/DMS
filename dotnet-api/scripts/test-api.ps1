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
Assert-True ($null -ne $config.Data.ocr) 'config reports the OCR engine status'
Assert-True ($config.Data.ocr.enabled -is [bool]) 'config reports OCR enabled as a boolean'
$barcodeOn = [bool]$config.Data.features.barcode
Write-Host "  (barcode features are $(if ($barcodeOn) { 'ON' } else { 'OFF' }); set Features__BarcodeEnabled to test the other state)"

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

# ============================================================ feature groups
Write-Step 'Feature switch groups (ZILA_PANCHAYAT_CC §F)'
$configAll = Invoke-Api -Path '/api/config'
Assert-True ($configAll.Data.features.barcode -is [bool]) 'config reports the barcode group'
Assert-True ($configAll.Data.features.recordRoom -is [bool]) 'config reports the record room group'
Assert-True ($configAll.Data.features.maps -is [bool]) 'config reports the maps group'
Assert-True ($configAll.Data.features.support -is [bool]) 'config reports the support group'
$initialGroups = @{
    barcode      = [bool]$configAll.Data.features.barcode
    recordRoom   = [bool]$configAll.Data.features.recordRoom
    maps         = [bool]$configAll.Data.features.maps
    support      = [bool]$configAll.Data.features.support
}
Write-Host "  (seeded state: barcode=$($initialGroups.barcode) recordRoom=$($initialGroups.recordRoom) maps=$($initialGroups.maps) support=$($initialGroups.support))"

$empFlip = Invoke-Api -Method PUT -Path '/api/config/features' -Token $employeeToken -Body @{
    features = @{ barcode = $true }
}
Assert-Equal 403 $empFlip.Status 'a non-admin cannot change feature visibility'
$badKey = Invoke-Api -Method PUT -Path '/api/config/features' -Token $admin -Body @{
    features = @{ teleport = $true }
}
Assert-Equal 400 $badKey.Status 'an unknown feature group is refused'

# The rest of the suite exercises every hidden group, so they come on now and
# the initial state is restored before the summary.
$flipOn = Invoke-Api -Method PUT -Path '/api/config/features' -Token $admin -Body @{
    features = @{ barcode = $true; recordRoom = $true; maps = $true; support = $true }
}
Assert-Equal 200 $flipOn.Status 'an admin can turn feature groups on'
$afterOn = Invoke-Api -Path '/api/config'
Assert-True ([bool]$afterOn.Data.features.recordRoom) 'GET /api/config reflects the live switch state'

# ============================================================ OCR engine
Write-Step 'OCR engine settings'
$initialEngine = $afterOn.Data.ocr.engine
$alternative = if ($initialEngine -eq 'paddleocr') { 'tesseract' } else { 'paddleocr' }
$employeeEngine = Invoke-Api -Method PUT -Path '/api/config/ocr-engine' -Token $employeeToken -Body @{
    engine = $alternative
}
Assert-Equal 403 $employeeEngine.Status 'only admins can change the OCR engine'
$supervisorEngine = Invoke-Api -Method PUT -Path '/api/config/ocr-engine' -Token $supervisorToken -Body @{
    engine = $alternative
}
Assert-Equal 403 $supervisorEngine.Status 'a supervisor cannot change the OCR engine'
$invalidEngine = Invoke-Api -Method PUT -Path '/api/config/ocr-engine' -Token $admin -Body @{
    engine = 'unsupported'
}
Assert-Equal 400 $invalidEngine.Status 'unknown OCR engines are rejected'
try {
    $switchEngine = Invoke-Api -Method PUT -Path '/api/config/ocr-engine' -Token $admin -Body @{
        engine = $alternative
    }
    Assert-Equal 200 $switchEngine.Status 'an admin can switch OCR engines'
    $liveEngine = Invoke-Api -Path '/api/config'
    Assert-Equal $alternative $liveEngine.Data.ocr.engine 'config returns the selected engine'
} finally {
    $restoreEngine = Invoke-Api -Method PUT -Path '/api/config/ocr-engine' -Token $admin -Body @{
        engine = $initialEngine
    }
    Assert-Equal 200 $restoreEngine.Status 'the initial OCR engine is restored'
}

# ============================================================ permissions matrix
Write-Step 'Editable permission matrix (§3.7)'
$empMatrix = Invoke-Api -Path '/api/permissions/matrix' -Token $employeeToken
Assert-Equal 403 $empMatrix.Status 'an employee cannot read the permission matrix'
$matrix = Invoke-Api -Path '/api/permissions/matrix' -Token $admin
Assert-Equal 200 $matrix.Status 'GET /api/permissions/matrix responds for users.view holders'
Assert-Equal 4 $matrix.Data.data.roles.Count 'the matrix covers all four roles'
Assert-True ($matrix.Data.data.permissions.Count -ge 19) 'the permission catalogue is complete'

# Enforcement is real: audit.view is not granted to Operator in the v1 lists.
$opAuditBefore = Invoke-Api -Path '/api/audit' -Token $operatorToken
$grant = Invoke-Api -Method PUT -Path '/api/permissions/Operator/audit.view' -Token $admin -Body @{ granted = $true }
Assert-Equal 200 $grant.Status 'an admin can grant audit.view to Operator'
$opAuditDuring = Invoke-Api -Path '/api/audit' -Token $operatorToken
Assert-Equal 200 $opAuditDuring.Status 'the granted permission is enforced on the very next request'
$revoke = Invoke-Api -Method PUT -Path '/api/permissions/Operator/audit.view' -Token $admin -Body @{ granted = $false }
Assert-Equal 200 $revoke.Status 'an admin can revoke the grant again'
$opAuditAfter = Invoke-Api -Path '/api/audit' -Token $operatorToken
Assert-Equal 403 $opAuditAfter.Status 'the revoked permission is refused on the very next request'

$fixedAdmin = Invoke-Api -Method PUT -Path '/api/permissions/Admin/files.view' -Token $admin -Body @{ granted = $false }
Assert-Equal 400 $fixedAdmin.Status 'the Admin row is fixed and cannot be edited'
$unknownPerm = Invoke-Api -Method PUT -Path '/api/permissions/Operator/teleport.files' -Token $admin -Body @{ granted = $true }
Assert-Equal 400 $unknownPerm.Status 'an unknown permission is refused'
$unknownRole = Invoke-Api -Method PUT -Path '/api/permissions/Wizard/files.view' -Token $admin -Body @{ granted = $true }
Assert-Equal 400 $unknownRole.Status 'an unknown role is refused'

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
Assert-Equal 200 $byBarcode.Status 'a file resolves by barcode'
Assert-Equal $first.id $byBarcode.Data.data.id 'barcode lookup returns the same row'

# The gate itself. The feature-switch step above turns every group on so the
# rest of the run can exercise the hidden surfaces, so it is checked by
# flipping barcode off here instead of trusting the seeded state.
$barcodeOff = Invoke-Api -Method PUT -Path '/api/config/features' -Token $admin -Body @{
    features = @{ barcode = $false }
}
Assert-Equal 200 $barcodeOff.Status 'barcode can be switched off at runtime'
$blockedLookup = Invoke-Api -Path "/api/files/by-barcode/$($first.fileBarcode)" -Token $admin
Assert-Equal 404 $blockedLookup.Status 'barcode lookup is blocked while barcode features are off'
$blockedApi = Invoke-Api -Path '/api/barcodes/jobs' -Token $admin
Assert-Equal 404 $blockedApi.Status 'the barcode endpoints are blocked while barcode features are off'
$barcodeBack = Invoke-Api -Method PUT -Path '/api/config/features' -Token $admin -Body @{
    features = @{ barcode = $true }
}
Assert-Equal 200 $barcodeBack.Status 'barcode is switched back on for the rest of the run'

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
$movements = Invoke-Api -Path "/api/movements?fileId=$newFileId" -Token $admin
Assert-Equal 200 $movements.Status 'GET /api/movements responds'
Assert-True (@($movements.Data.data).Count -ge 2) 'create + relocate events were recorded'

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

    # studio.use is granted to every role by default and an admin can revoke it
    # per role, so the gate is the matrix cell, not a hard-coded role.
    $revokeStudioAdd = Invoke-Api -Method PUT -Path '/api/permissions/Employee/studio.use' -Token $admin -Body @{ granted = $false }
    Assert-Equal 200 $revokeStudioAdd.Status 'studio.use is revoked from Employee for the gate check'
    $empAdd = Invoke-Api -Method POST -Path "/api/files/$newFileId/scans" -Token $employeeToken -Body @{
        fileName = ''; pageNo = 2; documentSize = 'A4'
    }
    Assert-Equal 403 $empAdd.Status 'an employee without studio.use cannot register scan pages'
    $restoreStudioAdd = Invoke-Api -Method PUT -Path '/api/permissions/Employee/studio.use' -Token $admin -Body @{ granted = $true }
    Assert-Equal 200 $restoreStudioAdd.Status 'studio.use is restored to Employee'
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

# ============================================================ bulk
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
Assert-True (@($defs.Data.data).Count -ge 8) 'the report catalogue is populated'

$issueReport = Invoke-Api -Path '/api/reports/issue-register' -Token $admin
Assert-Equal 200 $issueReport.Status 'a report builds'
Assert-Equal $issueReport.Data.data.columns.Count @($issueReport.Data.data.rows[0]).Count 'every row matches the column set'

$overdue = Invoke-Api -Path '/api/reports/overdue-files' -Token $admin
Assert-Equal 200 $overdue.Status 'the overdue report builds'

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
    $ocrPath = "/api/files/$newFileId/documents/$scanId/ocr"
    $pageCorrection = Invoke-Api -Method PUT -Path "$ocrPath/1" -Token $admin -Body @{ text = 'Saved OCR smoke text' }
    Assert-Equal 200 $pageCorrection.Status 'OCR corrections are saved against a stored version'
    $ocrMap = Invoke-Api -Path $ocrPath -Token $admin
    Assert-Equal 'Saved OCR smoke text' $ocrMap.Data.data.'1' 'the saved version OCR is returned'

    $empDelete = Invoke-Api -Method DELETE -Path "/api/files/$newFileId/documents/$scanId" -Token $employeeToken
    Assert-Equal 403 $empDelete.Status 'an employee cannot delete a scan version'
    $opDelete = Invoke-Api -Method DELETE -Path "/api/files/$newFileId/documents/$scanId" -Token $operatorToken
    Assert-Equal 403 $opDelete.Status 'an operator cannot delete a scan version'

    # files.edit is the gate, and Supervisor holds it, so a supervisor can remove
    # a stored version. The second delete is the guard that keeps it honest.
    $supDelete = Invoke-Api -Method DELETE -Path "/api/files/$newFileId/documents/$scanId" -Token $supervisorToken
    Assert-Equal 200 $supDelete.Status 'a supervisor can delete a scan version (files.edit)'
    $gone = Invoke-Api -Method DELETE -Path "/api/files/$newFileId/documents/$scanId" -Token $admin
    Assert-Equal 400 $gone.Status 'deleting an already removed scan version is refused'
}

# ============================================================ inquiry + media
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

# ============================================================ departments
Write-Step 'Managed departments (round 3)'
$departments = Invoke-Api -Path '/api/departments' -Token $admin
Assert-Equal 200 $departments.Status 'GET /api/departments responds'
Assert-True ($departments.Data.data.Count -ge 8) 'the seeded department list is present'
Assert-True (@($departments.Data.data | Where-Object { $_.name -eq 'Revenue' }).Count -eq 1) 'Revenue is in the list with its code'

$empDepartments = Invoke-Api -Path '/api/departments' -Token $employeeToken
Assert-Equal 200 $empDepartments.Status 'any authenticated user can read the department list'
$opCreateDept = Invoke-Api -Method POST -Path '/api/departments' -Token $operatorToken -Body @{
    name = 'Zonal Audit'; code = 'ZA'
}
Assert-Equal 403 $opCreateDept.Status 'an operator cannot add departments'

$newDept = Invoke-Api -Method POST -Path '/api/departments' -Token $admin -Body @{
    name = 'Smoke Department'; code = 'SMK'; remarks = 'harness row'
}
Assert-Equal 200 $newDept.Status 'an admin adds a department'
$dupDept = Invoke-Api -Method POST -Path '/api/departments' -Token $admin -Body @{
    name = 'Smoke Department'; code = 'OTHER'
}
Assert-Equal 400 $dupDept.Status 'a duplicate department name is refused'
$dupCode = Invoke-Api -Method POST -Path '/api/departments' -Token $admin -Body @{
    name = 'Another Name'; code = 'SMK'
}
Assert-Equal 400 $dupCode.Status 'a duplicate department code is refused'

$renamedDept = Invoke-Api -Method PUT -Path "/api/departments/$($newDept.Data.data.id)" -Token $admin -Body @{
    name = 'Smoke Department Renamed'; code = 'SMK'
}
Assert-Equal 200 $renamedDept.Status 'an admin renames the department'
Assert-Equal 'Smoke Department Renamed' $renamedDept.Data.data.name 'the rename round-trips'

# Deleting a department employees still use is refused; the smoke row is unused.
$inUse = ($departments.Data.data | Where-Object { $_.employeeCount -gt 0 } | Select-Object -First 1)
if ($inUse) {
    $refusedDelete = Invoke-Api -Method DELETE -Path "/api/departments/$($inUse.id)" -Token $admin
    Assert-Equal 400 $refusedDelete.Status 'a department with employees cannot be deleted'
}
$deletedDept = Invoke-Api -Method DELETE -Path "/api/departments/$($newDept.Data.data.id)" -Token $admin
Assert-Equal 200 $deletedDept.Status 'an unused department can be deleted'

# ============================================================ custody returns
Write-Step 'Custody returns against an intake batch (round 3)'
$returnIntake = Invoke-Api -Method POST -Path '/api/custody' -Token $admin -Body @{
    direction = 'Intake'; department = 'Revenue'; fileCount = 10
    batchRef = 'SMOKE-RETURNS'; vendor = 'ScanServe'
}
Assert-Equal 200 $returnIntake.Status 'a 10-file intake is recorded'
$returnIntakeId = $returnIntake.Data.data.id

$partial = Invoke-Api -Method POST -Path "/api/custody/$returnIntakeId/return" -Token $admin -Body @{
    fileCount = 6; remarks = 'first half back'
}
Assert-Equal 200 $partial.Status 'a partial return of 6 of 10 is recorded'
Assert-Equal 'Return' $partial.Data.data.direction 'the return row carries the Return direction'
Assert-True ($null -ne $partial.Data.data.sourceCustodyId) 'the return is linked to its intake'

$over = Invoke-Api -Method POST -Path "/api/custody/$returnIntakeId/return" -Token $admin -Body @{
    fileCount = 5
}
Assert-Equal 400 $over.Status 'returning more than the remaining 4 is refused'

$rest = Invoke-Api -Method POST -Path "/api/custody/$returnIntakeId/return" -Token $admin -Body @{
    fileCount = 4; remarks = 'rest back'
}
Assert-Equal 200 $rest.Status 'the remaining 4 are returned'

$none = Invoke-Api -Method POST -Path "/api/custody/$returnIntakeId/return" -Token $admin -Body @{
    fileCount = 1
}
Assert-Equal 400 $none.Status 'a fully returned batch refuses another return'

$afterReturns = Invoke-Api -Path "/api/custody?search=SMOKE-RETURNS" -Token $admin
$intakeRow = @($afterReturns.Data.data.items | Where-Object { $_.id -eq $returnIntakeId })[0]
Assert-Equal 10 $intakeRow.returnedCount 'the intake row reports 10 of 10 returned'
$returnsList = Invoke-Api -Path "/api/custody/$returnIntakeId/returns" -Token $admin
Assert-Equal 2 @($returnsList.Data.data).Count 'the batch lists its two return rows'

# ============================================================ file views
Write-Step 'File-view tracking (round 3)'
$viewFile = Invoke-Api -Path "/api/files/$newFileId" -Token $admin
Assert-Equal 200 $viewFile.Status 'opening the file detail responds'
$viewFile2 = Invoke-Api -Path "/api/files/$newFileId" -Token $supervisorToken
Assert-Equal 200 $viewFile2.Status 'a second viewer opens the same file'

$empViews = Invoke-Api -Path '/api/audit/file-views' -Token $employeeToken
Assert-Equal 403 $empViews.Status 'an employee cannot read the file-view trail'
$views = Invoke-Api -Path '/api/audit/file-views' -Token $admin
Assert-Equal 200 $views.Status 'the admin reads the file-view trail'
$viewRows = @($views.Data.data.entries | Where-Object { $_.entityId -eq "$newFileId" })
Assert-True ($viewRows.Count -ge 2) 'both opens of the file are on the trail'

# The permission is a matrix cell: grant it to Supervisor and it works at once.
$grantViews = Invoke-Api -Method PUT -Path '/api/permissions/Supervisor/audit.fileViews' -Token $admin -Body @{ granted = $true }
Assert-Equal 200 $grantViews.Status 'audit.fileViews is granted to Supervisor'
$supViews = Invoke-Api -Path '/api/audit/file-views' -Token $supervisorToken
Assert-Equal 200 $supViews.Status 'the supervisor can now read the file-view trail'
$revokeViews = Invoke-Api -Method PUT -Path '/api/permissions/Supervisor/audit.fileViews' -Token $admin -Body @{ granted = $false }
Assert-Equal 200 $revokeViews.Status 'the grant is revoked again'
$supViewsAfter = Invoke-Api -Path '/api/audit/file-views' -Token $supervisorToken
Assert-Equal 403 $supViewsAfter.Status 'the revoked grant is refused on the next request'

# ============================================================ audit groups
Write-Step 'Audit trail groups (round 3)'
$groupDocuments = Invoke-Api -Path '/api/audit?group=documents' -Token $admin
Assert-Equal 200 $groupDocuments.Status 'the documents group responds'
$documentEntities = @($groupDocuments.Data.data.entries | Select-Object -ExpandProperty entity -Unique)
Assert-True ($documentEntities.Count -ge 1) 'the documents group has entries'
foreach ($entity in $documentEntities) {
    Assert-True (@('RecordFile','MapUpload','BulkImportJob','BarcodeJob','Department') -contains $entity) "documents group carries only registry entities ($entity)"
}
$groupDigitization = Invoke-Api -Path '/api/audit?group=digitization' -Token $admin
Assert-Equal 200 $groupDigitization.Status 'the digitization group responds'
$digitizationEntities = @($groupDigitization.Data.data.entries | Select-Object -ExpandProperty entity -Unique)
foreach ($entity in $digitizationEntities) {
    Assert-True (@('FileScanPage','CustodyEvent','DocumentDerivative') -contains $entity) "digitization group carries only scan-pipeline entities ($entity)"
}
$groupLogins = Invoke-Api -Path '/api/audit?group=logins-issues' -Token $admin
Assert-Equal 200 $groupLogins.Status 'the logins-issues group responds'

# ============================================================ studio permission
Write-Step 'Scan studio permission (studio.use)'
# The studio permission is granted to every role by default; an employee — who
# never had digitization.upload — can now prepare pages.
$empPage = Invoke-Api -Method POST -Path "/api/files/$newFileId/scans" -Token $employeeToken -Body @{
    fileName = 'employee-studio-page.png'; pageNo = 81; documentSize = 'A4'
}
Assert-Equal 200 $empPage.Status 'an employee can add a studio page'
$empReorder = Invoke-Api -Method PUT -Path "/api/files/$newFileId/scans/order" -Token $employeeToken -Body @{
    scanIds = @($empPage.Data.data.id)
}
Assert-Equal 200 $empReorder.Status 'an employee can save the studio order'

# Revoke studio.use from Employee and the next request is refused.
$revokeStudio = Invoke-Api -Method PUT -Path '/api/permissions/Employee/studio.use' -Token $admin -Body @{ granted = $false }
Assert-Equal 200 $revokeStudio.Status 'studio.use is revoked from Employee'
$empPageAfter = Invoke-Api -Method POST -Path "/api/files/$newFileId/scans" -Token $employeeToken -Body @{
    fileName = 'employee-studio-page-2.png'; pageNo = 82; documentSize = 'A4'
}
Assert-Equal 403 $empPageAfter.Status 'the revoked studio permission is enforced at once'
$restoreStudio = Invoke-Api -Method PUT -Path '/api/permissions/Employee/studio.use' -Token $admin -Body @{ granted = $true }
Assert-Equal 200 $restoreStudio.Status 'studio.use is restored to Employee'

# ============================================================ full-text search
Write-Step 'Registry search + OCR text (§3.1)'
# The seeded first under-digitization file carries OCR text containing
# "record programme" — a token none of its own metadata fields hold.
$ocrSearch = Invoke-Api -Path '/api/files?search=programme' -Token $admin
Assert-Equal 200 $ocrSearch.Status 'the registry search responds'
$ocrHits = @($ocrSearch.Data.data.items | Where-Object { $_.matchedVia -eq 'ocr' })
Assert-True ($ocrHits.Count -ge 1) 'a file whose OCR text alone matches is returned and flagged matchedVia=ocr'
$plainSearch = Invoke-Api -Path '/api/files?search=Revenue' -Token $admin
Assert-Equal 200 $plainSearch.Status 'a metadata search still works alongside the OCR path'

# ============================================================ scan studio
Write-Step 'Scan studio + deliverable PDF (§3.4/§3.5)'
$studioPage = Invoke-Api -Method POST -Path "/api/files/$newFileId/scans" -Token $admin -Body @{
    fileName = 'studio-page.png'; pageNo = 71; documentSize = 'A4'
}
Assert-Equal 200 $studioPage.Status 'a scan page row is created for the studio'
$studioScanId = $studioPage.Data.data.id

# Invoke-WebRequest on Windows PowerShell 5.1 cannot post a multipart form, so
# the upload goes through curl.exe. A real 1x1 PNG decodes for every enhancer op.
$studioPng = Join-Path $env:TEMP 'rr-smoke-studio.png'
[IO.File]::WriteAllBytes($studioPng, [Convert]::FromBase64String(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='))
$rawScan = curl.exe -s -X POST "$BaseUrl/api/scans/$studioScanId/document" `
    -H "Authorization: Bearer $admin" `
    -F "document=@$studioPng;type=image/png"
$scanUpload = $rawScan | ConvertFrom-Json
Assert-True ([bool]$scanUpload.success) 'the studio page image is attached'

$order = Invoke-Api -Method PUT -Path "/api/files/$newFileId/scans/order" -Token $admin -Body @{
    scanIds = @($studioScanId)
}
Assert-Equal 200 $order.Status 'the composition order is saved'
$foreignOrder = Invoke-Api -Method PUT -Path "/api/files/$newFileId/scans/order" -Token $admin -Body @{
    scanIds = @(999999)
}
Assert-Equal 400 $foreignOrder.Status 'a scan id from another file is refused in the order'

$rotate = Invoke-Api -Method POST -Path "/api/scans/$studioScanId/rotate" -Token $admin -Body @{ degrees = 90 }
Assert-Equal 200 $rotate.Status 'the page is rotated (processed copy, original kept)'
Assert-True ($rotate.Data.data.enhancement -like 'rotated*') 'the rotation is labelled on the page'
$badRotate = Invoke-Api -Method POST -Path "/api/scans/$studioScanId/rotate" -Token $admin -Body @{ degrees = 45 }
Assert-Equal 400 $badRotate.Status 'only quarter-turn rotations are accepted'
$deskew = Invoke-Api -Method POST -Path "/api/scans/$studioScanId/enhance" -Token $admin -Body @{ operation = 'deskew' }
Assert-Equal 200 $deskew.Status 'the deskew operation runs'
$processed = curl.exe -s -o - -w "`n%{http_code}" "$BaseUrl/api/scans/$studioScanId/content?variant=processed" -H "Authorization: Bearer $admin"
Assert-True ($processed -match '^200$' -or $processed -match "`n200$") 'the processed variant is served'
$revert = Invoke-Api -Method DELETE -Path "/api/scans/$studioScanId/enhancement" -Token $admin
Assert-Equal 200 $revert.Status 'the page reverts to its original scan'

$ocrRun = Invoke-Api -Method POST -Path "/api/scans/$studioScanId/ocr" -Token $admin
Assert-Equal 200 $ocrRun.Status 're-running OCR on a scan page responds'

$approvePage = Invoke-Api -Method POST -Path "/api/scans/$studioScanId/review" -Token $admin -Body @{
    decision = 'Approved'; note = 'Studio smoke test page'
}
Assert-Equal 200 $approvePage.Status 'the studio page is approved'

$noPdf = Invoke-Api -Method POST -Path "/api/files/999999/pdf" -Token $admin -Body @{ }
Assert-Equal 400 $noPdf.Status 'building a deliverable for an unknown file is refused'
$pdf = Invoke-Api -Method POST -Path "/api/files/$newFileId/pdf" -Token $admin -Body @{ }
Assert-Equal 200 $pdf.Status 'the deliverable PDF is built from the approved pages'
Assert-True ($pdf.Data.data.pageCount -ge 1) 'the deliverable reports its page count'
$pdfList = Invoke-Api -Path "/api/files/$newFileId/pdf" -Token $admin
Assert-True (@($pdfList.Data.data).Count -ge 1) 'the deliverable is listed on the file'
$pdfId = $pdf.Data.data.id
$pdfBytes = curl.exe -s "$BaseUrl/api/files/$newFileId/pdf/$pdfId/content" -H "Authorization: Bearer $admin"
Assert-True ($pdfBytes -like '*%PDF*') 'the deliverable downloads as real PDF bytes'

# ====================================================== deliverable review (round 4)
Write-Step 'Deliverable PDF review (round 4)'
Assert-Equal 'Pending approval' $pdf.Data.data.status 'a fresh build awaits reviewer approval'
Assert-True (-not $pdf.Data.data.reviewedBy) 'an unreviewed build has no reviewer yet'

$empReview = Invoke-Api -Method POST -Path "/api/files/$newFileId/pdf/$pdfId/review" -Token $employeeToken -Body @{
    decision = 'Approved'
}
Assert-Equal 403 $empReview.Status 'an employee cannot review a deliverable'

$badDecision = Invoke-Api -Method POST -Path "/api/files/$newFileId/pdf/$pdfId/review" -Token $admin -Body @{
    decision = 'Maybe'
}
Assert-Equal 400 $badDecision.Status 'an unknown review decision is refused'

$rejectNoReason = Invoke-Api -Method POST -Path "/api/files/$newFileId/pdf/$pdfId/review" -Token $admin -Body @{
    decision = 'Rejected'
}
Assert-Equal 400 $rejectNoReason.Status 'a rejection without a reason is refused'

$reject = Invoke-Api -Method POST -Path "/api/files/$newFileId/pdf/$pdfId/review" -Token $admin -Body @{
    decision = 'Rejected'; note = 'Smoke test: page order needs a fix'
}
Assert-Equal 200 $reject.Status 'a reviewer can reject a build with a reason'
Assert-Equal 'Rejected' $reject.Data.data.status 'the rejected build carries its status'
Assert-True ([bool]$reject.Data.data.reviewedBy) 'the rejection records the reviewer'
Assert-Equal 'Smoke test: page order needs a fix' $reject.Data.data.reviewNote 'the rejection keeps the reason'

$reReview = Invoke-Api -Method POST -Path "/api/files/$newFileId/pdf/$pdfId/review" -Token $admin -Body @{
    decision = 'Approved'
}
Assert-Equal 400 $reReview.Status 'an already reviewed build cannot be reviewed again'

$rebuild = Invoke-Api -Method POST -Path "/api/files/$newFileId/pdf" -Token $admin -Body @{ }
Assert-Equal 200 $rebuild.Status 'the deliverable can be rebuilt after a rejection'
$approve = Invoke-Api -Method POST -Path "/api/files/$newFileId/pdf/$($rebuild.Data.data.id)/review" -Token $admin -Body @{
    decision = 'Approved'
}
Assert-Equal 200 $approve.Status 'the fixed build is approved'
Assert-Equal 'Approved' $approve.Data.data.status 'the approved build is the deliverable'

$history = Invoke-Api -Path "/api/files/$newFileId/pdf" -Token $admin
Assert-True (@($history.Data.data).Count -ge 2) 'every build stays in the history'
Assert-Equal 'Approved' @($history.Data.data)[0].status 'the history lists the newest build first'
$foreignReview = Invoke-Api -Method POST -Path "/api/files/999999/pdf/$pdfId/review" -Token $admin -Body @{
    decision = 'Approved'
}
Assert-Equal 404 $foreignReview.Status 'a derivative from another file is not reviewable here'

# ====================================================== split audit groups (round 4)
Write-Step 'Split audit groups (round 4)'
$logins = Invoke-Api -Path '/api/audit?group=logins&limit=50' -Token $admin
Assert-Equal 200 $logins.Status 'the logins group is readable'
Assert-True (@($logins.Data.data).Count -ge 1) 'the logins group has entries'
$loginsEntities = @($logins.Data.data.entries | ForEach-Object { $_.entity } | Sort-Object -Unique)
Assert-True ($loginsEntities.Count -eq 1 -and $loginsEntities[0] -eq 'Session') 'the logins group carries session entities only'

$issues = Invoke-Api -Path '/api/audit?group=issues&limit=200' -Token $admin
Assert-Equal 200 $issues.Status 'the issues group is readable'
Assert-True (@($issues.Data.data).Count -ge 1) 'the issues group has entries'
$issuesEntities = @($issues.Data.data | ForEach-Object { $_.entity } | Sort-Object -Unique)
Assert-True (($issuesEntities | Where-Object { $_ -notin @('IssueRecord', 'MovementEvent') }).Count -eq 0) 'the issues group carries the issue / movement trail only'

# ============================================================ restore switches
Write-Step 'Feature groups restored to the seeded profile'
$restore = Invoke-Api -Method PUT -Path '/api/config/features' -Token $admin -Body @{
    features = $initialGroups
}
Assert-Equal 200 $restore.Status 'the seeded feature state is restored after the run'

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
