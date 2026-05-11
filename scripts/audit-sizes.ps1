$root = "c:\Yoga\Programming\containers\govconnect\govconnect-ai-service\src\services"
Get-ChildItem -Path $root -File -Include *.ts -Recurse |
  Sort-Object Length -Descending |
  Select-Object -First 25 Name, @{ Name = 'KB'; Expression = { [math]::Round($_.Length / 1KB, 1) } } |
  Format-Table -AutoSize
