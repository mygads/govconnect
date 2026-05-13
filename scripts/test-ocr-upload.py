import urllib.request, json, uuid, io, sys, struct, zlib

base_url = 'http://localhost:3002'
api_headers = {'x-internal-api-key': 'govconnect-internal-api-key-2025'}
village_id = 'cmkuvo1dk0000mj60h4u4bq1w'

def make_multipart(fields, files):
    boundary = f'----PythonBoundary{uuid.uuid4().hex[:12]}'
    body = io.BytesIO()
    for name, value in fields.items():
        body.write(f'--{boundary}\r\n'.encode())
        body.write(f'Content-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    for name, (filename, content_bytes, content_type) in files.items():
        body.write(f'--{boundary}\r\n'.encode())
        body.write(f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode())
        body.write(f'Content-Type: {content_type}\r\n\r\n'.encode())
        body.write(content_bytes)
        body.write(b'\r\n')
    body.write(f'--{boundary}--\r\n'.encode())
    return body.getvalue(), boundary

def upload(doc_id, filename, file_bytes, content_type, title, category):
    fields = {'documentId': doc_id, 'village_id': village_id, 'title': title, 'category': category}
    files = {'file': (filename, file_bytes, content_type)}
    data, boundary = make_multipart(fields, files)
    req = urllib.request.Request(
        f'{base_url}/api/upload/document',
        data=data,
        headers={**api_headers, 'Content-Type': f'multipart/form-data; boundary={boundary}'},
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read()), None
    except urllib.error.HTTPError as e:
        return None, f'HTTP {e.code}: {e.read().decode()}'
    except Exception as e:
        return None, str(e)

def make_minimal_png(text_label='OCR TEST'):
    """Create a minimal valid 1x1 white PNG — just to test the image upload path."""
    def chunk(name, data):
        c = name + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
    raw = b'\x00\xff\xff\xff'
    idat = chunk(b'IDAT', zlib.compress(raw))
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend

# --- TEST 1: TXT (already passed, quick re-verify) ---
print("=== TEST 1: TXT upload (text-based, direct parse) ===")
doc_id_txt = f'doc_test_txt_{uuid.uuid4().hex[:6]}'
txt_bytes = b'Peraturan Desa: Pengaduan warga harus menyertakan lokasi, waktu, dan deskripsi masalah. Batas waktu penanganan darurat adalah 1x24 jam.'
result, err = upload(doc_id_txt, 'perdes-test.txt', txt_bytes, 'text/plain', 'Perdes Test', 'regulation')
if err:
    print(f'  FAIL: {err}')
else:
    print(f'  PASS: ocrQueued={result.get("ocrQueued")} chunks={result.get("chunksCount")} msg={result.get("message")}')

# --- TEST 2: PNG image (should trigger OCR/vision path) ---
print("\n=== TEST 2: PNG image upload (should trigger OCR/vision) ===")
doc_id_img = f'doc_test_img_{uuid.uuid4().hex[:6]}'
png_bytes = make_minimal_png()
result2, err2 = upload(doc_id_img, 'scan-dokumen-desa.png', png_bytes, 'image/png', 'Scan Dokumen Desa Test', 'regulation')
if err2:
    print(f'  ERROR: {err2}')
elif result2:
    ocr_queued = result2.get('ocrQueued')
    chunks = result2.get('chunksCount', 0)
    msg = result2.get('message', '')
    extraction = result2.get('extractionMode', '')
    print(f'  ocrQueued={ocr_queued} chunks={chunks} extractionMode={extraction}')
    print(f'  message={msg}')
    if ocr_queued:
        print('  STATUS: OCR pipeline triggered (queued for async processing)')
    elif chunks and chunks > 0:
        print('  STATUS: Vision extraction succeeded inline')
    else:
        print('  STATUS: No chunks, no OCR queue — check vision model config')

# --- TEST 3: Search to verify TXT content was indexed ---
print("\n=== TEST 3: Search for uploaded TXT content ===")
search_body = json.dumps({'query': 'batas waktu penanganan darurat pengaduan', 'village_id': village_id}).encode()
req3 = urllib.request.Request(
    f'{base_url}/api/knowledge/search',
    data=search_body,
    headers={**api_headers, 'Content-Type': 'application/json'},
    method='POST'
)
try:
    with urllib.request.urlopen(req3, timeout=30) as resp:
        r3 = json.loads(resp.read())
        hits = r3.get('data', [])
        print(f'  Search hits: {len(hits)}')
        for h in hits[:3]:
            print(f'    [{h.get("score", "?")}] {h.get("title", "?")} — {str(h.get("content",""))[:100]}')
        if hits:
            print('  STATUS: Document indexed and searchable')
        else:
            print('  STATUS: No hits — may need time to index or retrieval cache needs clearing')
except Exception as e:
    print(f'  Search error: {e}')
