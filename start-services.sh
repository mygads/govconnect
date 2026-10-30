#!/bin/bash
cd ~/workspace/gc-merge
(cd govconnect-channel-service && nohup npx tsx src/server.ts > ../logs/channel.log 2>&1 &)
sleep 3
(cd govconnect-case-service && nohup npx tsx src/server.ts > ../logs/case.log 2>&1 &)
sleep 3
(cd govconnect-notification-service && nohup npx tsx src/server.ts > ../logs/notification.log 2>&1 &)
sleep 3
(cd govconnect-ai-service && nohup npx tsx src/server.ts > ../logs/ai.log 2>&1 &)
echo "all started"
