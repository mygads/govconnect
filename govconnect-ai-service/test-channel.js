const http = require("http");

const options = {
  hostname: "127.0.0.1",
  port: 3003,
  path: "/health",
  method: "GET"
};

const req = http.request(options, (res) => {
  let body = "";
  res.on("data", (chunk) => body += chunk);
  res.on("end", () => console.log("Health:", res.statusCode, body));
});
req.on("error", (e) => console.error("Error:", e.message));
req.end();
