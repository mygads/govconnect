# PHASE 6: INTEGRATION & TESTING

**Duration**: 4-6 jam  
**Complexity**: ⭐⭐ Medium  
**Prerequisites**: Phase 0-5 completed

---

## 🎯 OBJECTIVES

- Test end-to-end flow dari webhook hingga notifikasi
- Integration testing antar semua services
- Performance testing
- Fix bugs & issues
- Documentation update

---

## 📋 CHECKLIST

### 1. End-to-End Flow Testing

#### Scenario 1: Laporan Baru (Happy Path)
- [ ] Setup WA webhook simulator
- [ ] Send message: "jalan rusak depan rumah"
- [ ] Verify flow:
  - [ ] Service 1: Message saved + event published
  - [ ] Service 2: LLM called + complaint created
  - [ ] Service 3: Complaint saved in DB
  - [ ] Service 5: Notification sent to user
  - [ ] Dashboard: Complaint visible
- [ ] Check timing (should < 10 seconds total)
- [ ] Check FIFO (save 35 messages, only 30 remain)

#### Scenario 2: Tiket Baru
- [ ] Send: "mau buat surat keterangan domisili"
- [ ] Verify flow end-to-end
- [ ] Check notification received
- [ ] Check tiket in dashboard

#### Scenario 3: Update Status dari Dashboard
- [ ] Admin login to dashboard
- [ ] Update complaint status to "proses"
- [ ] Verify notification sent to user
- [ ] Check event flow

#### Scenario 4: Multi-turn Conversation
- [ ] Send: "jalan rusak"
- [ ] AI reply: "Boleh sebutkan alamatnya?"
- [ ] User: "Jl Melati 21"
- [ ] Verify context maintained (30 messages history)
- [ ] Verify laporan created with full info

### 2. Service-to-Service Integration Tests

#### Service 1 ↔ Service 2
- [ ] Mock webhook payload
- [ ] Verify event published correctly
- [ ] Service 2 can fetch message history
- [ ] Service 2 can fetch 30 messages (FIFO test)

#### Service 2 ↔ Service 3
- [ ] Mock LLM response (CREATE_COMPLAINT intent)
- [ ] Verify SYNC call to Service 3
- [ ] Verify complaint created
- [ ] Test timeout handling (if Service 3 slow)
- [ ] Test retry logic

#### Service 3 ↔ Service 5
- [ ] Mock complaint created event
- [ ] Verify Service 5 consumes event
- [ ] Verify notification sent

#### Service 5 ↔ Service 1
- [ ] Mock notification event
- [ ] Verify Service 1 receives send request
- [ ] Verify message saved to DB (OUT direction)
- [ ] Verify FIFO applies to OUT messages too

### 3. Error Handling Tests

- [ ] **Database Down**: Service should log error, not crash
- [ ] **RabbitMQ Down**: Service should retry connection
- [ ] **WA API Down**: Service 1 should log send failure
- [ ] **LLM Timeout**: Service 2 should send fallback response
- [ ] **Service 3 Down**: Service 2 should handle gracefully
- [ ] **Invalid JSON from LLM**: Service 2 should catch & fallback
- [ ] **Duplicate Message**: Service 1 should skip processing

### 4. Performance Testing

- [ ] **Load Test**: Send 100 messages rapidly
  - [ ] All processed successfully?
  - [ ] No message loss?
  - [ ] Response time acceptable? (< 10s per message)
- [ ] **FIFO Performance**: Test with 1000 messages per user
  - [ ] Delete operation fast enough?
  - [ ] No deadlock?
- [ ] **Concurrent Users**: 10 users send messages simultaneously
  - [ ] All handled correctly?
  - [ ] No race conditions?

### 5. Data Integrity Tests

- [ ] **Message Count**: Verify exactly 30 messages per user
- [ ] **Message Order**: Verify messages in correct order (oldest first)
- [ ] **No Duplicates**: Send same message twice, verify only saved once
- [ ] **Complaint ID Uniqueness**: Create 50 complaints same day, verify unique IDs
- [ ] **Foreign Key Integrity**: Verify relationships correct

### 6. Security Tests

- [ ] **Internal API Auth**: Call without API key → 403 Forbidden
- [ ] **Dashboard Auth**: Access dashboard without login → Redirect to login
- [ ] **JWT Expiration**: Use expired token → 401 Unauthorized
- [ ] **SQL Injection**: Try injection in filters → Should be safe (Prisma)
- [ ] **XSS**: Try XSS in message text → Should be escaped

### 7. Postman Collection

- [ ] Create Postman collection dengan:
  - [ ] Service 1: Webhook, Internal APIs
  - [ ] Service 2: Health check
  - [ ] Service 3: All CRUD endpoints
  - [ ] Service 5: Health check
  - [ ] Dashboard: Login, Fetch data
- [ ] Add environment variables
- [ ] Add test scripts for assertions
- [ ] Export & commit to repo

### 8. Documentation Review

- [ ] All README.md up to date?
- [ ] API documentation complete?
- [ ] Environment variables documented?
- [ ] Architecture diagram correct?
- [ ] Deployment guide ready?

### 9. Code Quality Check

- [ ] Run ESLint on all services
- [ ] Fix all warnings
- [ ] Check for console.log (replace with logger)
- [ ] Check for hardcoded values
- [ ] Check error handling completeness

### 10. Monitoring Setup

- [ ] Add request logging to all services
- [ ] Add metrics collection (optional):
  - [ ] Total messages processed
  - [ ] LLM latency average
  - [ ] Notification success rate
- [ ] Setup log aggregation (optional)

---

## 🧪 TESTING TOOLS

### 1. Webhook Simulator

Create `tests/webhook-simulator.js`:

```javascript
const axios = require('axios');

async function simulateWebhook(message) {
  const payload = {
    messaging_product: 'whatsapp',
    entry: [{
      changes: [{
        value: {
          messages: [{
            from: '628123456789',
            id: `wamid.${Date.now()}`,
            timestamp: Math.floor(Date.now() / 1000).toString(),
            text: { body: message },
            type: 'text',
          }],
        },
      }],
    }],
  };

  try {
    const response = await axios.post(
      'http://localhost:3001/webhook/whatsapp',
      payload
    );
    console.log('✅ Webhook sent:', response.data);
  } catch (error) {
    console.error('❌ Webhook failed:', error.message);
  }
}

// Usage
simulateWebhook('jalan rusak depan rumah');
```

---

### 2. Load Test Script

Create `tests/load-test.js`:

```javascript
const axios = require('axios');

async function loadTest(numRequests = 100) {
  console.log(`🚀 Starting load test with ${numRequests} requests...`);
  
  const promises = [];
  const startTime = Date.now();
  
  for (let i = 0; i < numRequests; i++) {
    const promise = axios.post('http://localhost:3001/webhook/whatsapp', {
      // ... webhook payload
    }).catch(err => ({
      error: err.message,
    }));
    
    promises.push(promise);
  }
  
  const results = await Promise.all(promises);
  const endTime = Date.now();
  
  const successful = results.filter(r => !r.error).length;
  const failed = results.filter(r => r.error).length;
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  
  console.log(`✅ Load test completed in ${duration}s`);
  console.log(`   Successful: ${successful}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Rate: ${(numRequests / duration).toFixed(2)} req/s`);
}

loadTest(100);
```

---

### 3. FIFO Verification Script

Create `tests/verify-fifo.js`:

```javascript
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verifyFIFO(userId = '628123456789') {
  const messages = await prisma.message.findMany({
    where: { wa_user_id: userId },
    orderBy: { timestamp: 'desc' },
  });
  
  console.log(`📊 User ${userId} has ${messages.length} messages`);
  
  if (messages.length > 30) {
    console.error('❌ FIFO FAILED: More than 30 messages!');
  } else {
    console.log('✅ FIFO OK: 30 or fewer messages');
  }
  
  // Check order
  let ordered = true;
  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i].timestamp < messages[i + 1].timestamp) {
      ordered = false;
      break;
    }
  }
  
  if (ordered) {
    console.log('✅ ORDER OK: Messages in correct order (newest first)');
  } else {
    console.error('❌ ORDER FAILED: Messages not in correct order');
  }
}

verifyFIFO();
```

---

## 📊 TEST RESULTS TEMPLATE

Create `tests/TEST_RESULTS.md`:

```markdown
# GovConnect Test Results

## Test Date: [DATE]
## Tester: [NAME]

### 1. End-to-End Tests

| Scenario | Status | Notes |
|----------|--------|-------|
| Laporan Baru (Happy Path) | ✅ Pass | Response time: 8.5s |
| Tiket Baru | ✅ Pass | |
| Update Status | ✅ Pass | |
| Multi-turn Conversation | ✅ Pass | Context maintained |

### 2. Integration Tests

| Test | Status | Notes |
|------|--------|-------|
| Service 1 → Service 2 | ✅ Pass | |
| Service 2 → Service 3 | ✅ Pass | Sync call working |
| Service 3 → Service 5 | ✅ Pass | |
| Service 5 → Service 1 | ✅ Pass | |

### 3. Error Handling

| Scenario | Status | Notes |
|----------|--------|-------|
| Database Down | ✅ Pass | Graceful error |
| RabbitMQ Down | ✅ Pass | Auto-reconnect |
| WA API Down | ✅ Pass | Logged failure |
| LLM Timeout | ✅ Pass | Fallback response |

### 4. Performance

| Metric | Result | Target | Status |
|--------|--------|--------|--------|
| Average Response Time | 7.2s | < 10s | ✅ Pass |
| Load Test (100 req) | 98% success | > 95% | ✅ Pass |
| FIFO Enforcement | Working | 30 messages | ✅ Pass |

### 5. Security

| Test | Status | Notes |
|------|--------|-------|
| Internal API Auth | ✅ Pass | 403 without key |
| Dashboard Auth | ✅ Pass | Redirect to login |
| JWT Expiration | ✅ Pass | 401 with expired token |

## Issues Found

1. [Issue #1]: Description...
2. [Issue #2]: Description...

## Overall Status: ✅ READY FOR DEPLOYMENT
```

---

## ✅ COMPLETION CRITERIA

Phase 6 dianggap selesai jika:

- [x] All end-to-end scenarios pass
- [x] All integration tests pass
- [x] No critical bugs remaining
- [x] Performance acceptable (< 10s response)
- [x] Security tests pass
- [x] Postman collection complete
- [x] Documentation updated
- [x] Test results documented

---

## 🚀 NEXT STEPS

After completing Phase 6:
→ Go to **[Phase 7: Deployment](./PHASE_7_DEPLOYMENT.md)**

---

**Phase 6 Status**: 🔴 Not Started  
**Last Updated**: November 24, 2025
