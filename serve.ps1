# Tiny static file server for local dev — used by .claude/launch.json
# Serves the public/ folder on http://localhost:<port>/
param([int]$Port=8765)

$root = Resolve-Path (Join-Path $PSScriptRoot 'public')
$listener = [System.Net.HttpListener]::new()
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "Serving $root at $prefix"

$mime = @{
  '.html'='text/html; charset=utf-8'; '.htm'='text/html; charset=utf-8';
  '.js'='application/javascript; charset=utf-8'; '.mjs'='application/javascript; charset=utf-8';
  '.css'='text/css; charset=utf-8'; '.json'='application/json; charset=utf-8';
  '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg';
  '.gif'='image/gif'; '.svg'='image/svg+xml'; '.ico'='image/x-icon';
  '.woff'='font/woff'; '.woff2'='font/woff2'; '.ttf'='font/ttf';
  '.txt'='text/plain; charset=utf-8'
}

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
  } catch { break }
  $req = $ctx.Request
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($req.Url.LocalPath).TrimStart('/')
    if (-not $rel) { $rel = 'index.html' }
    $path = Join-Path $root $rel
    if (Test-Path $path -PathType Container) { $path = Join-Path $path 'index.html' }
    if (Test-Path $path -PathType Leaf) {
      $bytes = [IO.File]::ReadAllBytes($path)
      $ext = [IO.Path]::GetExtension($path).ToLower()
      $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host "200 $rel"
    } else {
      $res.StatusCode = 404
      $msg = [Text.Encoding]::UTF8.GetBytes("Not Found: $rel")
      $res.OutputStream.Write($msg, 0, $msg.Length)
      Write-Host "404 $rel"
    }
  } catch {
    try { $res.StatusCode = 500 } catch {}
    Write-Host "500 $rel - $($_.Exception.Message)"
  } finally {
    try { $res.OutputStream.Close() } catch {}
  }
}
