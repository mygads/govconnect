const http = require("http");

async function test(sessionId, message) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      session_id: sessionId,
      message: message,
      village_id: "cmkuvo1dk0000mj60h4u4bq1w"
    });

    const options = {
      hostname: "127.0.0.1",
      port: 3002,
      path: "/api/webchat",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data)
      }
    };

    const req = http.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => resolve(JSON.parse(body)));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function runTests() {
  const sessionId = "web_memory_v2_" + Date.now();
  
  console.log("=== Test 1: Greeting dengan nama ===");
  let r = await test(sessionId, "halo saya Clara");
  console.log("Response:", r.response);
  console.log("Intent:", r.intent);
  console.log("");
  
  await new Promise(r => setTimeout(r, 4000));
  
  console.log("=== Test 2: Tanya siapa saya ===");
  r = await test(sessionId, "siapa nama saya?");
  console.log("Response:", r.response);
  console.log("Intent:", r.intent);
  console.log("");
  
  await new Promise(r => setTimeout(r, 4000));
  
  console.log("=== Test 3: Tanya tadi saya bilang apa ===");
  r = await test(sessionId, "tadi saya bilang apa?");
  console.log("Response:", r.response);
  console.log("Intent:", r.intent);
}

runTests().catch(console.error);
