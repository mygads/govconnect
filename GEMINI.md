# Context
Project: GovConnect - A digital platform for Village/Local Government services.
Architecture: Microservices (Node.js/TypeScript) with 4 core services:
1. Channel Service: Manages WhatsApp (via Genfity) and Webchat webhooks, and stores message history (max 30 messages per user).
2. AI Orchestrator: A stateless service responsible for intent detection, flow logic, and RAG orchestration.
3. Case Service: Handles CRUD operations for administrative services, public complaints, and transaction status.
4. Notification Service: Processes outbound message delivery via RabbitMQ events.

# Standards
- **AI Optimization**: Strictly follow `AI_OPTIMIZATION_GUIDE.md`. Always prioritize the Fast Path (Regex Intent Classifier) and Response Cache before invoking the LLM.
- **Data Scoping**: Every data access request MUST be scoped by `village_id` to ensure strict data isolation between different villages.
- **Stateless Logic**: The AI Orchestrator must remain stateless. Use the `Conversation FSM` (Finite State Machine) to manage multi-step interaction flows.
- **Unified Status**: Adhere to standardized transaction statuses: OPEN, PROCESS, DONE, CANCELED, and REJECT.

# Tool Preferences
- **MCP Tools**: Use the `context-7` MCP server when you need to retrieve external documentation or technical references during development.
- **ORM**: Use Prisma Client as defined in each service's `prisma/schema.prisma`.
- **Structured Extraction**: Utilize `entity-extractor.service.ts` to automatically capture entities such as NIK, Phone numbers, and Addresses from user input.

# Response Guidelines (End-User Communication)
- **Language**: Use polite, clear, and professional Indonesian (Bahasa Indonesia).
- **Tone**: Speak directly to the citizen using "Anda" or "Kamu".
- **Voice**: Use active voice. Keep sentences short, direct, and informative.
- **Action-Oriented**: Focus on providing practical, actionable steps for the citizen.
- **Formatting**: Avoid long dashes (—). Use periods or commas. Use bullet points for lists.