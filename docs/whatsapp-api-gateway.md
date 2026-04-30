WhatsApp API Dokumentation
Production Ready
Version 2.1.1
Dokumentasi lengkap Genfity WhatsApp API. Beli paket di genfity.com, dapatkan API key dari dashboard, buat session baru, lalu gunakan session token untuk kirim pesan dan kelola WhatsApp secara programmatic.

API Base URL
Server endpoint utama

https://api-wa.genfity.com

Copy
Account & Session
https://api-wa.genfity.com/v1/*
Header: x-api-key

WhatsApp Gateway
https://api-wa.genfity.com/v1/wa/*
Header: token

Quick Start Guide
1
Beli Paket

Pilih paket WhatsApp API di genfity.com

2
Dapatkan API Key

API key tersedia di dashboard setelah pembelian

3
Buat Session

POST /v1/sessions dengan x-api-key

4
Kirim Pesan

Gunakan session_token di header token untuk /v1/wa/* endpoints

Account & Session Management
Kelola akun, buat session, dan konfigurasi session menggunakan API key Anda. Endpoint ini dikelola oleh genfity-wa-support.

GET
/v1/me


Get My Account
Cek info akun dan subscription aktif. Gunakan untuk memverifikasi API key dan melihat limit session/pesan.

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
x-api-key:
<Your-API-Key>
Response

Copy JSON
response.json
{
  "user": {
    "id": "usr_001",
    "source_service": "genfity-app",
    "status": "active",
    "created_at": "2025-01-01T00:00:00Z"
  },
  "subscription": {
    "provider": "genfity-wa",
    "max_sessions": 3,
    "max_messages": 10000,
    "expires_at": "2026-12-31T23:59:59Z",
    "status": "active"
  }
}
GET
/v1/sessions


List Sessions
Lihat semua session WhatsApp milik akun Anda. Setiap session merepresentasikan satu nomor WhatsApp yang terhubung.

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
x-api-key:
<Your-API-Key>
Response

Copy JSON
response.json
{
  "sessions": [
    {
      "id": 1,
      "session_id": "sess_abc123",
      "session_name": "marketing-1",
      "session_token": "tok_xxxxxxxx",
      "webhook_url": "https://example.com/webhook",
      "connected": true,
      "logged_in": true,
      "jid": "628123456789@s.whatsapp.net",
      "status": "active",
      "created_at": "2025-06-01T00:00:00Z"
    }
  ]
}
POST
/v1/sessions


Create New Session
Buat session WhatsApp baru. Jumlah session dibatasi oleh paket langganan Anda. Setelah dibuat, gunakan session_token yang dikembalikan untuk connect dan berinteraksi dengan WhatsApp.

Request

Copy JSON
request.json
{
  "session_name": "marketing-1",
  "webhook_url": "https://example.com/webhook",
  "events": "Message,Connected,Disconnected,QR",
  "expiration_sec": 0,
  "auto_connect": true,
  "auto_read_enabled": false,
  "typing_enabled": true,
  "history": 0
}
Headers
Content-Type:
application/json
x-api-key:
<Your-API-Key>
Response

Copy JSON
response.json
{
  "session": {
    "id": 1,
    "session_id": "sess_abc123",
    "session_name": "marketing-1",
    "session_token": "tok_xxxxxxxx",
    "webhook_url": "https://example.com/webhook",
    "status": "active",
    "created_at": "2025-06-01T00:00:00Z"
  }
}
PUT
/v1/sessions/:session_id


Update Session
Update konfigurasi session seperti webhook URL, events, dan pengaturan auto-read.

Request

Copy JSON
request.json
{
  "webhook_url": "https://example.com/new-webhook",
  "events": "Message,Connected,Disconnected",
  "auto_read_enabled": true,
  "typing_enabled": false
}
Headers
Content-Type:
application/json
x-api-key:
<Your-API-Key>
Response

Copy JSON
response.json
{
  "session": {
    "id": 1,
    "session_id": "sess_abc123",
    "session_name": "marketing-1",
    "webhook_url": "https://example.com/new-webhook",
    "status": "active"
  }
}
DELETE
/v1/sessions/:session_id


Delete Session
Hapus session WhatsApp secara permanen. Session akan di-disconnect dan semua data terkait dihapus.

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
x-api-key:
<Your-API-Key>
Response

Copy JSON
response.json
{
  "success": true,
  "message": "Session deleted successfully"
}
GET
/v1/sessions/:session_id/settings


Get Session Settings
Lihat pengaturan detail session termasuk auto-read, typing indicator, webhook URL, dan statistik pesan.

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
x-api-key:
<Your-API-Key>
Response

Copy JSON
response.json
{
  "session_id": "sess_abc123",
  "auto_read_enabled": false,
  "typing_enabled": true,
  "webhook_url": "https://example.com/webhook",
  "message_stat_sent": 1520,
  "message_stat_failed": 3
}
PUT
/v1/sessions/:session_id/settings


Update Session Settings
Update pengaturan session seperti auto-read, typing indicator, dan webhook URL.

Request

Copy JSON
request.json
{
  "auto_read_enabled": true,
  "typing_enabled": false,
  "webhook_url": "https://example.com/updated-webhook"
}
Headers
Content-Type:
application/json
x-api-key:
<Your-API-Key>
Response

Copy JSON
response.json
{
  "session_id": "sess_abc123",
  "auto_read_enabled": true,
  "typing_enabled": false,
  "webhook_url": "https://example.com/updated-webhook"
}
GET
/v1/sessions/:session_id/contacts


Get Session Contacts
Lihat kontak untuk session tertentu. Gunakan sync=true (default) untuk sync dari WhatsApp terlebih dahulu, atau sync=false untuk membaca dari cache lokal.

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
x-api-key:
<Your-API-Key>
Response

Copy JSON
response.json
{
  "contacts": [
    {
      "jid": "628123456789@s.whatsapp.net",
      "name": "John Doe",
      "phone": "628123456789",
      "last_synced_at": "2025-06-01T12:00:00Z"
    }
  ]
}
POST
/v1/sessions/:session_id/contacts/sync


Sync Contacts
Paksa sync kontak dari WhatsApp ke database lokal. Berguna ketika Anda perlu memastikan kontak terbaru.

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
x-api-key:
<Your-API-Key>
Response

Copy JSON
response.json
{
  "success": true,
  "synced_count": 150,
  "message": "Contacts synced successfully"
}
WhatsApp Connection
Connect, autentikasi, dan konfigurasi koneksi WhatsApp menggunakan session token dari pembuatan session.

GET
/v1/wa/session/status


Get Session Status
Get connection status

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Connected": true,
    "LoggedIn": true
  },
  "success": true
}
GET
/v1/wa/session/qr


Get QR Code
Get QR code for authentication

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "QRCode": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
  },
  "success": true
}
POST
/v1/wa/session/connect


Connect Session
Connect the WhatsApp session

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Connected successfully"
  },
  "success": true
}
POST
/v1/wa/session/disconnect


Disconnect Session
Disconnect the WhatsApp session

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Disconnected successfully"
  },
  "success": true
}
POST
/v1/wa/session/logout


Logout Session
Logout the WhatsApp session

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Logged out successfully"
  },
  "success": true
}
POST
/v1/wa/session/s3/config


Configure S3
Configure S3 for media storage

Request

Copy JSON
request.json
{
  "enabled": true,
  "endpoint": "s3.amazonaws.com",
  "region": "us-east-1",
  "bucket": "my-whatsapp-media",
  "access_key": "AKIAIOSFODNN7EXAMPLE",
  "secret_key": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  "path_style": false,
  "public_url": "",
  "media_delivery": "both",
  "retention_days": 30
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "S3 configured successfully"
  },
  "success": true
}
GET
/v1/wa/session/s3/config


Get S3 Configuration
Get S3 configuration

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "endpoint": "s3.amazonaws.com",
    "region": "us-east-1",
    "bucket": "my-whatsapp-media",
    "access_key": "AKIAIOSFODNN7EXAMPLE",
    "secret_key": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "path_style": false,
    "public_url": "",
    "media_delivery": "both",
    "retention_days": 30
  },
  "success": true
}
POST
/v1/wa/session/s3/test


Test S3 Connection
Test S3 connection

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "S3 connection test successful"
  },
  "success": true
}
DELETE
/v1/wa/session/s3/config


Delete S3 Configuration
Remove S3 configuration

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "S3 configuration deleted successfully"
  },
  "success": true
}
POST
/v1/wa/session/hmac/config


Configure HMAC Key
Configure HMAC key for webhook signing

Request

Copy JSON
request.json
{
  "hmac_key": "your_hmac_key_minimum_32_characters_long_here"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "HMAC key configured successfully"
  },
  "success": true
}
GET
/v1/wa/session/hmac/config


Get HMAC Configuration
Get HMAC configuration status

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "hmac_configured": true
  },
  "success": true
}
DELETE
/v1/wa/session/hmac/config


Delete HMAC Configuration
Delete HMAC configuration

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "HMAC configuration deleted successfully"
  },
  "success": true
}
POST
/v1/wa/session/history


Set History Configuration
Configure message history storage. Set history to 0 to disable, or any positive number to enable with that limit. Example: 500 will store last 500 messages per chat.

Request

Copy JSON
request.json
{
  "history": 500
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "History configuration updated"
  },
  "success": true
}
Webhook Management
Konfigurasi webhook untuk menerima event dan notifikasi dari WhatsApp.

GET
/v1/wa/webhook


Get Webhook
Get webhook

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "WebhookURL": "https://example.net/webhook",
    "Events": [
      "Message",
      "ReadReceipt"
    ]
  },
  "success": true
}
POST
/v1/wa/webhook


Set Webhook
Set webhook

Request

Copy JSON
request.json
{
  "WebhookURL": "https://example.net/webhook",
  "Events": [
    "Message",
    "ReadReceipt"
  ]
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "WebhookURL": "https://example.net/webhook",
    "Events": [
      "Message",
      "ReadReceipt"
    ]
  },
  "success": true
}
DELETE
/v1/wa/webhook


Delete Webhook
Delete webhook

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Webhook deleted successfully"
  },
  "success": true
}
PUT
/v1/wa/webhook/update


Update Webhook
Update webhook

Request

Copy JSON
request.json
{
  "WebhookURL": "https://example.net/webhook",
  "Events": [
    "Message",
    "ReadReceipt"
  ],
  "active": true
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "WebhookURL": "https://example.net/webhook",
    "Events": [
      "Message",
      "ReadReceipt"
    ],
    "active": true
  },
  "success": true
}
GET
/v1/wa/webhook/events


Get Webhook Events
Get list of available webhook events

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "active_events": [
      "Message",
      "Receipt"
    ],
    "all_supported_events": [
      "Message",
      "Receipt",
      "Presence",
      "ChatPresence"
    ],
    "not_implemented_events": []
  },
  "success": true
}
Chat & Messaging
Messaging primitives: send, edit, react, media & interaction messages.

POST
/v1/wa/chat/send/text


Send Text Message
Sends a text message. Phone and Body are mandatory.

Request

Copy JSON
request.json
{
  "Phone": "5491155553935",
  "Body": "Hello, how are you?"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Sent",
    "Id": "90B2F8B13FAC8A9CF6B06E99C7834DC5",
    "Timestamp": "2022-04-20T12:49:08-03:00"
  },
  "success": true
}
POST
/v1/wa/chat/send/text


Send Text Message with link preview
Send text

Request

Copy JSON
request.json
{
  "Phone": "5491155553935",
  "Body": "Check my site? https://example.com",
  "LinkPreview": true
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Sent",
    "Id": "90B2F8B13FAC8A9CF6B06E99C7834DC5",
    "Timestamp": "2022-04-20T12:49:08-03:00"
  },
  "success": true
}
POST
/v1/wa/chat/send/text


Send Text Message Reply
Send text message as a reply with quoted text preview

Request

Copy JSON
request.json
{
  "Phone": "5491155553935",
  "Body": "This is my reply",
  "Id": "ABCDABCD1234-reply",
  "QuotedText": "Original message text",
  "ContextInfo": {
    "StanzaId": "ABCDABCD1234",
    "Participant": "5491155553935@s.whatsapp.net"
  }
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Sent",
    "Id": "90B2F8B13FAC8A9CF6B06E99C7834DC5",
    "Timestamp": "2022-04-20T12:49:08-03:00"
  },
  "success": true
}
POST
/v1/wa/chat/send/edit


Edit Message
Edit an existing message

Request

Copy JSON
request.json
{
  "Phone": "5491155553934",
  "Id": "AABBCC11223344",
  "Body": "New edited message body"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Sent",
    "Id": "AABBCC11223344",
    "Timestamp": "2022-04-20T12:49:08-03:00"
  },
  "success": true
}
POST
/v1/wa/chat/send/image


Send Image
Sends an image message. The `Image` field accepts a public HTTP(S) URL or a base64 data URL in PNG/JPEG format.

Request

Copy JSON
request.json
{
  "Phone": "5491155553935",
  "Image": "data:image/jpeg;base64,/9j/",
  "Caption": "Image"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Sent",
    "Id": "90B2F8B13FAC8A9CF6B06E99C7834DC5",
    "Timestamp": "2022-04-20T12:49:08-03:00"
  },
  "success": true
}
POST
/v1/wa/chat/send/audio


Send Audio
Send audio. The `Audio` field accepts a public HTTP(S) URL or a base64 data URL.

Request

Copy JSON
request.json
{
  "Phone": "5491155553935",
  "Audio": "data:audio/ogg;base64,/9j/"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Sent",
    "Id": "90B2F8B13FAC8A9CF6B06E99C7834DC5",
    "Timestamp": "2022-04-20T12:49:08-03:00"
  },
  "success": true
}
POST
/v1/wa/chat/send/document


Send Document
Sends any document. The `Document` field accepts a public HTTP(S) URL or a base64 data URL.

Request

Copy JSON
request.json
{
  "Phone": "5491155553935",
  "Document": "data:application/octet-stream;base64,/9j/",
  "FileName": "doc.pdf"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Sent",
    "Id": "90B2F8B13FAC8A9CF6B06E99C7834DC5",
    "Timestamp": "2022-04-20T12:49:08-03:00"
  },
  "success": true
}
POST
/v1/wa/chat/send/video


Send Video
Sends a video message. The `Video` field accepts a public HTTP(S) URL or a base64 data URL in MP4/3GPP format.

Request

Copy JSON
request.json
{
  "Phone": "5491155553935",
  "Video": "data:video/mp4;base64,/9j/",
  "Caption": "Video"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Sent",
    "Id": "90B2F8B13FAC8A9CF6B06E99C7834DC5",
    "Timestamp": "2022-04-20T12:49:08-03:00"
  },
  "success": true
}
POST
/v1/wa/chat/send/sticker


Send Sticker
Send sticker

Request

Copy JSON
request.json
{
  "Phone": "5491155553935",
  "Sticker": "data:image/webp;base64,/9j/"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Sent",
    "Id": "90B2F8B13FAC8A9CF6B06E99C7834DC5",
    "Timestamp": "2022-04-20T12:49:08-03:00"
  },
  "success": true
}
POST
/v1/wa/chat/send/location


Send Location
Sends a location message with coordinates.

Request

Copy JSON
request.json
{
  "Phone": "5491155553935",
  "Name": "Location",
  "Latitude": 48.858,
  "Longitude": 2.294
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Sent",
    "Id": "90B2F8B13FAC8A9CF6B06E99C7834DC5",
    "Timestamp": "2022-04-20T12:49:08-03:00"
  },
  "success": true
}
POST
/v1/wa/chat/send/contact


Send Contact
Send contact

Request

Copy JSON
request.json
{
  "Phone": "5491155553935",
  "Name": "John",
  "Vcard": "BEGIN:VCARD\nVERSION:3.0\nFN:John Doe\nTEL:+16175551212\nEND:VCARD"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Sent",
    "Id": "90B2F8B13FAC8A9CF6B06E99C7834DC5",
    "Timestamp": "2022-04-20T12:49:08-03:00"
  },
  "success": true
}
POST
/v1/wa/chat/send/template


Send Template
Send template

Request

Copy JSON
request.json
{
  "Phone": "5491155553935",
  "Content": "Title",
  "Footer": "Footer",
  "Buttons": [
    {
      "DisplayText": "Yes",
      "Type": "quickreply"
    }
  ]
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Sent",
    "Id": "90B2F8B13FAC8A9CF6B06E99C7834DC5",
    "Timestamp": "2022-04-20T12:49:08-03:00"
  },
  "success": true
}
POST
/v1/wa/chat/markread


Mark as Read
Marks one or more received messages as read.

Request

Copy JSON
request.json
{
  "Id": [
    "AABBCC11223344"
  ],
  "ChatPhone": "5491155553934"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Message(s) marked as read"
  },
  "success": true
}
POST
/v1/wa/chat/react


React to Message
React to message

Request

Copy JSON
request.json
{
  "Phone": "5491155553935",
  "Body": "❤️",
  "Id": "me:3EB06F9067F80BAB89FF"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Sent",
    "Id": "90B2F8B13FAC8A9CF6B06E99C7834DC5",
    "Timestamp": "2022-04-20T12:49:08-03:00"
  },
  "success": true
}
POST
/v1/wa/chat/presence


Chat Presence
Set presence

Request

Copy JSON
request.json
{
  "Phone": "5491155553935",
  "State": "composing"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Presence set successfully"
  },
  "success": true
}
POST
/v1/wa/chat/delete


Delete Message
Delete a message from a chat.

Request

Copy JSON
request.json
{
  "Phone": "5491155553934",
  "Id": "AABBCC11223344"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Message deleted successfully"
  },
  "success": true
}
GET
/v1/wa/chat/history


Get Message History
Retrieve message history for a specific chat. Requires history to be enabled via POST /session/history. Use chat_jid=index to get mapping of all user instances and their chats.

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "History": []
  },
  "success": true
}
POST
/v1/wa/chat/send/poll


Send Poll
Send a poll to a group. Minimum 2 options required. Maximum 1 selection allowed.

Request

Copy JSON
request.json
{
  "group": "120363313346913103@g.us",
  "header": "What is your favorite color?",
  "options": [
    "Red",
    "Blue",
    "Green",
    "Yellow"
  ],
  "Id": ""
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Sent",
    "Id": "90B2F8B13FAC8A9CF6B06E99C7834DC5",
    "Timestamp": "2022-04-20T12:49:08-03:00"
  },
  "success": true
}
User Operations
Lookup, presence and profile utilities for WhatsApp users.

POST
/v1/wa/user/check


Check Users
Check users

Request

Copy JSON
request.json
{
  "Phone": [
    "5491155553934",
    "5491155553935"
  ]
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Users": [
      {
        "IsInWhatsapp": true,
        "JID": "5491155553934@s.whatsapp.net",
        "Query": "5491155553934",
        "VerifiedName": "Company Name"
      }
    ]
  },
  "success": true
}
POST
/v1/wa/user/info


Get User Info
Get user information

Request

Copy JSON
request.json
{
  "Phone": [
    "5491155553934",
    "5491155553935"
  ]
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Users": {
      "5491155553935@s.whatsapp.net": {
        "Devices": [],
        "PictureID": "",
        "Status": "",
        "VerifiedName": null
      }
    }
  },
  "success": true
}
POST
/v1/wa/user/presence


User Presence
Global presence

Request

Copy JSON
request.json
{
  "type": "available"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Presence set successfully"
  },
  "success": true
}
POST
/v1/wa/user/avatar


Get User Avatar
Get avatar

Request

Copy JSON
request.json
{
  "Phone": "5491155553934",
  "Preview": true
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "URL": "https://pps.whatsapp.net/v/t61.24694-24/227295214_112447507729487_4643695328050510566_n.jpg",
  "ID": "1645308319",
  "Type": "preview",
  "DirectPath": "/v/t61.24694-24/227295214_112447507729487_4643695328050510566_n.jpg"
}
GET
/v1/wa/user/contacts


Get User Contacts
List contacts

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "5491122223333@s.whatsapp.net": {
      "BusinessName": "",
      "FirstName": "",
      "Found": true,
      "FullName": "",
      "PushName": "Contact Name"
    }
  }
}
POST
/v1/wa/status/set/text


Set Status Text
Set WhatsApp profile status message.

Request

Copy JSON
request.json
{
  "Body": "Available - Powered by Genfity WA"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Status set successfully"
  },
  "success": true
}
GET
/v1/wa/user/lid/628123456789@s.whatsapp.net


Get User LID
Get User Linked ID (LID) for a specific JID.

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "LID": "some-lid"
  },
  "success": true
}
Group Management
Create, manage, and configure WhatsApp groups, participants, and group settings.

POST
/v1/wa/group/create


Create Group
Create a new WhatsApp group with specified name and participants

Request

Copy JSON
request.json
{
  "Name": "My New Group",
  "Participants": [
    "5491155553934",
    "5491155553935"
  ]
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "JID": "120363123456789@g.us",
    "Name": "My New Group"
  },
  "success": true
}
POST
/v1/wa/group/locked


Set Group Locked
Configure group as locked (only admins can alter info) or unlocked

Request

Copy JSON
request.json
{
  "GroupJID": "120362023605733675@g.us",
  "Locked": true
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Group locked setting updated successfully"
  },
  "success": true
}
POST
/v1/wa/group/ephemeral


Set Disappearing Timer
Configure disappearing messages. Use '24h', '7d', '90d', or 'off'

Request

Copy JSON
request.json
{
  "GroupJID": "120362023605733675@g.us",
  "Duration": "24h"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Disappearing timer set successfully"
  },
  "success": true
}
POST
/v1/wa/group/photo/remove


Remove Group Photo
Remove the current photo from a WhatsApp group

Request

Copy JSON
request.json
{
  "GroupJID": "120362023605733675@g.us"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Group photo removed successfully"
  },
  "success": true
}
GET
/v1/wa/group/list


List Groups
List groups

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Groups": [
      {
        "JID": "120362023605733675@g.us",
        "Name": "Super Group"
      }
    ]
  },
  "success": true
}
GET
/v1/wa/group/info


Get Group Info
Get group information

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "JID": "120362023605733675@g.us",
    "Name": "Super Group"
  },
  "success": true
}
GET
/v1/wa/group/invitelink


Get Group Invite Link
Get invite link

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "InviteLink": "https://chat.whatsapp.com/HffXhYmzzyJGec61oqMXiz"
  },
  "success": true
}
POST
/v1/wa/group/name


Change Group Name
Change name

Request

Copy JSON
request.json
{
  "GroupJID": "120362023605733675@g.us",
  "Name": "New Name"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Group Name set successfully"
  },
  "success": true
}
POST
/v1/wa/group/photo


Change Group Photo
Change photo

Request

Copy JSON
request.json
{
  "GroupJID": "120362023605733675@g.us",
  "Image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD..."
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Group Photo set successfully",
    "PictureID": "1222332123"
  },
  "success": true
}
POST
/v1/wa/group/topic


Set Group Topic
Change the group topic/description

Request

Copy JSON
request.json
{
  "GroupJID": "120362023605733675@g.us",
  "Topic": "New group topic here"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Group Topic set successfully"
  },
  "success": true
}
POST
/v1/wa/group/announce


Set Group Announce
Set group to announcement-only (admins only can send messages)

Request

Copy JSON
request.json
{
  "GroupJID": "120362023605733675@g.us",
  "Announce": true
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Group Announce mode set successfully"
  },
  "success": true
}
POST
/v1/wa/group/join


Group Join
Join a group using an invite code

Request

Copy JSON
request.json
{
  "InviteCode": "AbCdEfGhIjKlMnOp"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Joined group successfully"
  },
  "success": true
}
POST
/v1/wa/group/inviteinfo


Get Group Invite Info
Get info about a group invite code

Request

Copy JSON
request.json
{
  "InviteCode": "AbCdEfGhIjKlMnOp"
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "InviteInfo": {
      "GroupName": "Test Group",
      "GroupJID": "120363312246943103@g.us"
    }
  },
  "success": true
}
POST
/v1/wa/group/updateparticipants


Update Group Participants
Add, remove, promote or demote participants from a group. Action can be 'add', 'remove', 'promote','demote'.

Request

Copy JSON
request.json
{
  "GroupJID": "120362023605733675@g.us",
  "Action": "add",
  "Phone": [
    "5491155553934@s.whatsapp.net",
    "5491155553935@s.whatsapp.net"
  ]
}
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Details": "Participants updated successfully"
  },
  "success": true
}
Newsletter Management
Manage and interact with WhatsApp newsletters and subscriptions.

GET
/v1/wa/newsletter/list


List Newsletters
List newsletters

Request

Copy JSON
No request body required
Headers
Content-Type:
application/json
token:
<Session-Token>
Response

Copy JSON
response.json
{
  "code": 200,
  "data": {
    "Newsletter": [
      {
        "id": "120363144038483540@newsletter",
        "name": "WhatsApp"
      }
    ]
  },
  "success": true
}