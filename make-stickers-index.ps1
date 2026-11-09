# สร้างรายการสติ๊กเกอร์: อ่านโฟลเดอร์ stickers แล้วเขียนไฟล์ stickers\index.json
$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot 'stickers'
if (-not (Test-Path $root)) { Write-Host "ไม่พบโฟลเดอร์ stickers (ต้องวางไฟล์นี้ไว้ข้างๆ โฟลเดอร์ stickers)"; exit 1 }

$extPattern = '\.(png|webp|gif|jpe?g|svg)$'
$namePattern = '^[A-Za-z0-9_-]{1,60}\.(png|webp|gif|jpe?g|svg)$'
$packs = @()

foreach ($dir in (Get-ChildItem -Path $root -Directory)) {
  if ($dir.Name -notmatch '^[A-Za-z0-9_-]{1,30}$') {
    Write-Host ("ข้ามโฟลเดอร์ '" + $dir.Name + "' (ชื่อโฟลเดอร์ใช้ได้เฉพาะ A-Z a-z 0-9 _ -)")
    continue
  }
  $files = @()
  foreach ($f in (Get-ChildItem -Path $dir.FullName -File | Sort-Object Name)) {
    if ($f.Name -match $namePattern) { $files += $f.Name }
    elseif ($f.Name -match $extPattern) {
      Write-Host ("ข้ามไฟล์ '" + $dir.Name + "\" + $f.Name + "' (ชื่อไฟล์ใช้ได้เฉพาะ A-Z a-z 0-9 _ -)")
    }
  }
  if ($files.Count -eq 0) { continue }

  $title = $dir.Name
  $nameFile = Join-Path $dir.FullName 'name.txt'
  if (Test-Path $nameFile) {
    $t = (Get-Content -Path $nameFile -Raw -Encoding UTF8).Trim()
    if ($t) { $title = $t }
  }
  $order = 1000
  $orderFile = Join-Path $dir.FullName 'order.txt'
  if (Test-Path $orderFile) {
    $o = 0
    if ([int]::TryParse((Get-Content -Path $orderFile -Raw).Trim(), [ref]$o)) { $order = $o }
  }
  $packs += [pscustomobject]@{ id = $dir.Name; name = $title; order = $order; files = $files }
}

$sorted = @($packs | Sort-Object order, id)
$list = @()
foreach ($p in $sorted) {
  $list += [pscustomobject]@{ id = $p.id; name = $p.name; files = @($p.files) }
}

if ($list.Count -eq 0) {
  $json = '{"packs":[]}'
} else {
  $json = (@{ packs = $list } | ConvertTo-Json -Depth 5)
}
[System.IO.File]::WriteAllText((Join-Path $root 'index.json'), $json, (New-Object System.Text.UTF8Encoding($false)))

$total = 0
foreach ($p in $list) { $total += $p.files.Count }
Write-Host ""
Write-Host ("สร้าง stickers\index.json เรียบร้อย: " + $list.Count + " ชุด, " + $total + " สติ๊กเกอร์")
