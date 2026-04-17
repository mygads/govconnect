***

title: Agentic Usage
subtitle: Add OpenRouter SDK skills to your AI coding assistant
headline: Agentic Usage | OpenRouter SDK
canonical-url: '[https://openrouter.ai/docs/sdks/agentic-usage](https://openrouter.ai/docs/sdks/agentic-usage)'
'og:site\_name': OpenRouter Documentation
'og:title': Agentic Usage | OpenRouter SDK
'og:description': >-
Add OpenRouter SDK skills to AI coding assistants like Claude Code, Cursor,
GitHub Copilot, and more. Enable your AI to code with the OpenRouter SDK.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Agentic%20Usage\&description=Add%20OpenRouter%20SDK%20skills%20to%20your%20AI%20coding%20assistant](https://openrouter.ai/dynamic-og?title=Agentic%20Usage\&description=Add%20OpenRouter%20SDK%20skills%20to%20your%20AI%20coding%20assistant)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

Give your AI coding assistant the knowledge to work with the OpenRouter SDK
by installing our official skill. This enables AI agents to understand the
SDK's APIs, patterns, and best practices when helping you write code.

## Quick Start

Run this command in your project directory:

```bash
npx add-skill OpenRouterTeam/agent-skills
```

This installs the OpenRouter SDK skill, which teaches your AI assistant how
to use the SDK effectively.

## Supported AI Coding Assistants

The skill works with any AI coding assistant that supports the skills format:

| Assistant                                                     | Status    |
| ------------------------------------------------------------- | --------- |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | Supported |
| [OpenCode](https://opencode.ai)                               | Supported |
| [Cursor](https://cursor.com)                                  | Supported |
| [GitHub Copilot](https://github.com/features/copilot)         | Supported |
| [Codex](https://openai.com/index/openai-codex)                | Supported |
| [Amp](https://amp.dev)                                        | Supported |
| [Roo Code](https://roo.dev)                                   | Supported |
| [Antigravity](https://antigravity.dev)                        | Supported |

## What the Skill Provides

Once installed, your AI coding assistant will have knowledge of:

* **SDK Installation & Setup** - How to install and configure the OpenRouter
  SDK in TypeScript projects
* **callModel API** - The recommended approach for making AI model calls with
  full type safety and streaming support
* **Chat Completions** - Working with the chat API for conversations
* **Embeddings** - Generating embeddings for semantic search and RAG
* **Error Handling** - Proper error handling patterns and Result types
* **Streaming** - Real-time streaming responses
* **Tool Use** - Implementing function calling and tools

## Example Usage

After installing the skill, your AI assistant can help you with tasks like:

**"Help me set up OpenRouter in my project"**

The assistant will know to use:

```typescript
import { callModel } from '@openrouter/agent';

const response = await callModel({
  model: 'anthropic/claude-sonnet-4',
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
});
```

**"Add streaming to my OpenRouter call"**

The assistant understands the streaming API:

```typescript
import { callModel } from '@openrouter/agent';

const stream = await callModel({
  model: 'anthropic/claude-sonnet-4',
  messages: [{ role: 'user', content: 'Tell me a story' }],
  stream: true
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}
```

## Updating the Skill

To get the latest SDK documentation, re-run the install command:

```bash
npx add-skill OpenRouterTeam/agent-skills
```

The skill is automatically updated when new SDK versions are released.

## Manual Installation

If you prefer to install manually, add the skill file to your project's
`.skills/` directory:

```bash
mkdir -p .skills
curl -o .skills/openrouter-sdk.md \
  https://raw.githubusercontent.com/OpenRouterTeam/agent-skills/main/skills/typescript-sdk/SKILL.md
```

## Repository

The skill source is available at:
[github.com/OpenRouterTeam/agent-skills](https://github.com/OpenRouterTeam/agent-skills)

Contributions and feedback are welcome.
***

title: DevTools
subtitle: SDK Development Tools for telemetry capture and visualization
headline: DevTools | OpenRouter SDK
canonical-url: '[https://openrouter.ai/docs/sdks/devtools](https://openrouter.ai/docs/sdks/devtools)'
'og:site\_name': OpenRouter Documentation
'og:title': DevTools | OpenRouter SDK
'og:description': >-
Comprehensive development tools for the OpenRouter SDK. Capture telemetry,
visualize requests, and debug your AI applications with ease.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=DevTools\&description=SDK%20Development%20Tools%20for%20telemetry%20capture%20and%20visualization](https://openrouter.ai/dynamic-og?title=DevTools\&description=SDK%20Development%20Tools%20for%20telemetry%20capture%20and%20visualization)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

{/* banner:start */}

<Warning>
  The DevTools SDK and CLI are currently in pre-release status. DevTools is designed for development use only and should never be deployed in production environments.
</Warning>

{/* banner:end */}

The OpenRouter DevTools provide a comprehensive solution for SDK telemetry capture and visualization during development. Monitor your AI application's requests, responses, token usage, and errors in real-time with a beautiful web interface.

## Why use DevTools?

Building with AI SDKs requires visibility into what's happening under the hood. The OpenRouter DevTools give you complete insight into your SDK operations without adding complexity or impacting performance.

**Two main components:**

1. **SDK Telemetry Hooks** - Automatically capture all SDK operations in development
2. **DevTools Viewer** - Beautiful web UI for visualizing captured telemetry data

## Key Features

### SDK DevTools Viewer

Launch a web-based interface to visualize your SDK telemetry:

* **Real-time run tracking** - View all SDK operations (chat, embeddings, etc.) as they happen
* **Detailed step analysis** - Inspect request/response data, timing, and errors for each step
* **Token usage insights** - Track prompt and completion tokens across all requests
* **Error debugging** - Easily identify and debug failed requests with full error details
* **Multi-run comparison** - Compare different SDK runs side-by-side
* **Dark/Light mode** - Full theme support with automatic system preference detection

![DevTools Interface](file:542de9ac-5131-41fe-8f5d-85cbee5a5a53)

### SDK Telemetry Hooks

Developer-friendly hooks that automatically capture:

* All chat completions with full request/response data
* Token usage and costs
* Timing information for performance analysis
* Errors and failure modes
* Tool/function calls
* Current directory, git branch, and model information

## Installation

Install the DevTools package as a development dependency:

```bash
npm install @openrouter/devtools --save-dev
```

**Important:** DevTools is designed for development only. It will throw an error if `NODE_ENV === 'production'` to prevent accidental production deployment.

## Quick Start - SDK Hooks

Integrate DevTools hooks into your SDK client to start capturing telemetry:

### Basic Usage

```typescript
import { createOpenRouterDevtools } from '@openrouter/devtools';
import { OpenRouter } from '@openrouter/sdk';

const sdk = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  hooks: createOpenRouterDevtools()
});

// Now all SDK operations are automatically captured
const response = await sdk.chat.send({
  model: "openai/gpt-5",
  messages: [
    { role: "user", content: "Explain quantum computing" }
  ]
});
```

### Custom Configuration

```typescript
const sdk = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  hooks: createOpenRouterDevtools({
    storagePath: '.custom-path/generations.json',  // Default: '.devtools/openrouter-generations.json'
    serverUrl: 'http://localhost:5000/api/notify', // Default: 'http://localhost:4983/api/notify'
  })
});
```

## Quick Start - DevTools Viewer

Launch the DevTools web interface to visualize captured telemetry:

```bash
openrouter devtools
```

This starts a local server on port 4983 and opens your browser to view:

* All SDK runs with timestamps and status
* Step-by-step request/response details
* Token usage and costs
* Error messages and stack traces
* Performance timing information

The viewer automatically refreshes when new telemetry data is captured.

## How It Works

### Telemetry Capture Flow

1. SDK hooks intercept requests before they're sent
2. Telemetry data is captured asynchronously (non-blocking)
3. Data is stored in `.devtools/openrouter-generations.json`
4. A notification is sent to the local DevTools server (if running)
5. The DevTools viewer updates in real-time

### Non-Intrusive Design

* **Zero SDK impact** - Telemetry capture is async and never blocks SDK operations
* **Graceful degradation** - Errors in DevTools never break your SDK calls
* **Development-only** - Throws error if used in production (`NODE_ENV === 'production'`)

### Storage Location

By default, telemetry is stored in:

```
.devtools/openrouter-generations.json
```

This file contains:

* **Runs** - Top-level tracking of SDK operations
* **Steps** - Individual request/response pairs within each run
* **Metadata** - Timestamps, status, token usage, errors

## Configuration Options

### Hook Configuration

When calling `createOpenRouterDevtools()`, you can customize:

| Option        | Type     | Default                                   | Description                           |
| ------------- | -------- | ----------------------------------------- | ------------------------------------- |
| `storagePath` | `string` | `'.devtools/openrouter-generations.json'` | Where to store captured telemetry     |
| `serverUrl`   | `string` | `'http://localhost:4983/api/notify'`      | DevTools server notification endpoint |

### DevTools Server Configuration

The DevTools viewer runs on port 4983 by default. This can be configured in your OpenRouter CLI configuration at `~/.openrouter/claude-code-proxy.json`:

```json
{
  "DEVTOOLS_PORT": 4983
}
```

## Operations Captured

The DevTools hooks automatically capture these SDK operations:

* `chat.send()` - Chat completions API calls
* `chat.createResponses()` - Responses API calls
* `embeddings.create()` - Embeddings API calls

All other SDK operations are currently ignored.

## Data Captured Per Step

For each SDK operation, DevTools captures:

**Request Data:**

* Model name
* Messages/prompts
* Parameters (temperature, max\_tokens, etc.)

**Response Data:**

* Generated content
* Token usage (prompt + completion tokens)
* Provider and model used
* Finish reason
* Tool calls (if any)

**Metadata:**

* Start and completion timestamps
* Duration in milliseconds
* Status (success, error, in\_progress)
* Error details (if failed)

## Safety & Best Practices

### Production Environment Protection

DevTools will throw an error if initialized when `NODE_ENV === 'production'`:

```typescript
// This will throw an error in production
const sdk = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  hooks: createOpenRouterDevtools() // ERROR in production!
});
```

### Non-Blocking Architecture

* All telemetry capture happens asynchronously
* DevTools errors never propagate to your SDK calls
* Failed writes are logged but don't break your application

### Error Handling

DevTools failures are handled gracefully:

```typescript
// If DevTools fails, your SDK call still works
try {
  await sdk.chat.send({ /* ... */ });
  // SDK call succeeds even if DevTools capture fails
} catch (error) {
  // Only SDK errors are thrown, never DevTools errors
}
```

## Troubleshooting

### Port Already in Use

If port 4983 is already in use:

```bash
Error: listen EADDRINUSE: address already in use :::4983
```

**Solution:** Either stop the process using port 4983, or configure a different port in `~/.openrouter/claude-code-proxy.json`:

```json
{
  "DEVTOOLS_PORT": 5000
}
```

Then update your hook configuration:

```typescript
hooks: createOpenRouterDevtools({
  serverUrl: 'http://localhost:5000/api/notify'
})
```

### Storage Location Issues

If you can't find the telemetry file:

1. Check the default location: `.devtools/openrouter-generations.json`
2. Ensure you have write permissions in your working directory
3. Check for custom `storagePath` configuration

### DevTools Viewer Not Updating

If the viewer doesn't show new requests:

1. Verify the DevTools server is running (`openrouter devtools`)
2. Check that `serverUrl` matches the DevTools server port
3. Ensure the telemetry file is being written (check `.devtools/` directory)
4. Try refreshing the browser manually

### Common Setup Issues

**Issue:** DevTools package not found

```bash
Cannot find module '@openrouter/devtools'
```

**Solution:** Install the package:

```bash
npm install @openrouter/devtools --save-dev
```

***

**Issue:** Accidental production usage

```bash
Error: DevTools should not be used in production
```

**Solution:** Only initialize DevTools in development:

```typescript
const hooks = process.env.NODE_ENV === 'development'
  ? createOpenRouterDevtools()
  : undefined;

const sdk = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  hooks
});
```
***

title: TypeScript SDK
subtitle: Official OpenRouter TypeScript SDK documentation
headline: OpenRouter TypeScript SDK | Complete Documentation
canonical-url: '[https://openrouter.ai/docs/sdks/typescript](https://openrouter.ai/docs/sdks/typescript)'
'og:site\_name': OpenRouter Documentation
'og:title': OpenRouter TypeScript SDK | Complete Documentation
'og:description': >-
Complete guide to using the OpenRouter TypeScript SDK. Learn how to integrate
AI models into your TypeScript applications.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=TypeScript%20SDK\&description=Official%20OpenRouter%20TypeScript%20SDK%20documentation](https://openrouter.ai/dynamic-og?title=TypeScript%20SDK\&description=Official%20OpenRouter%20TypeScript%20SDK%20documentation)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouterAI'
noindex: false
nofollow: false
---------------

{/* banner:start */}

<Warning>
  The TypeScript SDK and docs are currently in beta.
  Report issues on [GitHub](https://github.com/OpenRouterTeam/typescript-sdk/issues).
</Warning>

{/* banner:end */}

The OpenRouter TypeScript SDK is a type-safe toolkit for building AI applications with access to 300+ language models through a unified API.

## Why use the OpenRouter SDK?

Integrating AI models into applications involves handling different provider APIs, managing model-specific requirements, and avoiding common implementation mistakes. The OpenRouter SDK standardizes these integrations and protects you from footguns.

```typescript
import OpenRouter from '@openrouter/sdk';

const client = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY
});

const response = await client.chat.send({
  model: "minimax/minimax-m2",
  messages: [
    { role: "user", content: "Explain quantum computing" }
  ]
});
```

The SDK provides three core benefits:

### Auto-generated from API specifications

The SDK is automatically generated from OpenRouter's OpenAPI specs and updated with every API change. New models, parameters, and features appear in your IDE autocomplete immediately. No manual updates. No version drift.

```typescript
// When new models launch, they're available instantly
const response = await client.chat.send({
  model: "minimax/minimax-m2",
});
```

### Type-safe by default

Every parameter, response field, and configuration option is fully typed. Invalid configurations are caught at compile time, not in production.

```typescript
const response = await client.chat.send({
  model: "minimax/minimax-m2",
  messages: [
    { role: "user", content: "Hello" }
    // ← Your IDE validates message structure
  ],
  temperature: 0.7, // ← Type-checked
  stream: true      // ← Response type changes based on this
});
```

**Actionable error messages:**

```typescript
// Instead of generic errors, get specific guidance:
// "Model 'openai/o1-preview' requires at least 2 messages.
//  You provided 1 message. Add a system or user message."
```

**Type-safe streaming:**

```typescript
const stream = await client.chat.send({
  model: "minimax/minimax-m2",
  messages: [{ role: "user", content: "Write a story" }],
  stream: true
});

for await (const chunk of stream) {
  // Full type information for streaming responses
  const content = chunk.choices[0]?.delta?.content;
}
```

## Installation

```bash
npm install @openrouter/sdk
```

Get your API key from [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys).

## Quick start

```typescript
import OpenRouter from '@openrouter/sdk';

const client = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY
});

const response = await client.chat.send({
  model: "minimax/minimax-m2",
  messages: [
    { role: "user", content: "Hello!" }
  ]
});

console.log(response.choices[0].message.content);
```
***

title: Call Model (Typescript)
subtitle: >-
A unified API for calling any LLM with automatic tool execution and multiple
consumption patterns
headline: Call Model Overview (Typescript) | OpenRouter SDK
canonical-url: '[https://openrouter.ai/docs/sdks/typescript/call-model/overview](https://openrouter.ai/docs/sdks/typescript/call-model/overview)'
'og:site\_name': OpenRouter Documentation
'og:title': Call Model Overview (Typescript) - OpenRouter SDK
'og:description': >-
Learn how to use callModel for text generation, streaming, and tool calling
with automatic execution. Access 300+ LLMs through a single API.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Call%20Model%20Overview%20(Typescript)\&description=Unified%20LLM%20API%20with%20Tools](https://openrouter.ai/dynamic-og?title=Call%20Model%20Overview%20\(Typescript\)\&description=Unified%20LLM%20API%20with%20Tools)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

## Why callModel?

* **Items-Based Model**: Built on OpenRouter's Responses API with structured
  items (messages, tool calls, reasoning) instead of raw message chunks
* **Multiple Consumption Patterns**: Get text, stream responses, or access
  structured data - all from a single call
* **Automatic Tool Execution**: Define tools with Zod schemas and let the SDK
  handle execution loops
* **Type Safety**: Full TypeScript inference for tool inputs, outputs, and
  events
* **Format Compatibility**: Convert to/from OpenAI chat and Anthropic Claude
  message formats
* **Streaming First**: Built on a reusable stream architecture that supports
  concurrent consumers

## Quick Start

```typescript
import { OpenRouter } from '@openrouter/agent';

const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'What is the capital of France?',
});

// Get text (simplest pattern)
const text = await result.getText();
console.log(text); // "The capital of France is Paris."
```

## Consumption Patterns

callModel returns a `ModelResult` object that provides multiple ways to consume
the response:

### Text Methods

```typescript
// Get just the text content
const text = await result.getText();

// Get the full response with usage data
const response = await result.getResponse();
console.log(response.usage); // { inputTokens, outputTokens, cachedTokens }
```

### Streaming Methods

```typescript
// Stream text deltas
for await (const delta of result.getTextStream()) {
  process.stdout.write(delta);
}

// Stream reasoning (for reasoning models)
for await (const delta of result.getReasoningStream()) {
  console.log('Reasoning:', delta);
}

// Stream complete items by ID (recommended)
for await (const item of result.getItemsStream()) {
  console.log('Item update:', item.type, item.id);
}

// Stream all events (including tool preliminary results)
for await (const event of result.getFullResponsesStream()) {
  console.log('Event:', event.type);
}
```

### Tool Methods

```typescript
// Get all tool calls from the response
const toolCalls = await result.getToolCalls();

// Stream tool calls as they complete
for await (const toolCall of result.getToolCallsStream()) {
  console.log(`Tool: ${toolCall.name}`, toolCall.arguments);
}

// Stream tool deltas and preliminary results
for await (const event of result.getToolStream()) {
  if (event.type === 'delta') {
    process.stdout.write(event.content);
  } else if (event.type === 'preliminary_result') {
    console.log('Progress:', event.result);
  }
}
```

## Input Formats

callModel accepts multiple input formats:

```typescript
// Simple string
const result1 = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Hello!',
});

// Message array (OpenResponses format)
const result2 = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: [
    { role: 'user', content: 'Hello!' },
  ],
});

// With system instructions
const result3 = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  instructions: 'You are a helpful assistant.',
  input: 'Hello!',
});
```

## What's Next?

Explore the guides to learn more about specific features:

* **[Working with Items](/docs/sdks/typescript/call-model/items)** - Understand
  the items-based streaming paradigm
* **[Text Generation](/docs/sdks/typescript/call-model/text-generation)** -
  Input formats, model selection, and response handling
* **[Streaming](/docs/sdks/typescript/call-model/streaming)** - All streaming
  methods and patterns
* **[Tools](/docs/sdks/typescript/call-model/tools)** - Creating typed tools
  with Zod schemas and multi-turn orchestration
* **[nextTurnParams](/docs/sdks/typescript/call-model/next-turn-params)** -
  Tool-driven context injection for skills and plugins
* **[Message Formats](/docs/sdks/typescript/call-model/message-formats)** -
  Converting to/from OpenAI and Claude formats
* **[Dynamic Parameters](/docs/sdks/typescript/call-model/dynamic-parameters)**
  \- Async functions for adaptive behavior
* **[Stop Conditions](/docs/sdks/typescript/call-model/stop-conditions)** -
  Intelligent execution control
* **[API Reference](/docs/sdks/typescript/call-model/api-reference)** - Complete
  type definitions and method signatures

### Example Tools

Ready-to-use tool implementations:

* **[Weather Tool](/docs/sdks/typescript/call-model/examples/weather-tool)** - Basic API integration
* **[Skills Loader](/docs/sdks/typescript/call-model/examples/skills-loader)** - Claude Code skills pattern
***

title: Working with Items
subtitle: Understanding the items-based streaming paradigm for callModel
headline: Working with Items | OpenRouter SDK
canonical-url: '[https://openrouter.ai/docs/sdks/typescript/call-model/items](https://openrouter.ai/docs/sdks/typescript/call-model/items)'
'og:site\_name': OpenRouter Documentation
'og:title': Working with Items - OpenRouter SDK
'og:description': >-
Learn the items-based streaming paradigm for callModel. Replace items by ID
instead of accumulating chunks for simpler React state management.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Working%20with%20Items\&description=Items-Based%20Streaming](https://openrouter.ai/dynamic-og?title=Working%20with%20Items\&description=Items-Based%20Streaming)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

## The Items Paradigm

`callModel` is built on OpenRouter's Responses API which uses an **items-based
model** rather than the messages-based model used by OpenAI Chat or Vercel AI
SDK.

The key insight: **items are emitted multiple times with the same ID but
progressively updated content**. You replace the entire item by ID rather than
accumulating stream chunks.

## Messages vs Items

| Traditional (OpenAI Chat, Vercel AI) | callModel (Items-native)    |
| ------------------------------------ | --------------------------- |
| Stream chunks, accumulate text       | Stream items, replace by ID |
| Single message type                  | Multiple item types         |
| Reconstruct content at end           | Each emission is complete   |
| Manual state management              | Natural React state updates |

## Item Types

`getItemsStream()` yields these item types:

| Type                    | Description                        |
| ----------------------- | ---------------------------------- |
| `message`               | Assistant text responses           |
| `function_call`         | Tool invocations with arguments    |
| `reasoning`             | Model thinking (extended thinking) |
| `web_search_call`       | Web search operations              |
| `file_search_call`      | File search operations             |
| `image_generation_call` | Image generation operations        |
| `function_call_output`  | Results from executed tools        |

## How Streaming Works

Each iteration yields a **complete item** with the same ID but updated content:

```typescript
// Iteration 1
{
  id: "msg_123",
  type: "message",
  content: [{ type: "output_text", text: "Hello" }]
}

// Iteration 2
{
  id: "msg_123",
  type: "message",
  content: [{ type: "output_text", text: "Hello world" }]
}

// Iteration 3
{
  id: "msg_123",
  type: "message",
  content: [{ type: "output_text", text: "Hello world!" }]
}
```

The same pattern applies to function calls:

```typescript
// Iteration 1
{ type: "function_call", callId: "call_456", arguments: "{\"q" }

// Iteration 2
{
  type: "function_call",
  callId: "call_456",
  arguments: "{\"query\": \"weather"
}

// Iteration 3
{
  type: "function_call",
  callId: "call_456",
  arguments: "{\"query\": \"weather in Paris\"}"
}
```

## React Integration

The items paradigm eliminates manual chunk accumulation. Use a Map keyed by
item ID and let React's reconciliation handle updates:

```tsx
import { useState } from 'react';
import type { StreamableOutputItem } from '@openrouter/agent';
import { OpenRouter } from '@openrouter/agent';

const client = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

function Chat() {
  const [items, setItems] = useState<Map<string, StreamableOutputItem>>(
    new Map()
  );

  async function handleSubmit(input: string) {
    const result = client.callModel({
      model: 'anthropic/claude-sonnet-4',
      input,
    });

    for await (const item of result.getItemsStream()) {
      // Replace the entire item by ID - React re-renders automatically
      setItems((prev) => new Map(prev).set(item.id, item));
    }
  }

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); handleSubmit(input); }}>
        {/* input field */}
      </form>
      <div>
        {[...items.values()].map((item) => (
          <ItemRenderer key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function ItemRenderer({ item }: { item: StreamableOutputItem }) {
  switch (item.type) {
    case 'message':
      return <MessageItem message={item} />;
    case 'function_call':
      return <ToolCallItem call={item} />;
    case 'reasoning':
      return <ReasoningItem reasoning={item} />;
    default:
      return null;
  }
}
```

### Benefits

* **No chunk accumulation** - Each item emission is complete
* **Natural React updates** - Setting state triggers re-render automatically
* **Concurrent item handling** - Function calls and messages stream in parallel
* **Works with React 18+** - Compatible with concurrent features and Suspense
* **Type-safe** - Full TypeScript inference for all item types

## Comparison with Chunk Accumulation

Traditional streaming requires manual accumulation:

```tsx
// Traditional approach - manual accumulation
const [text, setText] = useState('');

for await (const chunk of result.getTextStream()) {
  setText((prev) => prev + chunk); // Must accumulate manually
}
```

With items, each emission replaces the previous:

```tsx
// Items approach - replace by ID
for await (const item of result.getItemsStream()) {
  setItems((prev) => new Map(prev).set(item.id, item)); // Complete replacement
}
```

The items approach is especially powerful when the model produces multiple
outputs simultaneously (e.g., thinking + tool calls + text).

## Migrating from getNewMessagesStream()

`getNewMessagesStream()` is deprecated in favor of `getItemsStream()`. The
migration is straightforward:

```typescript
// Before (deprecated)
for await (const message of result.getNewMessagesStream()) {
  if (message.type === 'message') {
    console.log(message.content);
  }
}

// After
for await (const item of result.getItemsStream()) {
  if (item.type === 'message') {
    console.log(item.content);
  }
}
```

The key difference: `getItemsStream()` includes all item types (reasoning,
function calls, etc.), not just messages.

## Next Steps

* **[Streaming](/docs/sdks/typescript/call-model/streaming)** - All streaming
  methods including getItemsStream()
* **[Tools](/docs/sdks/typescript/call-model/tools)** - Creating typed tools
  with Zod schemas
***

title: API Reference
subtitle: >-
Complete reference for the callModel API, ModelResult class, tool types, and
helper functions.
headline: API Reference | OpenRouter SDK
canonical-url: '[https://openrouter.ai/docs/sdks/typescript/call-model/api-reference](https://openrouter.ai/docs/sdks/typescript/call-model/api-reference)'
'og:site\_name': OpenRouter Documentation
'og:title': API Reference - OpenRouter SDK
'og:description': >-
Complete API reference for callModel, ModelResult, tool types, and helper
functions in the OpenRouter SDK.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=API%20Reference\&description=Complete%20Type%20Reference](https://openrouter.ai/dynamic-og?title=API%20Reference\&description=Complete%20Type%20Reference)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

## callModel

```typescript
function callModel(request: CallModelInput, options?: RequestOptions): ModelResult
```

Creates a response using the OpenResponses API with multiple consumption patterns.

### CallModelInput

| Parameter            | Type                                       | Required | Description                          |
| -------------------- | ------------------------------------------ | -------- | ------------------------------------ |
| `model`              | `string \| ((ctx: TurnContext) => string)` | Yes\*    | Model ID (e.g., "openai/gpt-5-nano") |
| `models`             | `string[]`                                 | Yes\*    | Model fallback array                 |
| `input`              | `OpenResponsesInput`                       | Yes      | Input messages or string             |
| `instructions`       | `string \| ((ctx: TurnContext) => string)` | No       | System instructions                  |
| `tools`              | `Tool[]`                                   | No       | Tools available to the model         |
| `maxToolRounds`      | `MaxToolRounds`                            | No       | Tool execution limit (deprecated)    |
| `stopWhen`           | `StopWhen`                                 | No       | Stop conditions                      |
| `temperature`        | `number \| ((ctx: TurnContext) => number)` | No       | Sampling temperature (0-2)           |
| `maxOutputTokens`    | `number \| ((ctx: TurnContext) => number)` | No       | Maximum tokens to generate           |
| `topP`               | `number`                                   | No       | Top-p sampling                       |
| `text`               | `ResponseTextConfig`                       | No       | Text format configuration            |
| `provider`           | `ProviderPreferences`                      | No       | Provider routing and configuration   |
| `topK`               | `number`                                   | No       | Top-k sampling                       |
| `metadata`           | `Record<string, string>`                   | No       | Request metadata                     |
| `toolChoice`         | `ToolChoice`                               | No       | Tool choice configuration            |
| `parallelToolCalls`  | `boolean`                                  | No       | Enable parallel tool calling         |
| `reasoning`          | `ReasoningConfig`                          | No       | Reasoning configuration              |
| `promptCacheKey`     | `string`                                   | No       | Cache key for prompt caching         |
| `previousResponseId` | `string`                                   | No       | Context from previous response       |
| `include`            | `string[]`                                 | No       | Include extra fields in response     |
| `background`         | `boolean`                                  | No       | Run request in background            |
| `safetyIdentifier`   | `string`                                   | No       | User safety identifier               |
| `serviceTier`        | `string`                                   | No       | Service tier preference              |
| `truncation`         | `string`                                   | No       | Truncation mode                      |
| `plugins`            | `Plugin[]`                                 | No       | Enabled plugins                      |
| `user`               | `string`                                   | No       | End-user identifier                  |
| `sessionId`          | `string`                                   | No       | Session identifier                   |
| `store`              | `boolean`                                  | No       | Store request data                   |
| `context`            | `ContextInput<ToolContextMap>`             | No       | Tool context keyed by tool name      |

\*Either `model` or `models` is required.

### ProviderPreferences

Configuration for routing and provider selection.

| Parameter                | Type                | Description                                                        |
| ------------------------ | ------------------- | ------------------------------------------------------------------ |
| `allowFallbacks`         | `boolean`           | Allow backup providers when primary is unavailable (default: true) |
| `requireParameters`      | `boolean`           | Only use providers that support all requested parameters           |
| `dataCollection`         | `"allow" \| "deny"` | Data collection policy (allow/deny)                                |
| `order`                  | `string[]`          | Custom provider routing order                                      |
| `only`                   | `string[]`          | Restrict to specific providers                                     |
| `ignore`                 | `string[]`          | Exclude specific providers                                         |
| `quantizations`          | `string[]`          | Filter by quantization levels                                      |
| `sort`                   | `string`            | Load balancing strategy (e.g., "throughput")                       |
| `maxPrice`               | `object`            | Maximum price limits                                               |
| `preferredMinThroughput` | `number`            | Minimum tokens per second preference                               |
| `preferredMaxLatency`    | `number`            | Maximum latency preference                                         |

### RequestOptions

| Parameter | Type          | Description                     |
| --------- | ------------- | ------------------------------- |
| `timeout` | `number`      | Request timeout in milliseconds |
| `signal`  | `AbortSignal` | Abort signal for cancellation   |

***

## ModelResult

Wrapper providing multiple consumption patterns for a response.

### Methods

#### getText()

```typescript
getText(): Promise<string>
```

Get text content after tool execution completes.

#### getResponse()

```typescript
getResponse(): Promise<OpenResponsesNonStreamingResponse>
```

Get full response with usage data (inputTokens, outputTokens, cachedTokens).

#### getTextStream()

```typescript
getTextStream(): AsyncIterableIterator<string>
```

Stream text deltas.

#### getReasoningStream()

```typescript
getReasoningStream(): AsyncIterableIterator<string>
```

Stream reasoning deltas (for reasoning models).

#### getNewMessagesStream()

```typescript
getNewMessagesStream(): AsyncIterableIterator<ResponsesOutputMessage | OpenResponsesFunctionCallOutput>
```

Stream cumulative message snapshots in OpenResponses format.

#### getFullResponsesStream()

```typescript
getFullResponsesStream(): AsyncIterableIterator<EnhancedResponseStreamEvent>
```

Stream all events including tool preliminary results.

#### getToolCalls()

```typescript
getToolCalls(): Promise<ParsedToolCall[]>
```

Get all tool calls from initial response.

#### getToolCallsStream()

```typescript
getToolCallsStream(): AsyncIterableIterator<ParsedToolCall>
```

Stream tool calls as they complete.

#### getToolStream()

```typescript
getToolStream(): AsyncIterableIterator<ToolStreamEvent>
```

Stream tool deltas and preliminary results.

#### getContextUpdates()

```typescript
getContextUpdates(): AsyncGenerator<ToolContextMap<TTools>>
```

Stream context snapshots whenever a tool calls
`setContext()`. Completes when tool execution finishes.

#### cancel()

```typescript
cancel(): Promise<void>
```

Cancel the stream and all consumers.

***

## Tool Types

### tool()

```typescript
function tool<TInput, TOutput>(config: ToolConfig): Tool
```

Create a typed tool with Zod schema validation.

### ToolConfig

| Parameter        | Type                      | Required | Description                            |
| ---------------- | ------------------------- | -------- | -------------------------------------- |
| `name`           | `string`                  | Yes      | Tool name                              |
| `description`    | `string`                  | No       | Tool description                       |
| `inputSchema`    | `ZodObject`               | Yes      | Input parameter schema                 |
| `outputSchema`   | `ZodType`                 | No       | Output schema                          |
| `eventSchema`    | `ZodType`                 | No       | Event schema (triggers generator mode) |
| `contextSchema`  | `ZodObject`               | No       | Context data this tool needs           |
| `execute`        | `function \| false`       | Yes      | Execute function or false for manual   |
| `nextTurnParams` | `NextTurnParamsFunctions` | No       | Parameters to modify next turn         |

### Tool

Union type of all tool types:

```typescript
type Tool =
  | ToolWithExecute<ZodObject, ZodType>
  | ToolWithGenerator<ZodObject, ZodType, ZodType>
  | ManualTool<ZodObject, ZodType>;
```

### ToolWithExecute

Regular tool with execute function:

```typescript
interface ToolWithExecute<
  TInput, TOutput, TContext, TName
> {
  type: ToolType.Function;
  function: {
    name: TName;
    description?: string;
    inputSchema: TInput;
    outputSchema?: TOutput;
    contextSchema?: ZodObject;
    execute: (
      params: z.infer<TInput>,
      context: ToolExecuteContext<TName, TContext>,
    ) => Promise<z.infer<TOutput>>;
  };
}
```

### ToolWithGenerator

Generator tool with eventSchema:

```typescript
interface ToolWithGenerator<
  TInput, TEvent, TOutput, TContext, TName
> {
  type: ToolType.Function;
  function: {
    name: TName;
    description?: string;
    inputSchema: TInput;
    eventSchema: TEvent;
    outputSchema: TOutput;
    contextSchema?: ZodObject;
    execute: (
      params: z.infer<TInput>,
      context: ToolExecuteContext<TName, TContext>,
    ) => AsyncGenerator<z.infer<TEvent>>;
  };
}
```

### ManualTool

Tool without execute function:

```typescript
interface ManualTool<TInput, TOutput> {
  type: ToolType.Function;
  function: {
    name: string;
    description?: string;
    inputSchema: TInput;
    outputSchema?: TOutput;
  };
}
```

***

## Context Types

### TurnContext

```typescript
interface TurnContext {
  toolCall?: OpenResponsesFunctionToolCall;
  numberOfTurns: number;
  turnRequest?: OpenResponsesRequest;
}
```

### ToolExecuteContext

Flat context passed to tool execute functions.
Merges `TurnContext` fields with tool-specific context:

```typescript
type ToolExecuteContext<TName, TContext> =
  TurnContext & {
    tools: {
      readonly [K in TName]: Readonly<TContext>;
    };
    setContext(partial: Partial<TContext>): void;
  };
```

### ToolContextMap

Context map for `callModel`'s `context` option,
keyed by tool name:

```typescript
type ToolContextMap<T extends readonly Tool[]> = {
  [K in T[number] as K['function']['name']]:
    InferToolContext<K>;
};
```

### ContextInput

Context can be static, a sync function,
or an async function:

```typescript
type ContextInput<T> =
  | T
  | ((turn: TurnContext) => T)
  | ((turn: TurnContext) => Promise<T>);
```

### NextTurnParamsContext

```typescript
interface NextTurnParamsContext {
  input: OpenResponsesInput;
  model: string;
  models: string[];
  temperature: number | null;
  maxOutputTokens: number | null;
  topP: number | null;
  topK?: number | undefined;
  instructions: string | null;
}
```

***

## Stream Event Types

### EnhancedResponseStreamEvent

```typescript
type EnhancedResponseStreamEvent =
  | OpenResponsesStreamEvent
  | ToolPreliminaryResultEvent;
```

### ToolStreamEvent

```typescript
type ToolStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'preliminary_result'; toolCallId: string; result: unknown };
```

### ParsedToolCall

```typescript
interface ParsedToolCall {
  id: string;
  name: string;
  arguments: unknown;
}
```

### ToolExecutionResult

```typescript
interface ToolExecutionResult {
  toolCallId: string;
  toolName: string;
  result: unknown;
  preliminaryResults?: unknown[];
  error?: Error;
}
```

***

## Stop Conditions

### StopWhen

```typescript
type StopWhen =
  | StopCondition
  | StopCondition[];
```

### StopCondition

```typescript
type StopCondition = (context: StopConditionContext) => boolean | Promise<boolean>;
```

### StopConditionContext

```typescript
interface StopConditionContext {
  steps: StepResult[];
}
```

### StepResult

```typescript
interface StepResult {
  stepType: 'initial' | 'continue';
  text: string;
  toolCalls: TypedToolCallUnion[];
  toolResults: ToolExecutionResultUnion[];
  response: OpenResponsesNonStreamingResponse;
  usage?: OpenResponsesUsage;
  finishReason?: string;
  warnings?: Warning[];
  experimental_providerMetadata?: Record<string, unknown>;
}
```

### Warning

```typescript
interface Warning {
  type: string;
  message: string;
}
```

### Built-in Helpers

| Function         | Signature                           | Description              |
| ---------------- | ----------------------------------- | ------------------------ |
| `stepCountIs`    | `(n: number) => StopCondition`      | Stop after n steps       |
| `hasToolCall`    | `(name: string) => StopCondition`   | Stop when tool is called |
| `maxTokensUsed`  | `(n: number) => StopCondition`      | Stop after n tokens      |
| `maxCost`        | `(amount: number) => StopCondition` | Stop after cost limit    |
| `finishReasonIs` | `(reason: string) => StopCondition` | Stop on finish reason    |

***

## Format Helpers

### fromChatMessages

```typescript
function fromChatMessages(messages: Message[]): OpenResponsesInput
```

Convert OpenAI chat format to OpenResponses input.

### toChatMessage

```typescript
function toChatMessage(response: OpenResponsesNonStreamingResponse): AssistantMessage
```

Convert response to chat message format.

### fromClaudeMessages

```typescript
function fromClaudeMessages(messages: ClaudeMessageParam[]): OpenResponsesInput
```

Convert Anthropic Claude format to OpenResponses input.

### toClaudeMessage

```typescript
function toClaudeMessage(response: OpenResponsesNonStreamingResponse): ClaudeMessage
```

Convert response to Claude message format.

***

## Type Utilities

### InferToolInput

```typescript
type InferToolInput<T> = T extends { function: { inputSchema: infer S } }
  ? S extends ZodType ? z.infer<S> : unknown
  : unknown;
```

### InferToolOutput

```typescript
type InferToolOutput<T> = T extends { function: { outputSchema: infer S } }
  ? S extends ZodType ? z.infer<S> : unknown
  : unknown;
```

### InferToolEvent

```typescript
type InferToolEvent<T> = T extends { function: { eventSchema: infer S } }
  ? S extends ZodType ? z.infer<S> : never
  : never;
```

### TypedToolCall

```typescript
type TypedToolCall<T extends Tool> = {
  id: string;
  name: T extends { function: { name: infer N } } ? N : string;
  arguments: InferToolInput<T>;
};
```

***

## Exports

```typescript
// Agent client
export { OpenRouter } from '@openrouter/agent';

// Tool helpers
export { tool, ToolType } from '@openrouter/agent';

// Format helpers
export { fromChatMessages, toChatMessage, fromClaudeMessages, toClaudeMessage } from '@openrouter/agent';

// Stop condition helpers
export { stepCountIs, hasToolCall, maxTokensUsed, maxCost, finishReasonIs } from '@openrouter/agent';

// Context helpers
export {
  buildToolExecuteContext,
  ToolContextStore,
} from '@openrouter/agent';

// Types
export type {
  CallModelInput,
  ContextInput,
  Tool,
  ToolWithExecute,
  ToolWithGenerator,
  ManualTool,
  ToolExecuteContext,
  ToolContextMap,
  TurnContext,
  ParsedToolCall,
  ToolExecutionResult,
  StopCondition,
  StopWhen,
  InferToolInput,
  InferToolOutput,
  InferToolEvent,
} from '@openrouter/agent';
```
***

title: Dynamic Parameters
subtitle: Use async functions for adaptive model behavior across turns
headline: Dynamic Parameters | OpenRouter SDK
canonical-url: '[https://openrouter.ai/docs/sdks/typescript/call-model/dynamic-parameters](https://openrouter.ai/docs/sdks/typescript/call-model/dynamic-parameters)'
'og:site\_name': OpenRouter Documentation
'og:title': Dynamic Parameters - OpenRouter SDK
'og:description': >-
Use async functions to dynamically compute callModel parameters. Adapt model
selection, temperature, and instructions based on conversation state.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Dynamic%20Parameters\&description=Adaptive%20Model%20Behavior](https://openrouter.ai/dynamic-og?title=Dynamic%20Parameters\&description=Adaptive%20Model%20Behavior)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

## Basic Usage

Any parameter in `callModel` can be a function that computes its value based on conversation context. This enables adaptive behavior - changing models, adjusting temperature, or modifying instructions as the conversation evolves.

Pass a function instead of a static value:

```typescript
import { OpenRouter } from '@openrouter/agent';

const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const result = openrouter.callModel({
  // Dynamic model selection based on turn count
  model: (ctx) => {
    return ctx.numberOfTurns > 3 ? 'openai/gpt-5.2' : 'openai/gpt-5-nano';
  },
  input: 'Hello!',
  tools: [myTool],
});
```

## Function Signature

Parameter functions receive a `TurnContext` and return the parameter value:

```typescript
type ParameterFunction<T> = (context: TurnContext) => T | Promise<T>;
```

### TurnContext

| Property        | Type                                         | Description                                                   |
| --------------- | -------------------------------------------- | ------------------------------------------------------------- |
| `numberOfTurns` | `number`                                     | Current turn number (1-indexed)                               |
| `turnRequest`   | `OpenResponsesRequest \| undefined`          | Current request object containing messages and model settings |
| `toolCall`      | `OpenResponsesFunctionToolCall \| undefined` | The specific tool call being executed                         |

## Async Functions

Functions can be async for fetching external data:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',

  // Fetch user preferences from database
  temperature: async (ctx) => {
    const prefs = await fetchUserPreferences(userId);
    return prefs.preferredTemperature ?? 0.7;
  },

  // Load dynamic instructions
  instructions: async (ctx) => {
    const rules = await fetchBusinessRules();
    return `Follow these rules:\n${rules.join('\n')}`;
  },

  input: 'Hello!',
});
```

## Common Patterns

### Progressive Model Upgrade

Start with a fast model, upgrade for complex tasks:

```typescript
const result = openrouter.callModel({
  model: (ctx) => {
    // First few turns: fast model
    if (ctx.numberOfTurns <= 2) {
      return 'openai/gpt-5-nano';
    }

    // Complex conversations: capable model
    return 'openai/gpt-5.2';
  },
  input: 'Let me think through this problem...',
  tools: [analysisTool],
});
```

### Adaptive Temperature

Adjust creativity based on context:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  temperature: (ctx) => {
    // Analyze recent messages for task type
    const lastMessage = JSON.stringify(ctx.turnRequest?.input).toLowerCase();

    if (lastMessage.includes('creative') || lastMessage.includes('brainstorm')) {
      return 1.0; // Creative tasks
    }
    if (lastMessage.includes('code') || lastMessage.includes('calculate')) {
      return 0.2; // Precise tasks
    }
    return 0.7; // Default
  },
  input: 'Write a creative story',
});
```

### Context-Aware Instructions

Build instructions based on conversation state:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  instructions: (ctx) => {
    const base = 'You are a helpful assistant.';
    const turnInfo = `This is turn ${ctx.numberOfTurns} of the conversation.`;

    // Add context based on history length
    if (ctx.numberOfTurns > 5) {
      return `${base}\n${turnInfo}\nKeep responses concise - this is a long conversation.`;
    }

    return `${base}\n${turnInfo}`;
  },
  input: 'Continue helping me...',
  tools: [helpTool],
});
```

### Dynamic Max Tokens

Adjust output length based on task:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  maxOutputTokens: (ctx) => {
    const lastMessage = JSON.stringify(ctx.turnRequest?.input).toLowerCase();

    if (lastMessage.includes('summarize') || lastMessage.includes('brief')) {
      return 200;
    }
    if (lastMessage.includes('detailed') || lastMessage.includes('explain')) {
      return 2000;
    }
    return 500;
  },
  input: 'Give me a detailed explanation',
});
```

### Feature Flags

Enable features dynamically:

```typescript
const result = openrouter.callModel({
  model: 'anthropic/claude-sonnet-4.5',

  // Enable thinking for complex turns
  provider: async (ctx) => {
    const enableThinking = ctx.numberOfTurns > 2;

    return enableThinking ? {
      anthropic: {
        thinking: { type: 'enabled', budgetTokens: 1000 },
      },
    } : undefined;
  },

  input: 'Solve this complex problem',
  tools: [analysisTool],
});
```

## Combining with Tools

Dynamic parameters work alongside tool execution:

```typescript
const smartAssistant = openrouter.callModel({
  // Upgrade model if tools have been used
  model: (ctx) => {
    const hasToolUse = JSON.stringify(ctx.turnRequest?.input).includes('function_call');
    return hasToolUse ? 'anthropic/claude-sonnet-4.5' : 'openai/gpt-5-nano';
  },

  // Lower temperature after tool execution
  temperature: (ctx) => {
    return ctx.numberOfTurns > 1 ? 0.3 : 0.7;
  },

  input: 'Research and analyze this topic',
  tools: [searchTool, analysisTool],
});
```

## Execution Order

Dynamic parameters are resolved at the start of each turn:

```
1. Resolve all parameter functions with current TurnContext
2. Build request with resolved values
3. Send to model
4. Execute tools (if any)
5. Check stop conditions
6. Update TurnContext for next turn
7. Repeat from step 1
```

## Error Handling

Handle errors in async parameter functions:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',

  instructions: async (ctx) => {
    try {
      const rules = await fetchRules();
      return `Follow these rules: ${rules}`;
    } catch (error) {
      // Fallback on error
      console.error('Failed to fetch rules:', error);
      return 'You are a helpful assistant.';
    }
  },

  input: 'Hello!',
});
```

## Best Practices

### Keep Functions Pure

Avoid side effects in parameter functions:

```typescript
// Good: Pure function
model: (ctx) => ctx.numberOfTurns > 3 ? 'gpt-4' : 'gpt-4o-mini',

// Avoid: Side effects
model: (ctx) => {
  logToDatabase(ctx); // Side effect
  return 'gpt-4';
},
```

### Cache Expensive Operations

Cache results for repeated calls:

```typescript
let cachedRules: string | null = null;

const result = openrouter.callModel({
  instructions: async (ctx) => {
    if (!cachedRules) {
      cachedRules = await fetchExpensiveRules();
    }
    return cachedRules;
  },
  input: 'Hello!',
});
```

### Use Sensible Defaults

Always have fallback values:

```typescript
model: (ctx) => {
  const preferredModel = getPreferredModel();
  return preferredModel ?? 'openai/gpt-5-nano'; // Default fallback
},
```

## See Also

* **[nextTurnParams](/docs/sdks/call-model/next-turn-params)** - Tool-driven parameter modification
* **[Stop Conditions](/docs/sdks/call-model/stop-conditions)** - Dynamic execution control
* **[Tools](/docs/sdks/call-model/tools)** - Multi-turn orchestration
***

title: Next Turn Params
subtitle: >-
Build encapsulated, context-aware tools with `nextTurnParams`. Create skills
systems, plugins, and adaptive multi-turn agents.
headline: Next Turn Params | OpenRouter SDK
canonical-url: '[https://openrouter.ai/docs/sdks/typescript/call-model/next-turn-params](https://openrouter.ai/docs/sdks/typescript/call-model/next-turn-params)'
'og:site\_name': OpenRouter Documentation
'og:title': Next Turn Params - OpenRouter SDK
'og:description': >-
Build encapsulated, context-aware tools with nextTurnParams. Create skills
systems, plugins, and adaptive multi-turn agents.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Next%20Turn%20Params\&description=Tool-Driven%20Context%20Injection](https://openrouter.ai/dynamic-og?title=Next%20Turn%20Params\&description=Tool-Driven%20Context%20Injection)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

## Why nextTurnParams?

Traditional tool execution returns results to the model, but sometimes you need more:

* **Skills/Plugins**: Load domain-specific instructions when a skill is activated
* **Progressive Context**: Build up context as tools are used
* **Adaptive Behavior**: Adjust model parameters based on tool results
* **Clean Separation**: Tools manage their own context requirements

With `nextTurnParams`, tools can modify any `callModel` parameter for the next turn.

## Basic Example

```typescript
import { tool } from '@openrouter/agent';
import { z } from 'zod';

const expertModeTool = tool({
  name: 'enable_expert_mode',
  description: 'Enable expert mode for detailed technical responses',
  inputSchema: z.object({
    domain: z.string().describe('Technical domain (e.g., "kubernetes", "react")'),
  }),
  outputSchema: z.object({ enabled: z.boolean() }),

  nextTurnParams: {
    instructions: (params, context) => {
      const base = context.instructions ?? '';
      return `${base}

EXPERT MODE ENABLED for ${params.domain}:
- Provide detailed technical explanations
- Include code examples and best practices
- Reference official documentation
- Assume advanced knowledge`;
    },
    temperature: () => 0.3, // More precise for technical content
  },

  execute: async (params) => {
    return { enabled: true };
  },
});
```

## The Claude Code Skills Pattern

This example shows how to recreate Claude Code's skills system as a single encapsulated tool:

```typescript
import { tool } from '@openrouter/agent';
import { readFileSync } from 'fs';
import { z } from 'zod';

const skillsTool = tool({
  name: "skill",
  description: `Load a specialized skill to enhance the assistant's capabilities.
Available skills: pdf-processing, data-analysis, code-review, etc.
Each skill provides domain-specific instructions and capabilities.`,
  inputSchema: z.object({
    type: z.string().describe("The skill type to load (e.g., 'pdf-processing')"),
  }),
  outputSchema: z.string(),

  // nextTurnParams runs after all tool calls execute, before responses go to model
  // Executed in order of tools array. This is where the magic happens.
  nextTurnParams: {
    input: (params, context) => {
      // Prevent duplicate skill loading
      if (JSON.stringify(context.input).includes(`Skill ${params.type} is already loaded`)) {
        return context.input;
      }

      // Load the skill's instructions from file system
      const skill = readFileSync(
        `~/.claude/skills/${params.type}/SKILL.md`,
        "utf-8"
      );

      // Inject skill context into the conversation
      return [
        ...context.input,
        {
          role: "user",
          content: `Base directory for this skill: ~/.claude/skills/${params.type}/

${skill}`,
        },
      ];
    },
  },

  execute: async (params, context) => {
    // Check if already loaded
    if (JSON.stringify(context.input).includes(`Skill ${params.type} is already loaded`)) {
      return `Skill ${params.type} is already loaded`;
    }

    return `Launching skill ${params.type}`;
  },
});

// Usage - the skill automatically enriches future turns
const result = openrouter.callModel({
  model: 'anthropic/claude-sonnet-4.5',
  input: 'Process this PDF and extract the key findings',
  tools: [skillsTool],
});
```

### Key Benefits

1. **Encapsulation**: Skill loading logic is entirely contained in the tool
2. **Idempotency**: Built-in check prevents loading the same skill twice
3. **Clean API**: Callers don't need to know about skill file locations
4. **Composability**: Multiple skills can be loaded across turns

## Execution Order

Understanding when `nextTurnParams` runs is crucial:

```
1. Model generates tool calls
   ↓
2. All tool `execute` functions run
   ↓
3. `nextTurnParams` functions run for each tool (in tools array order)
   ↓
4. Modified parameters used for next model turn
   ↓
5. Repeat until model stops calling tools
```

## Available Context

`nextTurnParams` functions receive two arguments:

### params

The validated input parameters that were passed to the tool:

```typescript
nextTurnParams: {
  instructions: (params, context) => {
    // params is typed based on inputSchema
    console.log(params.type); // e.g., "pdf-processing"
    return `Handle ${params.type}`;
  },
},
```

### context

The current request context, including:

| Property          | Type                    | Description                 |
| ----------------- | ----------------------- | --------------------------- |
| `input`           | `OpenResponsesInput`    | Current message history     |
| `model`           | `string \| undefined`   | Current model selection     |
| `models`          | `string[] \| undefined` | Model fallback array        |
| `instructions`    | `string \| undefined`   | Current system instructions |
| `temperature`     | `number \| undefined`   | Current temperature         |
| `maxOutputTokens` | `number \| undefined`   | Current max tokens          |
| `topP`            | `number \| undefined`   | Current top-p sampling      |
| `topK`            | `number \| undefined`   | Current top-k sampling      |

## Modifiable Parameters

You can modify `CallModelInput` parameters:

```typescript
nextTurnParams: {
  // Modify message history
  input: (params, ctx) => [...ctx.input, newMessage],

  // Change model
  model: (params, ctx) => 'anthropic/claude-sonnet-4.5',

  // Update instructions
  instructions: (params, ctx) => `${ctx.instructions}\n\nNew context...`,

  // Adjust generation parameters
  temperature: (params, ctx) => 0.5,
  maxOutputTokens: (params, ctx) => 2000,
},
```

## Patterns

### Research Context Accumulation

Build up context as research progresses:

```typescript
const researchTool = tool({
  name: "research",
  inputSchema: z.object({ topic: z.string() }),
  outputSchema: z.object({ findings: z.array(z.string()) }),

  nextTurnParams: {
    instructions: (params, context) => {
      const base = context.instructions ?? '';
      return `${base}

Previous research on "${params.topic}" found important context.
Build upon these findings in your response.`;
    },
  },

  execute: async (params) => {
    const results = await searchDatabase(params.topic);
    return { findings: results };
  },
});
```

### Complexity-Based Model Selection

Upgrade to better models when needed:

```typescript
const complexityAnalyzer = tool({
  name: "analyze_complexity",
  inputSchema: z.object({ code: z.string() }),
  outputSchema: z.object({ complexity: z.enum(['low', 'medium', 'high']) }),

  nextTurnParams: {
    model: (params, context) => {
      // Upgrade to more capable model for complex code
      if (params.complexity === 'high') {
        return 'anthropic/claude-sonnet-4.5';
      }
      return context.model ?? 'openai/gpt-5-nano';
    },
    temperature: (params, context) => {
      // Lower temperature for complex analysis
      return params.complexity === 'high' ? 0.3 : 0.7;
    },
  },

  execute: async (params) => {
    return analyzeCodeComplexity(params.code);
  },
});
```

### Multi-Skill Loading

Load multiple skills at once:

```typescript
const multiSkillLoader = tool({
  name: 'load_skills',
  description: 'Load multiple skills at once',
  inputSchema: z.object({
    skills: z.array(z.string()).describe('Array of skill names to load'),
  }),
  outputSchema: z.object({
    loaded: z.array(z.string()),
    failed: z.array(z.object({ name: z.string(), reason: z.string() })),
  }),

  nextTurnParams: {
    input: (params, context) => {
      let newInput = context.input;

      for (const skillName of params.skills) {
        const skillPath = `~/.skills/${skillName}/SKILL.md`;
        if (!existsSync(skillPath)) continue;

        const skillMarker = `[Skill: ${skillName}]`;
        if (JSON.stringify(newInput).includes(skillMarker)) continue;

        const skillContent = readFileSync(skillPath, 'utf-8');
        newInput = [
          ...(Array.isArray(newInput) ? newInput : [newInput]),
          { role: 'user', content: `${skillMarker}\n${skillContent}` },
        ];
      }

      return newInput;
    },
  },

  execute: async ({ skills }) => {
    const loaded = [];
    const failed = [];

    for (const skill of skills) {
      if (existsSync(`~/.skills/${skill}/SKILL.md`)) {
        loaded.push(skill);
      } else {
        failed.push({ name: skill, reason: 'Not found' });
      }
    }

    return { loaded, failed };
  },
});
```

### Language/Locale Switching

Adapt to user language preferences:

```typescript
const languageTool = tool({
  name: 'set_language',
  inputSchema: z.object({
    language: z.enum(['en', 'es', 'fr', 'de', 'ja']),
  }),
  outputSchema: z.object({ set: z.boolean() }),

  nextTurnParams: {
    instructions: (params, context) => {
      const base = context.instructions ?? '';
      const languageInstructions = {
        en: 'Respond in English.',
        es: 'Responde en español.',
        fr: 'Répondez en français.',
        de: 'Antworten Sie auf Deutsch.',
        ja: '日本語で回答してください。',
      };

      return `${base}\n\n${languageInstructions[params.language]}`;
    },
  },

  execute: async (params) => ({ set: true }),
});
```

## Best Practices

### Idempotency Checks

Always check if context was already added:

```typescript
nextTurnParams: {
  input: (params, context) => {
    const marker = `[Context: ${params.id}]`;

    // Don't add if already present
    if (JSON.stringify(context.input).includes(marker)) {
      return context.input;
    }

    return [...context.input, {
      role: 'user',
      content: `${marker}\n${newContent}`,
    }];
  },
},
```

### Type Safety

Use proper typing for context access:

```typescript
nextTurnParams: {
  instructions: (params, context) => {
    // Safe access with fallback
    const base = context.instructions ?? 'You are a helpful assistant.';
    return `${base}\n\nAdditional context: ${params.data}`;
  },
},
```

### Minimal Modifications

Only modify what's necessary:

```typescript
// Good: Minimal, targeted change
nextTurnParams: {
  temperature: (params) => params.needsPrecision ? 0.2 : undefined,
},

// Avoid: Unnecessary spreading
nextTurnParams: {
  temperature: (params, ctx) => {
    return params.needsPrecision ? 0.2 : ctx.temperature;
  },
},
```

## See Also

* **[Skills Loader Example](/docs/sdks/typescript/call-model/examples/skills-loader)** - Complete implementation
* **[Dynamic Parameters](/docs/sdks/typescript/call-model/dynamic-parameters)** - Async parameter functions
* **[Stop Conditions](/docs/sdks/typescript/call-model/stop-conditions)** - Execution control
***

title: Stop Conditions
subtitle: >-
Control multi-turn execution with `stopWhen`. Use built-in helpers or custom
conditions to stop by step count, tool calls, cost, or tokens.
headline: Stop Conditions | OpenRouter SDK
canonical-url: '[https://openrouter.ai/docs/sdks/typescript/call-model/stop-conditions](https://openrouter.ai/docs/sdks/typescript/call-model/stop-conditions)'
'og:site\_name': OpenRouter Documentation
'og:title': Stop Conditions - OpenRouter SDK
'og:description': >-
Control multi-turn execution with stopWhen. Use built-in helpers or custom
conditions to stop by step count, tool calls, cost, or tokens.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Stop%20Conditions\&description=Intelligent%20Execution%20Control](https://openrouter.ai/dynamic-og?title=Stop%20Conditions\&description=Intelligent%20Execution%20Control)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

## Basic Usage

```typescript
import { OpenRouter, stepCountIs } from '@openrouter/agent';

const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Research this topic thoroughly',
  tools: [searchTool, analysisTool],
  stopWhen: stepCountIs(5), // Stop after 5 steps
});
```

## Built-in Stop Conditions

### stepCountIs(n)

Stop after a specific number of steps:

```typescript
import { stepCountIs } from '@openrouter/agent';

const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Analyze this data',
  tools: [analysisTool],
  stopWhen: stepCountIs(10), // Stop after 10 steps
});
```

### hasToolCall(name)

Stop when a specific tool is called:

```typescript
import { hasToolCall } from '@openrouter/agent';

const finishTool = tool({
  name: 'finish',
  description: 'Call this when the task is complete',
  inputSchema: z.object({
    summary: z.string(),
  }),
  execute: async (params) => ({ done: true }),
});

const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Research until you have enough information, then call finish',
  tools: [searchTool, finishTool],
  stopWhen: hasToolCall('finish'), // Stop when finish tool is called
});
```

### maxTokensUsed(n)

Stop after using a certain number of tokens:

```typescript
import { maxTokensUsed } from '@openrouter/agent';

const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Generate content',
  tools: [writingTool],
  stopWhen: maxTokensUsed(5000), // Stop after 5000 total tokens
});
```

### maxCost(amount)

Stop after reaching a cost threshold:

```typescript
import { maxCost } from '@openrouter/agent';

const result = openrouter.callModel({
  model: 'openai/gpt-5.2',
  input: 'Perform extensive analysis',
  tools: [analysisTool],
  stopWhen: maxCost(1.00), // Stop after $1.00 spent
});
```

### finishReasonIs(reason)

Stop on a specific finish reason:

```typescript
import { finishReasonIs } from '@openrouter/agent';

const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Complete this task',
  tools: [taskTool],
  stopWhen: finishReasonIs('stop'), // Stop when model finishes naturally
});
```

## Combining Conditions

Pass an array to stop on any condition:

```typescript
import { stepCountIs, hasToolCall, maxCost } from '@openrouter/agent';

const result = openrouter.callModel({
  model: 'openai/gpt-5.2',
  input: 'Research thoroughly but stay within budget',
  tools: [searchTool, finishTool],
  stopWhen: [
    stepCountIs(10),        // Maximum 10 steps
    maxCost(0.50),          // Maximum $0.50
    hasToolCall('finish'),  // Or when finish is called
  ],
});
```

Execution stops when **any** condition is met.

## Custom Stop Conditions

Create custom conditions with a function:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Process data',
  tools: [processTool],
  stopWhen: ({ steps }) => {
    // Stop after 20 steps
    if (steps.length >= 20) return true;

    // Stop if last step had no tool calls
    const lastStep = steps[steps.length - 1];
    if (lastStep && !lastStep.toolCalls?.length) return true;

    // Continue otherwise
    return false;
  },
});
```

### StopConditionContext

Custom functions receive:

| Property | Type           | Description                                     |
| -------- | -------------- | ----------------------------------------------- |
| `steps`  | `StepResult[]` | All completed steps including results and usage |

### StepResult

Each step contains:

```typescript
interface StepResult {
  response: Response;
  toolCalls?: ParsedToolCall[];
  toolResults?: ToolExecutionResult[];
  tokens: {
    input: number;
    output: number;
    cached: number;
  };
  cost: number;
}
```

## Advanced Patterns

### Time-Based Stopping

Stop after a time limit:

```typescript
const startTime = Date.now();
const maxDuration = 30000; // 30 seconds

const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Work on this task',
  tools: [workTool],
  stopWhen: () => {
    return Date.now() - startTime > maxDuration;
  },
});
```

### Content-Based Stopping

Stop based on response content:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Search until you find the answer',
  tools: [searchTool],
  stopWhen: ({ steps }) => {
    const lastStep = steps[steps.length - 1];
    if (!lastStep) return false;

    // Check if response contains certain keywords
    const content = JSON.stringify(lastStep.response);
    return content.includes('ANSWER FOUND') || content.includes('TASK COMPLETE');
  },
});
```

### Quality-Based Stopping

Stop when results meet quality threshold:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Improve this text until it scores above 0.9',
  tools: [improverTool, scorerTool],
  stopWhen: ({ steps }) => {
    // Look for score in tool results
    for (const step of steps) {
      for (const result of step.toolResults ?? []) {
        if (result.toolName === 'scorer' && result.result?.score > 0.9) {
          return true;
        }
      }
    }
    return false;
  },
});
```

### Combination with Early Exit

Combine conditions for complex logic:

```typescript
import { stepCountIs, maxCost } from '@openrouter/agent';

const result = openrouter.callModel({
  model: 'openai/gpt-5.2',
  input: 'Complex research task',
  tools: [searchTool, analysisTool, summarizeTool],
  stopWhen: [
    // Hard limits
    stepCountIs(50),
    maxCost(5.00),

    // Custom success condition
    ({ steps }) => {
      const lastStep = steps[steps.length - 1];
      const hasSummary = lastStep?.toolCalls?.some(
        tc => tc.name === 'summarize'
      );
      return hasSummary;
    },
  ],
});
```

## Migration from maxToolRounds

If you were using `maxToolRounds`, migrate to `stopWhen`:

```typescript
// Before: maxToolRounds
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Hello',
  tools: [myTool],
  maxToolRounds: 5,
});

// After: stopWhen
import { stepCountIs } from '@openrouter/agent';

const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Hello',
  tools: [myTool],
  stopWhen: stepCountIs(5),
});
```

### Default Behavior

If `stopWhen` is not specified, the default is `stepCountIs(5)`.

## Best Practices

### Always Set Limits

Always include a hard limit to prevent runaway execution:

```typescript
stopWhen: [
  stepCountIs(100),    // Hard limit
  maxCost(10.00),      // Budget limit
  customCondition,     // Your logic
],
```

### Log Stop Reasons

Track why execution stopped:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Task',
  tools: [taskTool],
  stopWhen: ({ steps }) => {
    if (steps.length >= 10) {
      console.log('Stopped: step limit');
      return true;
    }
    const totalCost = steps.reduce((sum, step) => sum + (step.cost ?? 0), 0);
    if (totalCost >= 1.00) {
      console.log('Stopped: cost limit');
      return true;
    }
    return false;
  },
});
```

### Test Conditions

Verify conditions work as expected:

```typescript
// Test with low limits first
const testResult = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Test task',
  tools: [testTool],
  stopWhen: stepCountIs(2), // Low limit for testing
});
```

## See Also

* **[Tools](/docs/sdks/call-model/tools)** - Multi-turn orchestration
* **[Dynamic Parameters](/docs/sdks/call-model/dynamic-parameters)** - Adaptive behavior
* **[nextTurnParams](/docs/sdks/call-model/next-turn-params)** - Tool-driven modifications
***

title: Streaming
subtitle: >-
Stream responses in real-time with multiple consumption patterns. All streams
are built on a reusable stream architecture that supports concurrent
consumers.
headline: Streaming | OpenRouter SDK
canonical-url: '[https://openrouter.ai/docs/sdks/typescript/call-model/streaming](https://openrouter.ai/docs/sdks/typescript/call-model/streaming)'
'og:site\_name': OpenRouter Documentation
'og:title': Streaming - OpenRouter SDK
'og:description': >-
Learn to stream LLM responses with callModel. Covers text streaming, reasoning
streams, message updates, and concurrent consumers.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Streaming\&description=Real-time%20Response%20Streaming](https://openrouter.ai/dynamic-og?title=Streaming\&description=Real-time%20Response%20Streaming)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

## Text Streaming

### getTextStream()

Stream text content as it's generated:

```typescript
import { OpenRouter } from '@openrouter/agent';

const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Write a short poem about the ocean.',
});

for await (const delta of result.getTextStream()) {
  process.stdout.write(delta);
}
```

Each iteration yields a small chunk of text (typically a few characters or a word).

## Reasoning Streaming

### getReasoningStream()

For models that support reasoning (like o1 or Claude with thinking), stream the
reasoning process:

```typescript
const result = openrouter.callModel({
  model: 'openai/o1-preview',
  input: 'Solve this step by step: If x + 5 = 12, what is x?',
});

console.log('Reasoning:');
for await (const delta of result.getReasoningStream()) {
  process.stdout.write(delta);
}

console.log('\n\nFinal answer:');
const text = await result.getText();
console.log(text);
```

## Items Streaming

### getItemsStream()

Stream complete items as they update. This is the **recommended way** to handle
streaming when you need structured access to all output types (messages, tool
calls, reasoning, etc.). See
[Working with Items](/docs/sdks/typescript/call-model/items) for the full
paradigm explanation.

```typescript
import type { StreamableOutputItem } from '@openrouter/agent';

const result = openrouter.callModel({
  model: 'anthropic/claude-sonnet-4',
  input: 'Hello!',
  tools: [myTool],
});

for await (const item of result.getItemsStream()) {
  switch (item.type) {
    case 'message':
      console.log('Message:', item.content);
      break;
    case 'function_call':
      console.log('Tool call:', item.name, item.arguments);
      break;
    case 'reasoning':
      console.log('Thinking:', item.summary);
      break;
    case 'function_call_output':
      console.log('Tool result:', item.output);
      break;
  }
}
```

**Key insight**: Each iteration yields a **complete item** with the same ID but
updated content. Replace items by ID rather than accumulating deltas.

This stream yields all item types:

| Type                    | Description                        |
| ----------------------- | ---------------------------------- |
| `message`               | Assistant text responses           |
| `function_call`         | Tool invocations with arguments    |
| `reasoning`             | Model thinking (extended thinking) |
| `web_search_call`       | Web search operations              |
| `file_search_call`      | File search operations             |
| `image_generation_call` | Image generation operations        |
| `function_call_output`  | Results from executed tools        |

## Message Streaming (Deprecated)

### getNewMessagesStream()

<Warning>
  `getNewMessagesStream()` is deprecated. Use `getItemsStream()` instead, which
  includes all item types and follows the items-based paradigm.
</Warning>

Stream cumulative message snapshots in the OpenResponses format:

```typescript
// Deprecated - use getItemsStream() instead
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Hello!',
  tools: [myTool],
});

for await (const message of result.getNewMessagesStream()) {
  if (message.type === 'message') {
    console.log('Assistant message:', message.content);
  } else if (message.type === 'function_call_output') {
    console.log('Tool result:', message.output);
  }
}
```

This stream yields:

* `ResponsesOutputMessage` - Assistant text/content updates
* `OpenResponsesFunctionCallOutput` - Tool execution results (after tools
  complete)

## Full Event Streaming

### getFullResponsesStream()

Stream all response events including tool preliminary results:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Search for documents',
  tools: [searchTool], // Generator tool with eventSchema
});

for await (const event of result.getFullResponsesStream()) {
  switch (event.type) {
    case 'response.output_text.delta':
      process.stdout.write(event.delta);
      break;
    case 'response.function_call_arguments.delta':
      console.log('Tool argument delta:', event.delta);
      break;
    case 'response.completed':
      console.log('Response complete');
      break;
    case 'tool.preliminary_result':
      // Intermediate progress from generator tools
      console.log('Progress:', event.result);
      break;
    case 'tool.result':
      // Final result when tool execution completes
      console.log('Tool completed:', event.toolCallId);
      console.log('Result:', event.result);
      // Access any preliminary results that were emitted
      if (event.preliminaryResults) {
        console.log('Preliminary results:', event.preliminaryResults);
      }
      break;
  }
}
```

### Event Types

The full stream includes these event types:

| Event Type                               | Description                                         |
| ---------------------------------------- | --------------------------------------------------- |
| `response.created`                       | Response object created                             |
| `response.in_progress`                   | Generation started                                  |
| `response.output_text.delta`             | Text content chunk                                  |
| `response.output_text.done`              | Text content complete                               |
| `response.reasoning.delta`               | Reasoning content chunk                             |
| `response.reasoning.done`                | Reasoning complete                                  |
| `response.function_call_arguments.delta` | Tool call argument chunk                            |
| `response.function_call_arguments.done`  | Tool call arguments complete                        |
| `response.completed`                     | Full response complete                              |
| `tool.preliminary_result`                | Progress from generator tools (intermediate yields) |
| `tool.result`                            | Final result from tool execution                    |

## Tool Call Streaming

### getToolCallsStream()

Stream structured tool calls as they complete:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'What is the weather in Paris and Tokyo?',
  tools: [weatherTool],
  maxToolRounds: 0, // Don't auto-execute, just get tool calls
});

for await (const toolCall of result.getToolCallsStream()) {
  console.log(`Tool: ${toolCall.name}`);
  console.log(`Arguments:`, toolCall.arguments);
  console.log(`ID: ${toolCall.id}`);
}
```

### getToolStream()

Stream tool deltas and preliminary results:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Search for TypeScript tutorials',
  tools: [searchTool], // Generator tool
});

for await (const event of result.getToolStream()) {
  if (event.type === 'delta') {
    // Raw argument deltas
    process.stdout.write(event.content);
  } else if (event.type === 'preliminary_result') {
    // Progress from generator tools
    console.log(`\nProgress (${event.toolCallId}):`, event.result);
  }
}
```

## Concurrent Consumers

Multiple consumers can read from the same result:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Write a story.',
});

// Start both consumers concurrently
const [text, response] = await Promise.all([
  // Consumer 1: Collect text
  (async () => {
    let text = '';
    for await (const delta of result.getTextStream()) {
      text += delta;
    }
    return text;
  })(),

  // Consumer 2: Get full response
  result.getResponse(),
]);

console.log('Text length:', text.length);
console.log('Token usage:', response.usage);
```

The underlying `ReusableReadableStream` ensures each consumer receives all events.

## Cancellation

Cancel a stream to stop generation:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Write a very long essay...',
});

// Start streaming
const streamPromise = (async () => {
  let charCount = 0;
  for await (const delta of result.getTextStream()) {
    process.stdout.write(delta);
    charCount += delta.length;

    // Cancel after 500 characters
    if (charCount > 500) {
      await result.cancel();
      break;
    }
  }
})();

await streamPromise;
console.log('\nCancelled!');
```

## Streaming with UI Frameworks

### React Example

```typescript
import { useState, useEffect } from 'react';

function ChatResponse({ prompt }: { prompt: string }) {
  const [text, setText] = useState('');
  const [isStreaming, setIsStreaming] = useState(true);

  useEffect(() => {
    const openrouter = new OpenRouter({ apiKey: API_KEY });

    const result = openrouter.callModel({
      model: 'openai/gpt-5-nano',
      input: prompt,
    });

    (async () => {
      for await (const delta of result.getTextStream()) {
        setText(prev => prev + delta);
      }
      setIsStreaming(false);
    })();

    return () => {
      result.cancel();
    };
  }, [prompt]);

  return (
    <div>
      <p>{text}</p>
      {isStreaming && <span className="cursor">|</span>}
    </div>
  );
}
```

### Server-Sent Events (SSE)

```typescript
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

const app = new Hono();

app.get('/stream', (c) => {
  return streamSSE(c, async (stream) => {
    const result = openrouter.callModel({
      model: 'openai/gpt-5-nano',
      input: c.req.query('prompt') || 'Hello!',
    });

    for await (const delta of result.getTextStream()) {
      await stream.writeSSE({
        data: JSON.stringify({ delta }),
        event: 'delta',
      });
    }

    await stream.writeSSE({
      data: JSON.stringify({ done: true }),
      event: 'done',
    });
  });
});
```

## Next Steps

* **[Working with Items](/docs/sdks/typescript/call-model/items)** - Understand
  the items-based streaming paradigm
* **[Tools](/docs/sdks/typescript/call-model/tools)** - Create tools and
  multi-turn streaming with tools
***

title: Text Generation
subtitle: >-
Generate text with callModel using various input formats and model
configurations. Supports multiple consumption patterns including text,
streaming, and structured output.
headline: Text Generation | OpenRouter SDK
canonical-url: '[https://openrouter.ai/docs/sdks/typescript/call-model/text-generation](https://openrouter.ai/docs/sdks/typescript/call-model/text-generation)'
'og:site\_name': OpenRouter Documentation
'og:title': Text Generation - OpenRouter SDK
'og:description': >-
Learn how to generate text with callModel. Covers input formats, model
selection, system instructions, and response handling.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Text%20Generation\&description=Generate%20Text%20with%20callModel](https://openrouter.ai/dynamic-og?title=Text%20Generation\&description=Generate%20Text%20with%20callModel)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

## Basic Usage

The simplest way to generate text:

```typescript
import { OpenRouter } from '@openrouter/agent';

const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Explain quantum computing in one sentence.',
});

const text = await result.getText();
```

## Input Formats

callModel accepts several input formats to match your use case.

### String Input

The simplest format - a single string becomes a user message:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'What is the speed of light?',
});
```

### Message Array

For multi-turn conversations, pass an array of messages:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: [
    { role: 'user', content: 'My name is Alice.' },
    { role: 'assistant', content: 'Hello Alice! How can I help you today?' },
    { role: 'user', content: 'What is my name?' },
  ],
});
```

### Multimodal

For rich content including images:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5.2',
  input: [
    {
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: 'What is in this image?' },
        {
          type: 'input_image',
          imageUrl: 'https://example.com/image.jpg',
          detail: 'auto',
        },
      ],
    },
  ],
});
```

## System Instructions

Set the model's behavior with the `instructions` parameter:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  instructions: 'You are a helpful coding assistant. Be concise and provide working code examples.',
  input: 'How do I read a file in Node.js?',
});
```

## Model Selection

### Single Model

Specify a model by its OpenRouter ID:

```typescript
const result = openrouter.callModel({
  model: 'anthropic/claude-sonnet-4.5',
  input: 'Hello!',
});
```

### Model Fallback

Provide multiple models for automatic fallback:

```typescript
const result = openrouter.callModel({
  models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5.2', 'google/gemini-pro'],
  input: 'Hello!',
});
```

The SDK will try each model in order until one succeeds.

## Response Methods

### getText()

Returns just the text content after tool execution completes:

```typescript
const text = await result.getText();
console.log(text); // "The speed of light is approximately 299,792 km/s."
```

### getResponse()

Returns the full response object including usage data:

```typescript
const response = await result.getResponse();

console.log(response.output);     // Full output array
console.log(response.usage);      // Token usage information

// Usage includes:
// - inputTokens: tokens in the prompt
// - outputTokens: tokens generated
// - cachedTokens: tokens served from cache (cost savings)
```

## Generation Parameters

Control the generation behavior:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Write a creative story.',

  // Temperature: 0 = deterministic, 2 = very creative
  temperature: 0.7,

  // Maximum tokens to generate
  maxOutputTokens: 1000,

  // Top-p sampling
  topP: 0.9,
});
```

## Response Format

Request structured output:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'List three programming languages.',
  text: {
    format: {
      type: 'json_object',
    },
  },
});

const text = await result.getText();
const data = JSON.parse(text);
```

## Error Handling

Handle common error cases:

```typescript
try {
  const result = openrouter.callModel({
    model: 'openai/gpt-5-nano',
    input: 'Hello!',
  });

  const text = await result.getText();
} catch (error) {
  if (error instanceof Error && 'statusCode' in error) {
    if (error.statusCode === 401) {
      console.error('Invalid API key');
    } else if (error.statusCode === 429) {
      console.error('Rate limited - try again later');
    } else if (error.statusCode === 503) {
      console.error('Model unavailable');
    }
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## Concurrent Requests

Each callModel invocation is independent:

```typescript
const [result1, result2, result3] = await Promise.all([
  openrouter.callModel({ model: 'openai/gpt-5-nano', input: 'Question 1' }).getText(),
  openrouter.callModel({ model: 'openai/gpt-5-nano', input: 'Question 2' }).getText(),
  openrouter.callModel({ model: 'openai/gpt-5-nano', input: 'Question 3' }).getText(),
]);
```

## Next Steps

* **[Streaming](/docs/sdks/call-model/streaming)** - Stream responses in real-time
* **[Tools](/docs/sdks/call-model/tools)** - Add tool capabilities to your generation
* **[Message Formats](/docs/sdks/call-model/message-formats)** - Convert from OpenAI/Claude formats
***

title: Message Formats
subtitle: >-
The OpenRouter SDK provides helper functions to convert between popular
message formats. This makes it easy to migrate existing code or integrate with
different APIs.
headline: Message Formats | OpenRouter SDK
canonical-url: '[https://openrouter.ai/docs/sdks/typescript/call-model/message-formats](https://openrouter.ai/docs/sdks/typescript/call-model/message-formats)'
'og:site\_name': OpenRouter Documentation
'og:title': Message Formats - OpenRouter SDK
'og:description': >-
Convert between OpenAI chat format, Anthropic Claude format, and OpenResponses
format. Easy migration from other SDKs.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Message%20Formats\&description=Format%20Conversion%20Helpers](https://openrouter.ai/dynamic-og?title=Message%20Formats\&description=Format%20Conversion%20Helpers)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

## OpenAI Chat Format

### fromChatMessages()

Convert OpenAI chat-style messages to OpenResponses input:

```typescript
import { OpenRouter, fromChatMessages } from '@openrouter/agent';

const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

// OpenAI chat format
const chatMessages = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello!' },
  { role: 'assistant', content: 'Hi there! How can I help you?' },
  { role: 'user', content: 'What is the weather like?' },
];

const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: fromChatMessages(chatMessages),
});

const text = await result.getText();
```

### toChatMessage()

Convert an OpenResponses response to chat message format:

```typescript
import { toChatMessage } from '@openrouter/agent';

const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Hello!',
});

const response = await result.getResponse();
const chatMessage = toChatMessage(response);

// chatMessage is now: { role: 'assistant', content: '...' }
console.log(chatMessage.role);    // 'assistant'
console.log(chatMessage.content); // Response text
```

### Supported Message Types

| Chat Role   | Description            |
| ----------- | ---------------------- |
| `system`    | System instructions    |
| `user`      | User messages          |
| `assistant` | Assistant responses    |
| `developer` | Developer instructions |
| `tool`      | Tool response messages |

### Tool Messages

Tool responses are converted to function call outputs:

```typescript
const chatMessages = [
  { role: 'user', content: 'What is the weather?' },
  {
    role: 'assistant',
    content: null,
    tool_calls: [{
      id: 'call_123',
      type: 'function',
      function: { name: 'get_weather', arguments: '{"location":"Paris"}' },
    }],
  },
  {
    role: 'tool',
    tool_call_id: 'call_123',
    content: '{"temperature": 20}',
  },
];

const input = fromChatMessages(chatMessages);
```

## Anthropic Claude Format

### fromClaudeMessages()

Convert Anthropic Claude-style messages to OpenResponses input:

```typescript
import { OpenRouter, fromClaudeMessages } from '@openrouter/agent';

// Claude format
const claudeMessages = [
  { role: 'user', content: 'Hello!' },
  { role: 'assistant', content: 'Hi there!' },
  { role: 'user', content: 'Tell me about TypeScript.' },
];

const result = openrouter.callModel({
  model: 'anthropic/claude-sonnet-4.5',
  input: fromClaudeMessages(claudeMessages),
});
```

### toClaudeMessage()

Convert an OpenResponses response to Claude message format:

```typescript
import { toClaudeMessage } from '@openrouter/agent';

const result = openrouter.callModel({
  model: 'anthropic/claude-sonnet-4.5',
  input: 'Hello!',
});

const response = await result.getResponse();
const claudeMessage = toClaudeMessage(response);

// Compatible with Anthropic SDK types
```

### Content Blocks

Claude's content block format is supported:

```typescript
const claudeMessages = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'What is in this image?' },
      {
        type: 'image',
        source: {
          type: 'url',
          url: 'https://example.com/image.jpg',
        },
      },
    ],
  },
];

const input = fromClaudeMessages(claudeMessages);
```

### Tool Use Blocks

Claude's tool use format is converted:

```typescript
const claudeMessages = [
  { role: 'user', content: 'What is the weather?' },
  {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'tool_123',
        name: 'get_weather',
        input: { location: 'Paris' },
      },
    ],
  },
  {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'tool_123',
        content: '{"temperature": 20}',
      },
    ],
  },
];

const input = fromClaudeMessages(claudeMessages);
```

### Base64 Images

Both URL and base64 images are supported:

```typescript
const claudeMessages = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Describe this image.' },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'iVBORw0KGgo...',
        },
      },
    ],
  },
];
```

### Limitations

Some Claude features are not preserved in conversion.
e.g. `is_error` flag on tool\_result blocks

These features are Claude-specific and not supported by OpenRouter.

## Migration Examples

### From OpenAI SDK

```typescript
// Before: OpenAI SDK
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const completion = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hello!' },
  ],
});

// After: OpenRouter SDK
import { OpenRouter, fromChatMessages } from '@openrouter/agent';

const openrouter = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
const result = openrouter.callModel({
  model: 'openai/gpt-5.2',
  input: fromChatMessages([
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hello!' },
  ]),
});

const text = await result.getText();
```

### From Anthropic SDK

```typescript
// Before: Anthropic SDK
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();
const message = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [
    { role: 'user', content: 'Hello!' },
  ],
});

// After: OpenRouter SDK
import { OpenRouter, fromClaudeMessages } from '@openrouter/agent';

const openrouter = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
const result = openrouter.callModel({
  model: 'anthropic/claude-sonnet-4.5',
  input: fromClaudeMessages([
    { role: 'user', content: 'Hello!' },
  ]),
  maxOutputTokens: 1024,
});

const text = await result.getText();
```

## Building Conversations

Accumulate messages across multiple calls:

```typescript
import { fromChatMessages, toChatMessage } from '@openrouter/agent';

// Start with initial message
let messages = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello!' },
];

// First call
let result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: fromChatMessages(messages),
});

let response = await result.getResponse();
let assistantMessage = toChatMessage(response);

// Add to history
messages.push(assistantMessage);
messages.push({ role: 'user', content: 'What can you help me with?' });

// Continue conversation
result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: fromChatMessages(messages),
});
```

## Next Steps

* **[Text Generation](/docs/sdks/call-model/text-generation)** - Input formats and parameters
* **[Tools](/docs/sdks/call-model/tools)** - Add tool capabilities
* **[Streaming](/docs/sdks/call-model/streaming)** - Stream format-converted responses
***

title: Tools
subtitle: >-
Create type-safe tools with Zod schemas and automatic execution. Supports
regular tools, generator tools with progress, manual tools, and automatic
multi-turn execution.
headline: Tools | OpenRouter SDK
canonical-url: '[https://openrouter.ai/docs/sdks/typescript/call-model/tools](https://openrouter.ai/docs/sdks/typescript/call-model/tools)'
'og:site\_name': OpenRouter Documentation
'og:title': Tools - OpenRouter SDK
'og:description': >-
Create strongly-typed tools for LLMs with Zod schemas. Learn about regular
tools, generator tools with progress, manual tools, and automatic multi-turn
execution.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Tools\&description=Type-safe%20Tool%20Creation](https://openrouter.ai/dynamic-og?title=Tools\&description=Type-safe%20Tool%20Creation)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

## The tool() Helper

The `tool()` function creates type-safe tools with Zod schema validation:

```typescript
import { OpenRouter, tool } from '@openrouter/agent';
import { z } from 'zod';

const weatherTool = tool({
  name: 'get_weather',
  description: 'Get the current weather for a location',
  inputSchema: z.object({
    location: z.string().describe('City name, e.g., "San Francisco, CA"'),
  }),
  outputSchema: z.object({
    temperature: z.number(),
    conditions: z.string(),
  }),
  execute: async (params) => {
    // params is typed as { location: string }
    const weather = await fetchWeather(params.location);
    return {
      temperature: weather.temp,
      conditions: weather.description,
    };
  },
});
```

## Tool Types

The SDK supports three types of tools, automatically detected from your configuration:

### Regular Tools

Standard tools with an execute function:

```typescript
const calculatorTool = tool({
  name: 'calculate',
  description: 'Perform a mathematical calculation',
  inputSchema: z.object({
    expression: z.string().describe('Math expression like "2 + 2"'),
  }),
  outputSchema: z.object({
    result: z.number(),
  }),
  execute: async (params) => {
    const result = eval(params.expression); // Use a safer eval in production
    return { result };
  },
});
```

### Generator Tools

Tools that yield progress updates during execution. Add `eventSchema` to enable generator mode:

```typescript
const searchTool = tool({
  name: 'search_database',
  description: 'Search documents with progress updates',
  inputSchema: z.object({
    query: z.string(),
    limit: z.number().default(10),
  }),
  // eventSchema triggers generator mode
  eventSchema: z.object({
    progress: z.number().min(0).max(100),
    message: z.string(),
  }),
  outputSchema: z.object({
    results: z.array(z.string()),
    totalFound: z.number(),
  }),
  // execute is now an async generator
  execute: async function* (params) {
    yield { progress: 0, message: 'Starting search...' };

    const results = [];
    for (let i = 0; i < 5; i++) {
      yield { progress: (i + 1) * 20, message: `Searching batch ${i + 1}...` };
      results.push(...await searchBatch(params.query, i));
    }

    // Final yield is the output
    yield { progress: 100, message: 'Complete!' };

    // Return the final result (or yield it as last value)
    return {
      results: results.slice(0, params.limit),
      totalFound: results.length,
    };
  },
});
```

Progress events are streamed to consumers via `getToolStream()` and `getFullResponsesStream()`.

### Manual Tools

Tools without automatic execution - you handle the tool calls yourself:

```typescript
const manualTool = tool({
  name: 'send_email',
  description: 'Send an email (requires user confirmation)',
  inputSchema: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
  }),
  execute: false, // Manual handling required
});
```

Use `getToolCalls()` to retrieve manual tool calls for processing.

## Schema Definition

### Input Schema

Define what parameters the tool accepts:

```typescript
const inputSchema = z.object({
  // Required parameters
  query: z.string().describe('Search query'),

  // Optional with default
  limit: z.number().default(10).describe('Max results'),

  // Optional without default
  filter: z.string().optional().describe('Filter expression'),

  // Enum values
  sortBy: z.enum(['relevance', 'date', 'popularity']).default('relevance'),

  // Nested objects
  options: z.object({
    caseSensitive: z.boolean().default(false),
    wholeWord: z.boolean().default(false),
  }).optional(),

  // Arrays
  tags: z.array(z.string()).optional(),
});
```

### Output Schema

Define the structure of results returned to the model:

```typescript
const outputSchema = z.object({
  results: z.array(z.object({
    id: z.string(),
    title: z.string(),
    score: z.number(),
  })),
  metadata: z.object({
    totalCount: z.number(),
    searchTimeMs: z.number(),
  }),
});
```

### Event Schema (Generator Tools)

Define progress/status events for generator tools:

```typescript
const eventSchema = z.object({
  stage: z.enum(['initializing', 'processing', 'finalizing']),
  progress: z.number(),
  currentItem: z.string().optional(),
});
```

## Type Inference

The SDK provides utilities to extract types from tools:

```typescript
import type { InferToolInput, InferToolOutput, InferToolEvent } from '@openrouter/agent';

// Get the input type
type WeatherInput = InferToolInput<typeof weatherTool>;
// { location: string }

// Get the output type
type WeatherOutput = InferToolOutput<typeof weatherTool>;
// { temperature: number; conditions: string }

// Get event type (generator tools only)
type SearchEvent = InferToolEvent<typeof searchTool>;
// { progress: number; message: string }
```

## Using Tools with callModel

### Single Tool

```typescript
const openrouter = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'What is the weather in Tokyo?',
  tools: [weatherTool],
});

// Tools are automatically executed
const text = await result.getText();
// "The weather in Tokyo is 22°C and sunny."
```

### Multiple Tools

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Search for TypeScript tutorials and calculate 2+2',
  tools: [searchTool, calculatorTool],
});
```

### Type-Safe Tool Calls with `as const`

Use `as const` for full type inference on tool calls:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'What is the weather?',
  tools: [weatherTool, searchTool] as const,
  maxToolRounds: 0, // Get tool calls without executing
});

// Tool calls are typed as union of tool inputs
for await (const toolCall of result.getToolCallsStream()) {
  if (toolCall.name === 'get_weather') {
    // toolCall.arguments is typed as { location: string }
    console.log('Weather for:', toolCall.arguments.location);
  }
}
```

## Execute Context

Tool execute functions receive a flat context object as
their second argument. It merges `TurnContext` fields
with a `tools` map and a `setContext()` method:

```typescript
const contextAwareTool = tool({
  name: 'context_tool',
  inputSchema: z.object({ data: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  execute: async (params, context) => {
    // TurnContext fields are available directly
    console.log('Turn:', context.numberOfTurns);
    console.log('History:', context.turnRequest?.input);
    console.log('Model:', context.turnRequest?.model);

    return {
      result: `Processed on turn ${context.numberOfTurns}`,
    };
  },
});
```

### Context Properties

| Property           | Type                                         | Description                         |
| ------------------ | -------------------------------------------- | ----------------------------------- |
| `numberOfTurns`    | `number`                                     | Current turn number (1-indexed)     |
| `turnRequest`      | `OpenResponsesRequest \| undefined`          | Current request object              |
| `toolCall`         | `OpenResponsesFunctionToolCall \| undefined` | The tool call being executed        |
| `local`            | `Readonly<TContext>`                         | This tool's own context (read-only) |
| `setContext`       | `(partial: Partial<TContext>) => void`       | Mutate this tool's context          |
| `shared`           | `Readonly<TShared>`                          | Shared context visible to all tools |
| `setSharedContext` | `(partial: Partial<TShared>) => void`        | Mutate shared context               |

## Tool Context

Tools can declare a `contextSchema` to receive typed,
persistent context data from the caller. Context is
keyed by tool name and persists across turns.

### Declaring contextSchema

```typescript
const weatherTool = tool({
  name: 'get_weather',
  description: 'Get weather for a location',
  inputSchema: z.object({
    location: z.string(),
  }),
  outputSchema: z.object({
    temperature: z.number(),
  }),
  // Declare what context this tool needs
  contextSchema: z.object({
    apiKey: z.string(),
    units: z.enum(['celsius', 'fahrenheit']),
  }),
  execute: async (params, context) => {
    // Access this tool's own context via local
    const { apiKey, units } = context.local;

    const weather = await fetchWeather(
      params.location,
      apiKey,
      units,
    );
    return { temperature: weather.temp };
  },
});
```

### Providing Context in callModel

Pass context keyed by tool name:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'What is the weather in Tokyo?',
  tools: [weatherTool, dbTool] as const,

  // Static context — keyed by tool name
  context: {
    get_weather: { apiKey: 'sk-...', units: 'celsius' },
    db_query: { connectionString: 'postgres://...' },
  },
});
```

### Dynamic Context

Use an async function for one-time initialization
that needs to fetch data:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'What is the weather?',
  tools: [weatherTool] as const,

  // Resolved once at turn 0 to seed the store
  context: async () => ({
    get_weather: {
      apiKey: await fetchApiKey(),
      units: 'celsius',
    },
  }),
});
```

<Note>
  `resolveContext` runs once at turn 0 to seed the
  context store. For per-turn mutations, use
  `setContext()` inside your tool's `execute` function.
</Note>

### Mutating Context with setContext

Tools can update their own context using `setContext()`.
Changes persist across turns via the shared store and
are visible immediately — `context.local` is a live
getter that always reads the latest values:

```typescript
const authTool = tool({
  name: 'auth',
  inputSchema: z.object({ action: z.string() }),
  contextSchema: z.object({
    token: z.string(),
    refreshCount: z.number(),
  }),
  execute: async (params, context) => {
    const { token } = context.local;

    if (isExpired(token)) {
      const newToken = await refreshToken(token);
      // Mutate own context — persists to next turn
      context.setContext({
        token: newToken,
        refreshCount:
          context.local.refreshCount + 1,
      });
    }

    return { success: true };
  },
});
```

### Observing Context Changes

Use `getContextUpdates()` on `ModelResult` to observe
context mutations in real time:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Authenticate and fetch data',
  tools: [authTool] as const,
  context: {
    auth: { token: 'initial', refreshCount: 0 },
  },
});

for await (const snapshot of result.getContextUpdates()) {
  console.log('Context changed:', snapshot);
  // { auth: { token: 'new-token', refreshCount: 1 } }
}
```

### Shared Context

Use `sharedSchema` on `tool()` and `sharedContextSchema`
on `callModel` to share typed state across tools:

```typescript
const SharedContextSchema = z.object({
  _sessionId: z.string().optional(),
});

const execTool = tool({
  name: 'sandbox_exec',
  inputSchema: z.object({ command: z.string() }),
  sharedSchema: SharedContextSchema,
  execute: async (input, ctx) => {
    // Read shared state set by any tool
    const sid = ctx.shared._sessionId;
    const session = await connect(sid);
    // Write shared state for other tools
    ctx.setSharedContext({ _sessionId: session.id });
    return await session.exec(input.command);
  },
});

const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Run a command',
  tools: [execTool] as const,
  sharedContextSchema: SharedContextSchema,
  context: {
    shared: { _sessionId: 'existing-session' },
    sandbox_exec: {},
  },
});
```

<Note>
  `context.local` is scoped to one tool.
  `context.shared` is visible to all tools and persists
  across turns. Pass the same `sharedSchema` to each tool
  for typed access, and `sharedContextSchema` to
  `callModel` for runtime validation.
</Note>

## Tool Execution

callModel automatically executes tools and handles multi-turn conversations. When the model calls a tool, the SDK executes it, sends the result back, and continues until the model provides a final response.

### Automatic Execution Flow

When you provide tools with execute functions:

```typescript
import { OpenRouter, tool } from '@openrouter/agent';
import { z } from 'zod';

const weatherTool = tool({
  name: 'get_weather',
  inputSchema: z.object({ location: z.string() }),
  outputSchema: z.object({ temperature: z.number() }),
  execute: async ({ location }) => {
    return { temperature: await fetchTemperature(location) };
  },
});

const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'What is the weather in Paris?',
  tools: [weatherTool],
});

// getText() waits for all tool execution to complete
const text = await result.getText();
// "The weather in Paris is 18°C."
```

### Execution Sequence

1. Model receives prompt and generates tool call
2. SDK extracts tool call and validates arguments
3. Tool's execute function runs
4. Result is formatted and sent back to model
5. Model generates final response (or more tool calls)
6. Process repeats until model is done

### Controlling Execution Rounds

#### maxToolRounds (Number)

Limit the maximum number of tool execution rounds:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Research this topic thoroughly',
  tools: [searchTool, analyzeTool],
  maxToolRounds: 3, // Stop after 3 rounds of tool execution
});
```

Setting `maxToolRounds: 0` disables automatic execution - you get raw tool calls.

#### maxToolRounds (Function)

Use a function for dynamic control:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Research and analyze',
  tools: [searchTool],
  maxToolRounds: (context) => {
    // Continue if under 5 turns
    return context.numberOfTurns < 5;
  },
});
```

The function receives `TurnContext` and returns `true` to continue or `false` to stop.

### Accessing Tool Calls

#### getToolCalls()

Get all tool calls from the initial response (before auto-execution):

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'What is the weather in Tokyo and Paris?',
  tools: [weatherTool],
  maxToolRounds: 0, // Don't auto-execute
});

const toolCalls = await result.getToolCalls();

for (const call of toolCalls) {
  console.log(`Tool: ${call.name}`);
  console.log(`ID: ${call.id}`);
  console.log(`Arguments:`, call.arguments);
}
```

#### getToolCallsStream()

Stream tool calls as they complete:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Check weather in multiple cities',
  tools: [weatherTool],
  maxToolRounds: 0,
});

for await (const toolCall of result.getToolCallsStream()) {
  console.log(`Received tool call: ${toolCall.name}`);

  // Process each tool call as it arrives
  const weatherResult = await processWeatherRequest(toolCall.arguments);
  console.log('Result:', weatherResult);
}
```

### Tool Stream Events

#### getToolStream()

Stream both argument deltas and preliminary results:

```typescript
const searchTool = tool({
  name: 'search',
  inputSchema: z.object({ query: z.string() }),
  eventSchema: z.object({ progress: z.number(), status: z.string() }),
  outputSchema: z.object({ results: z.array(z.string()) }),
  execute: async function* ({ query }) {
    yield { progress: 25, status: 'Searching...' };
    yield { progress: 50, status: 'Processing...' };
    yield { progress: 75, status: 'Ranking...' };
    yield { progress: 100, status: 'Complete' };
    return { results: ['result1', 'result2'] };
  },
});

const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Search for TypeScript tutorials',
  tools: [searchTool],
});

for await (const event of result.getToolStream()) {
  switch (event.type) {
    case 'delta':
      // Raw argument delta from the model
      process.stdout.write(event.content);
      break;
    case 'preliminary_result':
      // Progress from generator tool
      console.log(`Progress: ${event.result.progress}% - ${event.result.status}`);
      break;
  }
}
```

#### Event Types

| Type                 | Description                                                |
| -------------------- | ---------------------------------------------------------- |
| `delta`              | Raw tool call argument chunks from model                   |
| `preliminary_result` | Progress events from generator tools (intermediate yields) |

### Tool Result Events

When using `getFullResponsesStream()`, you can also receive `tool.result` events that fire when a tool execution completes:

```typescript
for await (const event of result.getFullResponsesStream()) {
  switch (event.type) {
    case 'tool.preliminary_result':
      // Intermediate progress from generator tools
      console.log(`Progress (${event.toolCallId}):`, event.result);
      break;
    case 'tool.result':
      // Final result when tool execution completes
      console.log(`Tool ${event.toolCallId} completed`);
      console.log('Result:', event.result);
      // Access any preliminary results that were emitted during execution
      if (event.preliminaryResults) {
        console.log('All progress events:', event.preliminaryResults);
      }
      break;
  }
}
```

#### ToolResultEvent Type

```typescript
type ToolResultEvent<TResult = unknown, TPreliminaryResults = unknown> = {
  type: 'tool.result';
  toolCallId: string;
  result: TResult;
  timestamp: number;
  preliminaryResults?: TPreliminaryResults[];
};
```

The `tool.result` event provides the final output from tool execution along with all intermediate `preliminaryResults` that were yielded during execution (for generator tools). This is useful when you need both real-time progress updates and a summary of all progress at completion.

### Parallel Tool Execution

When the model calls multiple tools, they execute in parallel:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Get weather in Paris, Tokyo, and New York simultaneously',
  tools: [weatherTool],
});

// All three weather calls execute in parallel
const text = await result.getText();
```

### Manual Tool Handling

For tools without execute functions:

```typescript
const confirmTool = tool({
  name: 'send_email',
  description: 'Send an email (requires confirmation)',
  inputSchema: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
  }),
  execute: false, // Manual handling
});

const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Send an email to alice@example.com',
  tools: [confirmTool],
  maxToolRounds: 0,
});

const toolCalls = await result.getToolCalls();

for (const call of toolCalls) {
  if (call.name === 'send_email') {
    // Show confirmation UI
    const confirmed = await showConfirmDialog(call.arguments);

    if (confirmed) {
      await sendEmail(call.arguments);
    }
  }
}
```

### Execution Results

Access execution metadata through getResponse():

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'What is 2+2 and the weather in Paris?',
  tools: [calculatorTool, weatherTool],
});

const response = await result.getResponse();

// Response includes all execution rounds
console.log('Final output:', response.output);
console.log('Usage:', response.usage);
```

## Error Handling

### Tool Execution Errors

Errors in execute functions are caught and sent back to the model:

```typescript
const riskyTool = tool({
  name: 'risky_operation',
  inputSchema: z.object({ input: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  execute: async (params) => {
    if (params.input === 'fail') {
      throw new Error('Operation failed: invalid input');
    }
    return { result: 'success' };
  },
});

const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Try the risky operation with "fail"',
  tools: [riskyTool],
});

// Model receives error message and can respond appropriately
const text = await result.getText();
// "I tried the operation but it failed with: Operation failed: invalid input"
```

### Validation Errors

Invalid tool arguments are caught before execution:

```typescript
const strictTool = tool({
  name: 'strict',
  inputSchema: z.object({
    email: z.string().email(),
    age: z.number().min(0).max(150),
  }),
  execute: async (params) => {
    // Only runs with valid input
    return { valid: true };
  },
});
```

### Graceful Error Handling

Handle errors gracefully in execute functions:

```typescript
const robustTool = tool({
  name: 'fetch_data',
  inputSchema: z.object({ url: z.string().url() }),
  outputSchema: z.object({
    data: z.unknown().optional(),
    error: z.string().optional(),
  }),
  execute: async (params) => {
    try {
      const response = await fetch(params.url);
      if (!response.ok) {
        return { error: `HTTP ${response.status}: ${response.statusText}` };
      }
      return { data: await response.json() };
    } catch (error) {
      return { error: `Failed to fetch: ${error.message}` };
    }
  },
});
```

## Best Practices

### Descriptive Names and Descriptions

```typescript
// Good: Clear name and description
const tool1 = tool({
  name: 'search_knowledge_base',
  description: 'Search the company knowledge base for documents, FAQs, and policies. Returns relevant articles with snippets.',
  // ...
});

// Avoid: Vague or generic
const tool2 = tool({
  name: 'search',
  description: 'Searches stuff',
  // ...
});
```

### Schema Descriptions

Add `.describe()` to help the model understand parameters:

```typescript
const inputSchema = z.object({
  query: z.string().describe('Natural language search query'),
  maxResults: z.number()
    .min(1)
    .max(100)
    .default(10)
    .describe('Maximum number of results to return (1-100)'),
  dateRange: z.enum(['day', 'week', 'month', 'year', 'all'])
    .default('all')
    .describe('Filter results by time period'),
});
```

### Idempotent Tools

Design tools to be safely re-executable:

```typescript
const createUserTool = tool({
  name: 'create_user',
  inputSchema: z.object({
    email: z.string().email(),
    name: z.string(),
  }),
  execute: async (params) => {
    // Check if user exists first
    const existing = await findUserByEmail(params.email);
    if (existing) {
      return { userId: existing.id, created: false };
    }

    const user = await createUser(params);
    return { userId: user.id, created: true };
  },
});
```

### Timeout Handling

Wrap long-running operations:

```typescript
const longRunningTool = tool({
  name: 'process_data',
  inputSchema: z.object({ dataId: z.string() }),
  execute: async (params) => {
    const timeoutMs = 30000;

    const result = await Promise.race([
      processData(params.dataId),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
      ),
    ]);

    return result;
  },
});
```

## Next Steps

* **[Tool Approval & State](/docs/sdks/typescript/call-model/approval-and-state)** - Human-in-the-loop approval and conversation persistence
* **[nextTurnParams](/docs/sdks/typescript/call-model/next-turn-params)** - Tool-driven context injection
* **[Stop Conditions](/docs/sdks/typescript/call-model/stop-conditions)** - Advanced execution control
* **[Examples](/docs/sdks/typescript/call-model/examples/weather-tool)** - Complete tool implementations
***

title: Tool Approval & State Persistence
subtitle: >-
Add human-in-the-loop approval gates for sensitive tools and persist
conversation state across callModel invocations.
headline: Tool Approval & State Persistence | OpenRouter SDK
canonical-url: '[https://openrouter.ai/docs/sdks/typescript/call-model/approval-and-state](https://openrouter.ai/docs/sdks/typescript/call-model/approval-and-state)'
'og:site\_name': OpenRouter Documentation
'og:title': Tool Approval & State Persistence - OpenRouter SDK
'og:description': >-
Add human-in-the-loop approval for sensitive tool calls and persist
conversation state across callModel runs. Supports approval gates, resumption,
and interruption recovery.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Tool%20Approval%20%26%20State\&description=Human-in-the-Loop%20Tool%20Control](https://openrouter.ai/dynamic-og?title=Tool%20Approval%20%26%20State\&description=Human-in-the-Loop%20Tool%20Control)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

## Why Approval Gates?

Some tools — sending emails, making payments, deleting records — should not auto-execute without human review. The SDK provides two mechanisms to control this:

* **`requireApproval`** — pause execution when the model calls sensitive tools, giving users a chance to approve or reject each call
* **`StateAccessor`** — persist conversation state between `callModel` invocations so approval decisions, message history, and tool results survive across runs

Together, these enable human-in-the-loop workflows where a user reviews tool calls before they execute, even across separate request/response cycles (e.g., in a web application).

## Tool-Level Approval

Add `requireApproval` directly on a tool definition. It accepts a boolean or a function:

### Always Require Approval

```typescript
import { tool } from '@openrouter/agent';
import { z } from 'zod';

const sendEmailTool = tool({
  name: 'send_email',
  description: 'Send an email to a recipient',
  inputSchema: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
  }),
  outputSchema: z.object({ sent: z.boolean() }),
  requireApproval: true,
  execute: async (params) => {
    await sendEmail(params);
    return { sent: true };
  },
});
```

### Conditional Approval

Pass a function to require approval only in certain cases:

```typescript
const deleteRecordTool = tool({
  name: 'delete_record',
  description: 'Delete a record from the database',
  inputSchema: z.object({
    id: z.string(),
    environment: z.enum(['staging', 'production']),
  }),
  outputSchema: z.object({ deleted: z.boolean() }),
  requireApproval: (params, context) => {
    // Only require approval for production deletions
    return params.environment === 'production';
  },
  execute: async (params) => {
    await deleteRecord(params.id);
    return { deleted: true };
  },
});
```

The function receives the parsed tool arguments and a `TurnContext`, and can return a boolean or `Promise<boolean>`.

## Call-Level Approval

Override tool-level settings with a `requireApproval` callback on `callModel` itself:

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-4o',
  input: 'Send an email and search for documents',
  tools: [sendEmailTool, searchTool],
  state: myStateAccessor,
  requireApproval: (toolCall, context) => {
    // Require approval for any tool that modifies data
    return toolCall.name === 'send_email' || toolCall.name === 'delete_record';
  },
});
```

The call-level callback takes priority over tool-level `requireApproval` settings when both are present.

## How the Approval Flow Works

When tools with approval gates are called by the model, the SDK follows this flow:

1. **Model generates tool calls** — the model decides which tools to invoke
2. **SDK partitions tool calls** — each call is checked against `requireApproval` and split into two groups: those requiring approval and those that can auto-execute
3. **Auto-execute tools run immediately** — tools that don't need approval execute in parallel as normal
4. **State saves with pending approvals** — the conversation state updates to `status: 'awaiting_approval'` with the pending tool calls stored
5. **Control returns to the caller** — check `result.requiresApproval()` and inspect pending calls with `result.getPendingToolCalls()`
6. **Resume with decisions** — call `callModel` again with the same `state`, passing `approveToolCalls` and/or `rejectToolCalls` arrays of tool call IDs
7. **Approved tools execute** — the SDK runs approved tools and sends results to the model. Rejected tools send an error message to the model explaining the rejection
8. **Conversation continues** — the model processes tool results and generates the next response

## StateAccessor Interface

The `StateAccessor` interface enables any storage backend:

```typescript
import type { StateAccessor, ConversationState } from '@openrouter/agent';

interface StateAccessor<TTools> {
  /** Load the current conversation state, or null if none exists */
  load: () => Promise<ConversationState<TTools> | null>;
  /** Save the conversation state */
  save: (state: ConversationState<TTools>) => Promise<void>;
}
```

### In-Memory Implementation

```typescript
const conversations = new Map<string, ConversationState>();

function createStateAccessor(conversationId: string): StateAccessor {
  return {
    load: async () => conversations.get(conversationId) ?? null,
    save: async (state) => {
      conversations.set(conversationId, state);
    },
  };
}
```

For production use, implement `StateAccessor` with a persistent backend like Redis, a database, or file storage to survive process restarts.

## ConversationState

The state object tracks everything needed to resume a conversation:

| Field                | Type                      | Description                                                  |
| -------------------- | ------------------------- | ------------------------------------------------------------ |
| `id`                 | `string`                  | Unique conversation identifier                               |
| `messages`           | `OpenResponsesInputUnion` | Full message history                                         |
| `previousResponseId` | `string?`                 | Previous response ID for server-side chaining                |
| `pendingToolCalls`   | `ParsedToolCall[]?`       | Tool calls awaiting human approval                           |
| `unsentToolResults`  | `UnsentToolResult[]?`     | Executed results not yet sent to model                       |
| `partialResponse`    | `PartialResponse?`        | Data captured during interruption                            |
| `interruptedBy`      | `string?`                 | Signal from a new request that interrupted this conversation |
| `status`             | `ConversationStatus`      | Current state of the conversation                            |
| `createdAt`          | `number`                  | Creation timestamp (Unix ms)                                 |
| `updatedAt`          | `number`                  | Last update timestamp (Unix ms)                              |

### Status Values

| Status                | Meaning                                          |
| --------------------- | ------------------------------------------------ |
| `'in_progress'`       | Conversation is actively processing              |
| `'awaiting_approval'` | Paused, waiting for tool call approval/rejection |
| `'complete'`          | Conversation finished normally                   |
| `'interrupted'`       | Conversation was interrupted and can be resumed  |

## Complete Example

Here is an end-to-end example showing approval gates with state persistence:

```typescript
import { OpenRouter, tool } from '@openrouter/agent';
import type { ConversationState, StateAccessor } from '@openrouter/agent';
import { z } from 'zod';

// 1. Define a tool with approval required
const sendEmailTool = tool({
  name: 'send_email',
  description: 'Send an email',
  inputSchema: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
  }),
  outputSchema: z.object({ sent: z.boolean(), messageId: z.string() }),
  requireApproval: true,
  execute: async (params) => {
    const result = await sendEmail(params);
    return { sent: true, messageId: result.id };
  },
});

// 2. Create a state accessor (in-memory for this example)
const store = new Map<string, ConversationState>();
const conversationId = 'conv-123';

const state: StateAccessor = {
  load: async () => store.get(conversationId) ?? null,
  save: async (s) => { store.set(conversationId, s); },
};

const openrouter = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

// 3. First callModel — model will try to call the tool
const result = openrouter.callModel({
  model: 'openai/gpt-4o',
  input: 'Send a welcome email to alice@example.com',
  tools: [sendEmailTool] as const,
  state,
});

// 4. Check if approval is needed
if (await result.requiresApproval()) {
  const pending = await result.getPendingToolCalls();

  for (const call of pending) {
    console.log(`Tool: ${call.name}`);
    console.log(`To: ${call.arguments.to}`);
    console.log(`Subject: ${call.arguments.subject}`);
    console.log(`ID: ${call.id}`);
  }

  // 5. Present to user for decision, then resume
  const approved = await askUserForApproval(pending);

  const approvedIds = approved.filter(a => a.decision === 'approve').map(a => a.id);
  const rejectedIds = approved.filter(a => a.decision === 'reject').map(a => a.id);

  // 6. Second callModel — resume with approval decisions
  const resumed = openrouter.callModel({
    model: 'openai/gpt-4o',
    input: [], // No new user input needed for resumption
    tools: [sendEmailTool] as const,
    state,
    approveToolCalls: approvedIds,
    rejectToolCalls: rejectedIds,
  });

  // 7. Get the final response
  const text = await resumed.getText();
  console.log(text);
  // "I've sent the welcome email to alice@example.com."
} else {
  // No approval needed — tool ran automatically
  const text = await result.getText();
  console.log(text);
}
```

## Resumption Patterns

### Resuming from Approval

When the state has `status: 'awaiting_approval'`, pass `approveToolCalls` and/or `rejectToolCalls` to resume:

```typescript
// Load existing state
const loaded = await state.load();

if (loaded?.status === 'awaiting_approval') {
  const pending = loaded.pendingToolCalls ?? [];

  // Approve all pending calls
  const result = openrouter.callModel({
    model: 'openai/gpt-4o',
    input: [],
    tools: [sendEmailTool] as const,
    state,
    approveToolCalls: pending.map(c => c.id),
  });

  const text = await result.getText();
}
```

### Resuming from Interruption

If a conversation was interrupted (`status: 'interrupted'`), calling `callModel` with the same state resumes automatically. The SDK clears the interruption flag and continues where it left off:

```typescript
const loaded = await state.load();

if (loaded?.status === 'interrupted') {
  // Resume — the SDK picks up from the interruption point
  const result = openrouter.callModel({
    model: 'openai/gpt-4o',
    input: 'Continue where you left off',
    tools: myTools,
    state,
  });

  const text = await result.getText();
}
```

### Multi-Run Conversations

Messages accumulate automatically across `callModel` runs that share the same `StateAccessor`. Each run appends its input and response to the state's message history:

```typescript
const state: StateAccessor = createStateAccessor('conv-456');

// Turn 1
const r1 = openrouter.callModel({
  model: 'openai/gpt-4o',
  input: 'What is the weather in Tokyo?',
  tools: [weatherTool] as const,
  state,
});
console.log(await r1.getText());
// "The weather in Tokyo is 22°C and sunny."

// Turn 2 — state has full history from turn 1
const r2 = openrouter.callModel({
  model: 'openai/gpt-4o',
  input: 'And in Paris?',
  tools: [weatherTool] as const,
  state,
});
console.log(await r2.getText());
// "The weather in Paris is 15°C and cloudy."

// Turn 3 — state has history from both prior turns
const r3 = openrouter.callModel({
  model: 'openai/gpt-4o',
  input: 'Which city is warmer?',
  tools: [weatherTool] as const,
  state,
});
console.log(await r3.getText());
// "Tokyo is warmer at 22°C compared to Paris at 15°C."
```

## Next Steps

* **[Tools](/docs/sdks/typescript/call-model/tools)** - Tool definitions and the `tool()` helper
* **[Stop Conditions](/docs/sdks/typescript/call-model/stop-conditions)** - Control when tool execution loops terminate
* **[Dynamic Parameters](/docs/sdks/typescript/call-model/dynamic-parameters)** - Adjust parameters between turns
* **[Examples](/docs/sdks/typescript/call-model/examples/weather-tool)** - Complete tool implementations
***

title: Skills Loader
subtitle: >-
A complete implementation of a skills system similar to Claude Code,
demonstrating the power of `nextTurnParams` for context injection.
headline: Skills Loader Example | OpenRouter SDK
canonical-url: >-
[https://openrouter.ai/docs/sdks/typescript/call-model/tool-examples/skills-loader](https://openrouter.ai/docs/sdks/typescript/call-model/tool-examples/skills-loader)
'og:site\_name': OpenRouter Documentation
'og:title': Skills Loader Example - OpenRouter SDK
'og:description': >-
Build a complete skills system like Claude Code using nextTurnParams for
context injection, idempotency, and multi-skill loading.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Skills%20Loader\&description=Context%20Injection%20Pattern](https://openrouter.ai/dynamic-og?title=Skills%20Loader\&description=Context%20Injection%20Pattern)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

## Overview

This example shows how to build encapsulated, self-managing tools that inject domain-specific context into conversations. When a skill is loaded, it automatically enriches subsequent turns with specialized instructions.

## Prerequisites

```bash
pnpm add @openrouter/sdk zod
```

Create a skills directory:

```bash
mkdir -p ~/.claude/skills/pdf-processing
mkdir -p ~/.claude/skills/data-analysis
mkdir -p ~/.claude/skills/code-review
```

## Basic Skills Tool

```typescript
import { OpenRouter, tool } from '@openrouter/agent';
import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import { z } from 'zod';

const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const SKILLS_DIR = path.join(process.env.HOME || '~', '.claude', 'skills');

// List available skills
const listAvailableSkills = (): string[] => {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .filter((dirent) => existsSync(path.join(SKILLS_DIR, dirent.name, 'SKILL.md')))
    .map((dirent) => dirent.name);
};

const skillsTool = tool({
  name: 'Skill',
  description: `Load a specialized skill to enhance the assistant's capabilities.
Available skills: ${listAvailableSkills().join(', ') || 'none configured'}
Each skill provides domain-specific instructions and capabilities.`,

  inputSchema: z.object({
    type: z.string().describe("The skill type to load (e.g., 'pdf-processing')"),
  }),

  outputSchema: z.string(),

  // This is where the magic happens - modify context for next turn
  nextTurnParams: {
    input: (params, context) => {
      // Prevent duplicate skill loading
      const skillMarker = `[Skill: ${params.type}]`;
      if (JSON.stringify(context.input).includes(skillMarker)) {
        return context.input;
      }

      // Load the skill's instructions
      const skillPath = path.join(SKILLS_DIR, params.type, 'SKILL.md');
      if (!existsSync(skillPath)) {
        return context.input;
      }

      const skill = readFileSync(skillPath, 'utf-8');
      const skillDir = path.join(SKILLS_DIR, params.type);

      // Inject skill context into the conversation
      const currentInput = Array.isArray(context.input) ? context.input : [context.input];

      return [
        ...currentInput,
        {
          role: 'user',
          content: `${skillMarker}
Base directory for this skill: ${skillDir}

${skill}`,
        },
      ];
    },
  },

  execute: async (params, context) => {
    const skillMarker = `[Skill: ${params.type}]`;

    // Check if already loaded
    if (JSON.stringify(context?.turnRequest?.input || []).includes(skillMarker)) {
      return `Skill ${params.type} is already loaded`;
    }

    const skillPath = path.join(SKILLS_DIR, params.type, 'SKILL.md');
    if (!existsSync(skillPath)) {
      const available = listAvailableSkills();
      return `Skill "${params.type}" not found. Available skills: ${available.join(', ') || 'none'}`;
    }

    return `Launching skill ${params.type}`;
  },
});
```

## Usage

```typescript
const result = openrouter.callModel({
  model: 'anthropic/claude-sonnet-4.5',
  input: 'I need to process a PDF and extract tables from it',
  tools: [skillsTool],
});

const text = await result.getText();
// The model will call the Skill tool, loading pdf-processing context
// Subsequent responses will have access to the skill's instructions
```

## Example Skill File

Create `~/.claude/skills/pdf-processing/SKILL.md`:

```markdown
# PDF Processing Skill

You are now equipped with PDF processing capabilities.

## Available Tools
When processing PDFs, you have access to:
- `extract_text`: Extract all text from a PDF
- `extract_tables`: Extract tables as structured data
- `extract_images`: Extract embedded images
- `split_pdf`: Split PDF into individual pages

## Best Practices
1. Always check PDF file size before processing
2. For large PDFs (>50 pages), process in chunks
3. OCR may be needed for scanned documents
4. Tables may span multiple pages - handle accordingly

## Output Formats
- Text: Plain text or markdown
- Tables: JSON, CSV, or markdown tables
- Images: PNG with sequential naming

## Error Handling
- If a PDF is encrypted, request the password
- If OCR fails, suggest alternative approaches
- Report page numbers for any extraction errors
```

## Extended: Multi-Skill Loader

Load multiple skills in a single call:

```typescript
const multiSkillLoader = tool({
  name: 'load_skills',
  description: 'Load multiple skills at once for complex tasks',

  inputSchema: z.object({
    skills: z.array(z.string()).describe('Array of skill names to load'),
  }),

  outputSchema: z.object({
    loaded: z.array(z.string()),
    failed: z.array(
      z.object({
        name: z.string(),
        reason: z.string(),
      })
    ),
  }),

  nextTurnParams: {
    input: (params, context) => {
      let newInput = Array.isArray(context.input) ? context.input : [context.input];

      for (const skillName of params.skills) {
        const skillMarker = `[Skill: ${skillName}]`;

        // Skip if already loaded
        if (JSON.stringify(newInput).includes(skillMarker)) {
          continue;
        }

        const skillPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');
        if (!existsSync(skillPath)) {
          continue;
        }

        const skillContent = readFileSync(skillPath, 'utf-8');
        const skillDir = path.join(SKILLS_DIR, skillName);

        newInput = [
          ...newInput,
          {
            role: 'user',
            content: `${skillMarker}
Base directory: ${skillDir}

${skillContent}`,
          },
        ];
      }

      return newInput;
    },
  },

  execute: async ({ skills }) => {
    const loaded: string[] = [];
    const failed: Array<{ name: string; reason: string }> = [];

    for (const skill of skills) {
      const skillPath = path.join(SKILLS_DIR, skill, 'SKILL.md');
      if (existsSync(skillPath)) {
        loaded.push(skill);
      } else {
        failed.push({ name: skill, reason: 'Skill not found' });
      }
    }

    return { loaded, failed };
  },
});

// Usage
const result = openrouter.callModel({
  model: 'anthropic/claude-sonnet-4.5',
  input: 'I need to analyze a PDF report and create visualizations',
  tools: [multiSkillLoader],
});
// Model might call: load_skills({ skills: ['pdf-processing', 'data-analysis'] })
```

## Extended: Skill with Options

Skills that accept configuration:

```typescript
const configurableSkillLoader = tool({
  name: 'configure_skill',
  description: 'Load a skill with custom configuration options',

  inputSchema: z.object({
    skillName: z.string(),
    options: z
      .object({
        verbosity: z.enum(['minimal', 'normal', 'detailed']).default('normal'),
        strictMode: z.boolean().default(false),
        outputFormat: z.enum(['json', 'markdown', 'plain']).default('markdown'),
      })
      .optional(),
  }),

  outputSchema: z.object({
    status: z.enum(['loaded', 'already_loaded', 'not_found']),
    message: z.string(),
    configuration: z.record(z.unknown()).optional(),
  }),

  nextTurnParams: {
    input: (params, context) => {
      const skillMarker = `[Skill: ${params.skillName}]`;
      if (JSON.stringify(context.input).includes(skillMarker)) {
        return context.input;
      }

      const skillPath = path.join(SKILLS_DIR, params.skillName, 'SKILL.md');
      if (!existsSync(skillPath)) {
        return context.input;
      }

      const skillContent = readFileSync(skillPath, 'utf-8');
      const options = params.options || {};

      // Build configuration header
      const configHeader = `
## Skill Configuration
- Verbosity: ${options.verbosity || 'normal'}
- Strict Mode: ${options.strictMode || false}
- Output Format: ${options.outputFormat || 'markdown'}
`;

      const currentInput = Array.isArray(context.input) ? context.input : [context.input];

      return [
        ...currentInput,
        {
          role: 'user',
          content: `${skillMarker}
${configHeader}

${skillContent}`,
        },
      ];
    },

    // Adjust model behavior based on skill
    temperature: (params, context) => {
      // Lower temperature for strict mode
      if (params.options?.strictMode) {
        return 0.3;
      }
      return context.temperature;
    },
  },

  execute: async ({ skillName, options }) => {
    const skillPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');

    if (!existsSync(skillPath)) {
      return {
        status: 'not_found' as const,
        message: `Skill "${skillName}" not found`,
      };
    }

    return {
      status: 'loaded' as const,
      message: `Skill "${skillName}" loaded with configuration`,
      configuration: options || {},
    };
  },
});
```

## Skill Discovery Tool

List and describe available skills:

```typescript
const skillDiscoveryTool = tool({
  name: 'list_skills',
  description: 'List all available skills with their descriptions',

  inputSchema: z.object({
    category: z.string().optional().describe('Filter by category'),
  }),

  outputSchema: z.object({
    skills: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        hasConfig: z.boolean(),
      })
    ),
    totalCount: z.number(),
  }),

  execute: async ({ category }) => {
    const availableSkills = listAvailableSkills();
    const skills = [];

    for (const skillName of availableSkills) {
      const skillPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');
      const content = readFileSync(skillPath, 'utf-8');

      // Extract first paragraph as description
      const lines = content.split('\n').filter((l) => l.trim());
      const description = lines.find((l) => !l.startsWith('#')) || 'No description';

      // Check for config file
      const configPath = path.join(SKILLS_DIR, skillName, 'config.json');
      const hasConfig = existsSync(configPath);

      skills.push({
        name: skillName,
        description: description.slice(0, 100),
        hasConfig,
      });
    }

    return {
      skills,
      totalCount: skills.length,
    };
  },
});
```

## Complete Example

Putting it all together:

```typescript
import { OpenRouter, tool, stepCountIs } from '@openrouter/agent';
import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import { z } from 'zod';

const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const SKILLS_DIR = path.join(process.env.HOME || '~', '.claude', 'skills');

// ... (include skillsTool, multiSkillLoader, skillDiscoveryTool from above)

// Use all skill tools together
const result = openrouter.callModel({
  model: 'anthropic/claude-sonnet-4.5',
  input: `I have a complex task:
1. First, show me what skills are available
2. Load the appropriate skills for PDF analysis
3. Then help me extract and analyze data from report.pdf`,
  tools: [skillDiscoveryTool, skillsTool, multiSkillLoader],
  stopWhen: stepCountIs(10),
});

const text = await result.getText();
console.log(text);
```

## Key Patterns

### 1. Idempotency

Always check if a skill is already loaded:

```typescript
nextTurnParams: {
  input: (params, context) => {
    const marker = `[Skill: ${params.type}]`;
    if (JSON.stringify(context.input).includes(marker)) {
      return context.input; // Don't add again
    }
    // ... add skill
  },
},
```

### 2. Graceful Fallbacks

Handle missing skills gracefully:

```typescript
execute: async (params) => {
  if (!existsSync(skillPath)) {
    return `Skill not found. Available: ${listAvailableSkills().join(', ')}`;
  }
  // ...
},
```

### 3. Context Preservation

Always preserve existing input:

```typescript
nextTurnParams: {
  input: (params, context) => {
    const currentInput = Array.isArray(context.input)
      ? context.input
      : [context.input];
    return [...currentInput, newMessage]; // Append, don't replace
  },
},
```

### 4. Clear Markers

Use unique markers to identify injected content:

```typescript
const skillMarker = `[Skill: ${params.type}]`;
// Makes detection reliable and content clearly labeled
```

## See Also

* **[nextTurnParams Guide](/docs/sdks/call-model/next-turn-params)** - Context injection patterns
* **[Dynamic Parameters](/docs/sdks/call-model/dynamic-parameters)** - Adaptive behavior
* **[Tools](/docs/sdks/call-model/tools)** - Multi-turn orchestration
***

title: Weather Tool
subtitle: >-
A complete weather tool demonstrating external API integration, proper
validation, and error handling.
headline: Weather Tool Example | OpenRouter SDK
canonical-url: >-
[https://openrouter.ai/docs/sdks/typescript/call-model/tool-examples/weather-tool](https://openrouter.ai/docs/sdks/typescript/call-model/tool-examples/weather-tool)
'og:site\_name': OpenRouter Documentation
'og:title': Weather Tool Example - OpenRouter SDK
'og:description': >-
Build a weather tool with external API integration, Zod validation, error
handling, and environment configuration.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Weather%20Tool\&description=API%20Integration%20Example](https://openrouter.ai/dynamic-og?title=Weather%20Tool\&description=API%20Integration%20Example)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

## Prerequisites

```bash
pnpm add @openrouter/sdk zod
```

You'll need a weather API key. This example uses [WeatherAPI](https://www.weatherapi.com/) (free tier available).

```bash
export WEATHER_API_KEY=your_api_key_here
export OPENROUTER_API_KEY=your_openrouter_key
```

## Basic Implementation

```typescript
import { OpenRouter, tool } from '@openrouter/agent';
import { z } from 'zod';

const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const weatherTool = tool({
  name: 'get_weather',
  description: 'Get current weather conditions for any city worldwide',
  inputSchema: z.object({
    city: z.string().describe('City name, e.g., "San Francisco" or "London, UK"'),
    units: z
      .enum(['celsius', 'fahrenheit'])
      .default('celsius')
      .describe('Temperature units'),
  }),
  outputSchema: z.object({
    temperature: z.number(),
    feelsLike: z.number(),
    conditions: z.string(),
    humidity: z.number(),
    windSpeed: z.number(),
    windDirection: z.string(),
    location: z.object({
      name: z.string(),
      region: z.string(),
      country: z.string(),
    }),
  }),
  execute: async ({ city, units }) => {
    const apiKey = process.env.WEATHER_API_KEY;
    if (!apiKey) {
      throw new Error('WEATHER_API_KEY environment variable not set');
    }

    const response = await fetch(
      `https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${encodeURIComponent(city)}`
    );

    if (!response.ok) {
      if (response.status === 400) {
        throw new Error(`City not found: ${city}`);
      }
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data = await response.json();

    return {
      temperature: units === 'celsius' ? data.current.temp_c : data.current.temp_f,
      feelsLike: units === 'celsius' ? data.current.feelslike_c : data.current.feelslike_f,
      conditions: data.current.condition.text,
      humidity: data.current.humidity,
      windSpeed: data.current.wind_kph,
      windDirection: data.current.wind_dir,
      location: {
        name: data.location.name,
        region: data.location.region,
        country: data.location.country,
      },
    };
  },
});
```

## Usage

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'What is the weather like in Tokyo?',
  tools: [weatherTool],
});

const text = await result.getText();
console.log(text);
// "The current weather in Tokyo, Japan is partly cloudy with a temperature
// of 22°C (feels like 24°C). Humidity is at 65% with winds from the SW
// at 15 km/h."
```

## With Multiple Cities

```typescript
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'Compare the weather in New York and Los Angeles',
  tools: [weatherTool],
});

// The model will call the tool twice, once for each city
const text = await result.getText();
```

## Extended Version with Forecast

```typescript
const forecastTool = tool({
  name: 'get_forecast',
  description: 'Get weather forecast for the next few days',
  inputSchema: z.object({
    city: z.string().describe('City name'),
    days: z.number().min(1).max(7).default(3).describe('Number of forecast days'),
    units: z.enum(['celsius', 'fahrenheit']).default('celsius'),
  }),
  outputSchema: z.object({
    location: z.string(),
    forecast: z.array(
      z.object({
        date: z.string(),
        maxTemp: z.number(),
        minTemp: z.number(),
        conditions: z.string(),
        chanceOfRain: z.number(),
      })
    ),
  }),
  execute: async ({ city, days, units }) => {
    const apiKey = process.env.WEATHER_API_KEY;
    if (!apiKey) {
      throw new Error('WEATHER_API_KEY environment variable not set');
    }

    const response = await fetch(
      `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${encodeURIComponent(city)}&days=${days}`
    );

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data = await response.json();

    return {
      location: `${data.location.name}, ${data.location.country}`,
      forecast: data.forecast.forecastday.map((day: any) => ({
        date: day.date,
        maxTemp: units === 'celsius' ? day.day.maxtemp_c : day.day.maxtemp_f,
        minTemp: units === 'celsius' ? day.day.mintemp_c : day.day.mintemp_f,
        conditions: day.day.condition.text,
        chanceOfRain: day.day.daily_chance_of_rain,
      })),
    };
  },
});

// Use both tools together
const result = openrouter.callModel({
  model: 'openai/gpt-5-nano',
  input: 'What is the weather in Paris today and for the next 3 days?',
  tools: [weatherTool, forecastTool],
});
```

## Error Handling

The tool includes proper error handling:

```typescript
const weatherToolWithRetry = tool({
  name: 'get_weather',
  description: 'Get current weather with retry logic',
  inputSchema: z.object({
    city: z.string(),
    units: z.enum(['celsius', 'fahrenheit']).default('celsius'),
  }),
  outputSchema: z.object({
    temperature: z.number(),
    conditions: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ city, units }) => {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(
          `https://api.weatherapi.com/v1/current.json?key=${process.env.WEATHER_API_KEY}&q=${encodeURIComponent(city)}`
        );

        if (response.status === 429) {
          // Rate limited, wait and retry
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        return {
          temperature: units === 'celsius' ? data.current.temp_c : data.current.temp_f,
          conditions: data.current.condition.text,
        };
      } catch (error) {
        lastError = error as Error;
      }
    }

    // Return error in output rather than throwing
    return {
      temperature: 0,
      conditions: 'Unknown',
      error: `Failed after ${maxRetries} attempts: ${lastError?.message}`,
    };
  },
});
```

## Testing

```typescript
import { describe, it, expect, mock } from 'bun:test';

describe('weatherTool', () => {
  it('returns weather data for valid city', async () => {
    // Mock the fetch response
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            current: {
              temp_c: 22,
              temp_f: 72,
              feelslike_c: 24,
              feelslike_f: 75,
              condition: { text: 'Sunny' },
              humidity: 45,
              wind_kph: 10,
              wind_dir: 'NW',
            },
            location: {
              name: 'London',
              region: 'City of London',
              country: 'UK',
            },
          }),
      })
    );

    const result = await weatherTool.function.execute(
      { city: 'London', units: 'celsius' },
      { numberOfTurns: 1 }
    );

    expect(result.temperature).toBe(22);
    expect(result.conditions).toBe('Sunny');
    expect(result.location.name).toBe('London');
  });

  it('handles city not found', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 400,
      })
    );

    await expect(
      weatherTool.function.execute(
        { city: 'InvalidCity123', units: 'celsius' },
        { numberOfTurns: 1 }
      )
    ).rejects.toThrow('City not found');
  });
});
```

## See Also

* **[Tools Guide](/docs/sdks/call-model/tools)** - Tool creation fundamentals
* **[API Reference](/docs/sdks/call-model/api-reference)** - Complete type definitions
***

title: Analytics - TypeScript SDK
subtitle: Analytics method reference
headline: Analytics | OpenRouter TypeScript SDK
canonical-url: '[https://openrouter.ai/docs/sdks/typescript/api-reference/analytics](https://openrouter.ai/docs/sdks/typescript/api-reference/analytics)'
'og:site\_name': OpenRouter Documentation
'og:title': Analytics | OpenRouter TypeScript SDK
'og:description': >-
Analytics method documentation for the OpenRouter TypeScript SDK. Learn how to
use this API endpoint with code examples.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Analytics%20-%20TypeScript%20SDK\&description=Analytics%20method%20reference](https://openrouter.ai/dynamic-og?title=Analytics%20-%20TypeScript%20SDK\&description=Analytics%20method%20reference)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouterAI'
noindex: false
nofollow: false
---------------

{/* banner:start */}

<Warning>
  The TypeScript SDK and docs are currently in beta.
  Report issues on [GitHub](https://github.com/OpenRouterTeam/typescript-sdk/issues).
</Warning>

{/* banner:end */}

## Overview

Analytics and usage endpoints

### Available Operations

* [getUserActivity](#getuseractivity) - Get user activity grouped by endpoint

## getUserActivity

Returns user activity data grouped by endpoint for the last 30 (completed) UTC days. [Management key](/docs/guides/overview/auth/management-api-keys) required.

### Example Usage

{/* UsageSnippet language="typescript" operationID="getUserActivity" method="get" path="/activity" */}

```typescript
import { OpenRouter } from "@openrouter/sdk";

const openRouter = new OpenRouter({
  httpReferer: "<value>",
  appTitle: "<value>",
  appCategories: "<value>",
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
});

async function run() {
  const result = await openRouter.analytics.getUserActivity();

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterCore } from "@openrouter/sdk/core.js";
import { analyticsGetUserActivity } from "@openrouter/sdk/funcs/analyticsGetUserActivity.js";

// Use `OpenRouterCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouter = new OpenRouterCore({
  httpReferer: "<value>",
  appTitle: "<value>",
  appCategories: "<value>",
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
});

async function run() {
  const res = await analyticsGetUserActivity(openRouter);
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("analyticsGetUserActivity failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter              | Type                                                                                                       | Required             | Description                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`              | [operations.GetUserActivityRequest](/docs/sdks/typescript/api-reference/operations/getuseractivityrequest) | :heavy\_check\_mark: | The request object to use for the request.                                                                                                                                     |
| `options`              | RequestOptions                                                                                             | :heavy\_minus\_sign: | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions` | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                    | :heavy\_minus\_sign: | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`      | [RetryConfig](/docs/sdks/typescript/api-reference/lib/retryconfig)                                         | :heavy\_minus\_sign: | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.ActivityResponse](/docs/sdks/typescript/api-reference/models/activityresponse)>**

### Errors

| Error Type                         | Status Code | Content Type     |
| ---------------------------------- | ----------- | ---------------- |
| errors.BadRequestResponseError     | 400         | application/json |
| errors.UnauthorizedResponseError   | 401         | application/json |
| errors.ForbiddenResponseError      | 403         | application/json |
| errors.NotFoundResponseError       | 404         | application/json |
| errors.InternalServerResponseError | 500         | application/json |
| errors.OpenRouterDefaultError      | 4XX, 5XX    | \*/\*            |
***

title: Chat - TypeScript SDK
subtitle: Chat method reference
headline: Chat | OpenRouter TypeScript SDK
canonical-url: '[https://openrouter.ai/docs/sdks/typescript/api-reference/chat](https://openrouter.ai/docs/sdks/typescript/api-reference/chat)'
'og:site\_name': OpenRouter Documentation
'og:title': Chat | OpenRouter TypeScript SDK
'og:description': >-
Chat method documentation for the OpenRouter TypeScript SDK. Learn how to use
this API endpoint with code examples.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Chat%20-%20TypeScript%20SDK\&description=Chat%20method%20reference](https://openrouter.ai/dynamic-og?title=Chat%20-%20TypeScript%20SDK\&description=Chat%20method%20reference)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouterAI'
noindex: false
nofollow: false
---------------

{/* banner:start */}

<Warning>
  The TypeScript SDK and docs are currently in beta.
  Report issues on [GitHub](https://github.com/OpenRouterTeam/typescript-sdk/issues).
</Warning>

{/* banner:end */}

## Overview

### Available Operations

* [send](#send) - Create a chat completion

## send

Sends a request for a model response for the given chat conversation. Supports both streaming and non-streaming modes.

### Example Usage

{/* UsageSnippet language="typescript" operationID="sendChatCompletionRequest" method="post" path="/chat/completions" */}

```typescript
import { OpenRouter } from "@openrouter/sdk";

const openRouter = new OpenRouter({
  httpReferer: "<value>",
  appTitle: "<value>",
  appCategories: "<value>",
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
});

async function run() {
  const result = await openRouter.chat.send({
    chatRequest: {
      maxTokens: 150,
      messages: [
        {
          content: "You are a helpful assistant.",
          role: "system",
        },
        {
          content: "What is the capital of France?",
          role: "user",
        },
      ],
      model: "openai/gpt-4",
      temperature: 0.7,
    },
  });

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterCore } from "@openrouter/sdk/core.js";
import { chatSend } from "@openrouter/sdk/funcs/chatSend.js";

// Use `OpenRouterCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouter = new OpenRouterCore({
  httpReferer: "<value>",
  appTitle: "<value>",
  appCategories: "<value>",
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
});

async function run() {
  const res = await chatSend(openRouter, {
    chatRequest: {
      maxTokens: 150,
      messages: [
        {
          content: "You are a helpful assistant.",
          role: "system",
        },
        {
          content: "What is the capital of France?",
          role: "user",
        },
      ],
      model: "openai/gpt-4",
      temperature: 0.7,
    },
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("chatSend failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter              | Type                                                                                                                           | Required             | Description                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`              | [operations.SendChatCompletionRequestRequest](/docs/sdks/typescript/api-reference/operations/sendchatcompletionrequestrequest) | :heavy\_check\_mark: | The request object to use for the request.                                                                                                                                     |
| `options`              | RequestOptions                                                                                                                 | :heavy\_minus\_sign: | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions` | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                                        | :heavy\_minus\_sign: | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`      | [RetryConfig](/docs/sdks/typescript/api-reference/lib/retryconfig)                                                             | :heavy\_minus\_sign: | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[operations.SendChatCompletionRequestResponse](/docs/sdks/typescript/api-reference/operations/sendchatcompletionrequestresponse)>**

### Errors

| Error Type                              | Status Code | Content Type     |
| --------------------------------------- | ----------- | ---------------- |
| errors.BadRequestResponseError          | 400         | application/json |
| errors.UnauthorizedResponseError        | 401         | application/json |
| errors.PaymentRequiredResponseError     | 402         | application/json |
| errors.NotFoundResponseError            | 404         | application/json |
| errors.RequestTimeoutResponseError      | 408         | application/json |
| errors.PayloadTooLargeResponseError     | 413         | application/json |
| errors.UnprocessableEntityResponseError | 422         | application/json |
| errors.TooManyRequestsResponseError     | 429         | application/json |
| errors.InternalServerResponseError      | 500         | application/json |
| errors.BadGatewayResponseError          | 502         | application/json |
| errors.ServiceUnavailableResponseError  | 503         | application/json |
| errors.EdgeNetworkTimeoutResponseError  | 524         | application/json |
| errors.ProviderOverloadedResponseError  | 529         | application/json |
| errors.OpenRouterDefaultError           | 4XX, 5XX    | \*/\*            |
***

title: Embeddings - TypeScript SDK
subtitle: Embeddings method reference
headline: Embeddings | OpenRouter TypeScript SDK
canonical-url: '[https://openrouter.ai/docs/sdks/typescript/api-reference/embeddings](https://openrouter.ai/docs/sdks/typescript/api-reference/embeddings)'
'og:site\_name': OpenRouter Documentation
'og:title': Embeddings | OpenRouter TypeScript SDK
'og:description': >-
Embeddings method documentation for the OpenRouter TypeScript SDK. Learn how
to use this API endpoint with code examples.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Embeddings%20-%20TypeScript%20SDK\&description=Embeddings%20method%20reference](https://openrouter.ai/dynamic-og?title=Embeddings%20-%20TypeScript%20SDK\&description=Embeddings%20method%20reference)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouterAI'
noindex: false
nofollow: false
---------------

{/* banner:start */}

<Warning>
  The TypeScript SDK and docs are currently in beta.
  Report issues on [GitHub](https://github.com/OpenRouterTeam/typescript-sdk/issues).
</Warning>

{/* banner:end */}

## Overview

Text embedding endpoints

### Available Operations

* [generate](#generate) - Submit an embedding request
* [listModels](#listmodels) - List all embeddings models

## generate

Submits an embedding request to the embeddings router

### Example Usage

{/* UsageSnippet language="typescript" operationID="createEmbeddings" method="post" path="/embeddings" */}

```typescript
import { OpenRouter } from "@openrouter/sdk";

const openRouter = new OpenRouter({
  httpReferer: "<value>",
  appTitle: "<value>",
  appCategories: "<value>",
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
});

async function run() {
  const result = await openRouter.embeddings.generate({
    requestBody: {
      input: "The quick brown fox jumps over the lazy dog",
      model: "openai/text-embedding-3-small",
    },
  });

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterCore } from "@openrouter/sdk/core.js";
import { embeddingsGenerate } from "@openrouter/sdk/funcs/embeddingsGenerate.js";

// Use `OpenRouterCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouter = new OpenRouterCore({
  httpReferer: "<value>",
  appTitle: "<value>",
  appCategories: "<value>",
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
});

async function run() {
  const res = await embeddingsGenerate(openRouter, {
    requestBody: {
      input: "The quick brown fox jumps over the lazy dog",
      model: "openai/text-embedding-3-small",
    },
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("embeddingsGenerate failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter              | Type                                                                                                         | Required             | Description                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`              | [operations.CreateEmbeddingsRequest](/docs/sdks/typescript/api-reference/operations/createembeddingsrequest) | :heavy\_check\_mark: | The request object to use for the request.                                                                                                                                     |
| `options`              | RequestOptions                                                                                               | :heavy\_minus\_sign: | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions` | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                      | :heavy\_minus\_sign: | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`      | [RetryConfig](/docs/sdks/typescript/api-reference/lib/retryconfig)                                           | :heavy\_minus\_sign: | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[operations.CreateEmbeddingsResponse](/docs/sdks/typescript/api-reference/operations/createembeddingsresponse)>**

### Errors

| Error Type                             | Status Code | Content Type     |
| -------------------------------------- | ----------- | ---------------- |
| errors.BadRequestResponseError         | 400         | application/json |
| errors.UnauthorizedResponseError       | 401         | application/json |
| errors.PaymentRequiredResponseError    | 402         | application/json |
| errors.NotFoundResponseError           | 404         | application/json |
| errors.TooManyRequestsResponseError    | 429         | application/json |
| errors.InternalServerResponseError     | 500         | application/json |
| errors.BadGatewayResponseError         | 502         | application/json |
| errors.ServiceUnavailableResponseError | 503         | application/json |
| errors.EdgeNetworkTimeoutResponseError | 524         | application/json |
| errors.ProviderOverloadedResponseError | 529         | application/json |
| errors.OpenRouterDefaultError          | 4XX, 5XX    | \*/\*            |

## listModels

Returns a list of all available embeddings models and their properties

### Example Usage

{/* UsageSnippet language="typescript" operationID="listEmbeddingsModels" method="get" path="/embeddings/models" */}

```typescript
import { OpenRouter } from "@openrouter/sdk";

const openRouter = new OpenRouter({
  httpReferer: "<value>",
  appTitle: "<value>",
  appCategories: "<value>",
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
});

async function run() {
  const result = await openRouter.embeddings.listModels();

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterCore } from "@openrouter/sdk/core.js";
import { embeddingsListModels } from "@openrouter/sdk/funcs/embeddingsListModels.js";

// Use `OpenRouterCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouter = new OpenRouterCore({
  httpReferer: "<value>",
  appTitle: "<value>",
  appCategories: "<value>",
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
});

async function run() {
  const res = await embeddingsListModels(openRouter);
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("embeddingsListModels failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter              | Type                                                                                                                 | Required             | Description                                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`              | [operations.ListEmbeddingsModelsRequest](/docs/sdks/typescript/api-reference/operations/listembeddingsmodelsrequest) | :heavy\_check\_mark: | The request object to use for the request.                                                                                                                                     |
| `options`              | RequestOptions                                                                                                       | :heavy\_minus\_sign: | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions` | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                              | :heavy\_minus\_sign: | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`      | [RetryConfig](/docs/sdks/typescript/api-reference/lib/retryconfig)                                                   | :heavy\_minus\_sign: | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.ModelsListResponse](/docs/sdks/typescript/api-reference/models/modelslistresponse)>**

### Errors

| Error Type                         | Status Code | Content Type     |
| ---------------------------------- | ----------- | ---------------- |
| errors.BadRequestResponseError     | 400         | application/json |
| errors.InternalServerResponseError | 500         | application/json |
| errors.OpenRouterDefaultError      | 4XX, 5XX    | \*/\*            |
***

title: Endpoints - TypeScript SDK
subtitle: Endpoints method reference
headline: Endpoints | OpenRouter TypeScript SDK
canonical-url: '[https://openrouter.ai/docs/sdks/typescript/api-reference/endpoints](https://openrouter.ai/docs/sdks/typescript/api-reference/endpoints)'
'og:site\_name': OpenRouter Documentation
'og:title': Endpoints | OpenRouter TypeScript SDK
'og:description': >-
Endpoints method documentation for the OpenRouter TypeScript SDK. Learn how to
use this API endpoint with code examples.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Endpoints%20-%20TypeScript%20SDK\&description=Endpoints%20method%20reference](https://openrouter.ai/dynamic-og?title=Endpoints%20-%20TypeScript%20SDK\&description=Endpoints%20method%20reference)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouterAI'
noindex: false
nofollow: false
---------------

{/* banner:start */}

<Warning>
  The TypeScript SDK and docs are currently in beta.
  Report issues on [GitHub](https://github.com/OpenRouterTeam/typescript-sdk/issues).
</Warning>

{/* banner:end */}

## Overview

Endpoint information

### Available Operations

* [listZdrEndpoints](#listzdrendpoints) - Preview the impact of ZDR on the available endpoints
* [list](#list) - List all endpoints for a model

## listZdrEndpoints

Preview the impact of ZDR on the available endpoints

### Example Usage

{/* UsageSnippet language="typescript" operationID="listEndpointsZdr" method="get" path="/endpoints/zdr" */}

```typescript
import { OpenRouter } from "@openrouter/sdk";

const openRouter = new OpenRouter({
  httpReferer: "<value>",
  appTitle: "<value>",
  appCategories: "<value>",
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
});

async function run() {
  const result = await openRouter.endpoints.listZdrEndpoints();

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterCore } from "@openrouter/sdk/core.js";
import { endpointsListZdrEndpoints } from "@openrouter/sdk/funcs/endpointsListZdrEndpoints.js";

// Use `OpenRouterCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouter = new OpenRouterCore({
  httpReferer: "<value>",
  appTitle: "<value>",
  appCategories: "<value>",
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
});

async function run() {
  const res = await endpointsListZdrEndpoints(openRouter);
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("endpointsListZdrEndpoints failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter              | Type                                                                                                         | Required             | Description                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`              | [operations.ListEndpointsZdrRequest](/docs/sdks/typescript/api-reference/operations/listendpointszdrrequest) | :heavy\_check\_mark: | The request object to use for the request.                                                                                                                                     |
| `options`              | RequestOptions                                                                                               | :heavy\_minus\_sign: | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions` | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                      | :heavy\_minus\_sign: | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`      | [RetryConfig](/docs/sdks/typescript/api-reference/lib/retryconfig)                                           | :heavy\_minus\_sign: | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[operations.ListEndpointsZdrResponse](/docs/sdks/typescript/api-reference/operations/listendpointszdrresponse)>**

### Errors

| Error Type                         | Status Code | Content Type     |
| ---------------------------------- | ----------- | ---------------- |
| errors.InternalServerResponseError | 500         | application/json |
| errors.OpenRouterDefaultError      | 4XX, 5XX    | \*/\*            |

## list

List all endpoints for a model

### Example Usage

{/* UsageSnippet language="typescript" operationID="listEndpoints" method="get" path="/models/{author}/{slug}/endpoints" */}

```typescript
import { OpenRouter } from "@openrouter/sdk";

const openRouter = new OpenRouter({
  httpReferer: "<value>",
  appTitle: "<value>",
  appCategories: "<value>",
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
});

async function run() {
  const result = await openRouter.endpoints.list({
    author: "<value>",
    slug: "<value>",
  });

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterCore } from "@openrouter/sdk/core.js";
import { endpointsList } from "@openrouter/sdk/funcs/endpointsList.js";

// Use `OpenRouterCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouter = new OpenRouterCore({
  httpReferer: "<value>",
  appTitle: "<value>",
  appCategories: "<value>",
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
});

async function run() {
  const res = await endpointsList(openRouter, {
    author: "<value>",
    slug: "<value>",
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("endpointsList failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter              | Type                                                                                                   | Required             | Description                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`              | [operations.ListEndpointsRequest](/docs/sdks/typescript/api-reference/operations/listendpointsrequest) | :heavy\_check\_mark: | The request object to use for the request.                                                                                                                                     |
| `options`              | RequestOptions                                                                                         | :heavy\_minus\_sign: | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions` | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                | :heavy\_minus\_sign: | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`      | [RetryConfig](/docs/sdks/typescript/api-reference/lib/retryconfig)                                     | :heavy\_minus\_sign: | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[operations.ListEndpointsResponse](/docs/sdks/typescript/api-reference/operations/listendpointsresponse)>**

### Errors

| Error Type                         | Status Code | Content Type     |
| ---------------------------------- | ----------- | ---------------- |
| errors.NotFoundResponseError       | 404         | application/json |
| errors.InternalServerResponseError | 500         | application/json |
| errors.OpenRouterDefaultError      | 4XX, 5XX    | \*/\*            |
***

title: Models - TypeScript SDK
subtitle: Models method reference
headline: Models | OpenRouter TypeScript SDK
canonical-url: '[https://openrouter.ai/docs/sdks/typescript/api-reference/models](https://openrouter.ai/docs/sdks/typescript/api-reference/models)'
'og:site\_name': OpenRouter Documentation
'og:title': Models | OpenRouter TypeScript SDK
'og:description': >-
Models method documentation for the OpenRouter TypeScript SDK. Learn how to
use this API endpoint with code examples.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Models%20-%20TypeScript%20SDK\&description=Models%20method%20reference](https://openrouter.ai/dynamic-og?title=Models%20-%20TypeScript%20SDK\&description=Models%20method%20reference)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouterAI'
noindex: false
nofollow: false
---------------

{/* banner:start */}

<Warning>
  The TypeScript SDK and docs are currently in beta.
  Report issues on [GitHub](https://github.com/OpenRouterTeam/typescript-sdk/issues).
</Warning>

{/* banner:end */}

## Overview

Model information endpoints

### Available Operations

* [list](#list) - List all models and their properties
* [count](#count) - Get total count of available models
* [listForUser](#listforuser) - List models filtered by user provider preferences, privacy settings, and guardrails

## list

List all models and their properties

### Example Usage

{/* UsageSnippet language="typescript" operationID="getModels" method="get" path="/models" */}

```typescript
import { OpenRouter } from "@openrouter/sdk";

const openRouter = new OpenRouter({
  httpReferer: "<value>",
  appTitle: "<value>",
  appCategories: "<value>",
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
});

async function run() {
  const result = await openRouter.models.list();

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterCore } from "@openrouter/sdk/core.js";
import { modelsList } from "@openrouter/sdk/funcs/modelsList.js";

// Use `OpenRouterCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouter = new OpenRouterCore({
  httpReferer: "<value>",
  appTitle: "<value>",
  appCategories: "<value>",
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
});

async function run() {
  const res = await modelsList(openRouter);
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("modelsList failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter              | Type                                                                                           | Required             | Description                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`              | [operations.GetModelsRequest](/docs/sdks/typescript/api-reference/operations/getmodelsrequest) | :heavy\_check\_mark: | The request object to use for the request.                                                                                                                                     |
| `options`              | RequestOptions                                                                                 | :heavy\_minus\_sign: | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions` | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)        | :heavy\_minus\_sign: | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`      | [RetryConfig](/docs/sdks/typescript/api-reference/lib/retryconfig)                             | :heavy\_minus\_sign: | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.ModelsListResponse](/docs/sdks/typescript/api-reference/models/modelslistresponse)>**

### Errors

| Error Type                         | Status Code | Content Type     |
| ---------------------------------- | ----------- | ---------------- |
| errors.BadRequestResponseError     | 400         | application/json |
| errors.InternalServerResponseError | 500         | application/json |
| errors.OpenRouterDefaultError      | 4XX, 5XX    | \*/\*            |

## count

Get total count of available models

### Example Usage

{/* UsageSnippet language="typescript" operationID="listModelsCount" method="get" path="/models/count" */}

```typescript
import { OpenRouter } from "@openrouter/sdk";

const openRouter = new OpenRouter({
  httpReferer: "<value>",
  appTitle: "<value>",
  appCategories: "<value>",
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
});

async function run() {
  const result = await openRouter.models.count();

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterCore } from "@openrouter/sdk/core.js";
import { modelsCount } from "@openrouter/sdk/funcs/modelsCount.js";

// Use `OpenRouterCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouter = new OpenRouterCore({
  httpReferer: "<value>",
  appTitle: "<value>",
  appCategories: "<value>",
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
});

async function run() {
  const res = await modelsCount(openRouter);
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("modelsCount failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter              | Type                                                                                                       | Required             | Description                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`              | [operations.ListModelsCountRequest](/docs/sdks/typescript/api-reference/operations/listmodelscountrequest) | :heavy\_check\_mark: | The request object to use for the request.                                                                                                                                     |
| `options`              | RequestOptions                                                                                             | :heavy\_minus\_sign: | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions` | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                    | :heavy\_minus\_sign: | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`      | [RetryConfig](/docs/sdks/typescript/api-reference/lib/retryconfig)                                         | :heavy\_minus\_sign: | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.ModelsCountResponse](/docs/sdks/typescript/api-reference/models/modelscountresponse)>**

### Errors

| Error Type                         | Status Code | Content Type     |
| ---------------------------------- | ----------- | ---------------- |
| errors.BadRequestResponseError     | 400         | application/json |
| errors.InternalServerResponseError | 500         | application/json |
| errors.OpenRouterDefaultError      | 4XX, 5XX    | \*/\*            |

## listForUser

List models filtered by user provider preferences, [privacy settings](https://openrouter.ai/docs/guides/privacy/provider-logging), and [guardrails](https://openrouter.ai/docs/guides/features/guardrails). If requesting through `eu.openrouter.ai/api/v1/...` the results will be filtered to models that satisfy [EU in-region routing](https://openrouter.ai/docs/guides/privacy/provider-logging#enterprise-eu-in-region-routing).

### Example Usage

{/* UsageSnippet language="typescript" operationID="listModelsUser" method="get" path="/models/user" */}

```typescript
import { OpenRouter } from "@openrouter/sdk";

const openRouter = new OpenRouter({
  httpReferer: "<value>",
  appTitle: "<value>",
  appCategories: "<value>",
});

async function run() {
  const result = await openRouter.models.listForUser({
    bearer: process.env["OPENROUTER_BEARER"] ?? "",
  });

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterCore } from "@openrouter/sdk/core.js";
import { modelsListForUser } from "@openrouter/sdk/funcs/modelsListForUser.js";

// Use `OpenRouterCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouter = new OpenRouterCore({
  httpReferer: "<value>",
  appTitle: "<value>",
  appCategories: "<value>",
});

async function run() {
  const res = await modelsListForUser(openRouter, {
    bearer: process.env["OPENROUTER_BEARER"] ?? "",
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("modelsListForUser failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter              | Type                                                                                                       | Required             | Description                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`              | [operations.ListModelsUserRequest](/docs/sdks/typescript/api-reference/operations/listmodelsuserrequest)   | :heavy\_check\_mark: | The request object to use for the request.                                                                                                                                     |
| `security`             | [operations.ListModelsUserSecurity](/docs/sdks/typescript/api-reference/operations/listmodelsusersecurity) | :heavy\_check\_mark: | The security requirements to use for the request.                                                                                                                              |
| `options`              | RequestOptions                                                                                             | :heavy\_minus\_sign: | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions` | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)                    | :heavy\_minus\_sign: | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`      | [RetryConfig](/docs/sdks/typescript/api-reference/lib/retryconfig)                                         | :heavy\_minus\_sign: | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[models.ModelsListResponse](/docs/sdks/typescript/api-reference/models/modelslistresponse)>**

### Errors

| Error Type                         | Status Code | Content Type     |
| ---------------------------------- | ----------- | ---------------- |
| errors.UnauthorizedResponseError   | 401         | application/json |
| errors.NotFoundResponseError       | 404         | application/json |
| errors.InternalServerResponseError | 500         | application/json |
| errors.OpenRouterDefaultError      | 4XX, 5XX    | \*/\*            |
***

title: Rerank - TypeScript SDK
subtitle: Rerank method reference
headline: Rerank | OpenRouter TypeScript SDK
canonical-url: '[https://openrouter.ai/docs/sdks/typescript/api-reference/rerank](https://openrouter.ai/docs/sdks/typescript/api-reference/rerank)'
'og:site\_name': OpenRouter Documentation
'og:title': Rerank | OpenRouter TypeScript SDK
'og:description': >-
Rerank method documentation for the OpenRouter TypeScript SDK. Learn how to
use this API endpoint with code examples.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Rerank%20-%20TypeScript%20SDK\&description=Rerank%20method%20reference](https://openrouter.ai/dynamic-og?title=Rerank%20-%20TypeScript%20SDK\&description=Rerank%20method%20reference)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouterAI'
noindex: false
nofollow: false
---------------

{/* banner:start */}

<Warning>
  The TypeScript SDK and docs are currently in beta.
  Report issues on [GitHub](https://github.com/OpenRouterTeam/typescript-sdk/issues).
</Warning>

{/* banner:end */}

## Overview

Rerank endpoints

### Available Operations

* [rerank](#rerank) - Submit a rerank request

## rerank

Submits a rerank request to the rerank router

### Example Usage

{/* UsageSnippet language="typescript" operationID="createRerank" method="post" path="/rerank" */}

```typescript
import { OpenRouter } from "@openrouter/sdk";

const openRouter = new OpenRouter({
  httpReferer: "<value>",
  appTitle: "<value>",
  appCategories: "<value>",
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
});

async function run() {
  const result = await openRouter.rerank.rerank({
    requestBody: {
      documents: [
        "Paris is the capital of France.",
        "Berlin is the capital of Germany.",
      ],
      model: "cohere/rerank-v3.5",
      query: "What is the capital of France?",
    },
  });

  console.log(result);
}

run();
```

### Standalone function

The standalone function version of this method:

```typescript
import { OpenRouterCore } from "@openrouter/sdk/core.js";
import { rerankRerank } from "@openrouter/sdk/funcs/rerankRerank.js";

// Use `OpenRouterCore` for best tree-shaking performance.
// You can create one instance of it to use across an application.
const openRouter = new OpenRouterCore({
  httpReferer: "<value>",
  appTitle: "<value>",
  appCategories: "<value>",
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
});

async function run() {
  const res = await rerankRerank(openRouter, {
    requestBody: {
      documents: [
        "Paris is the capital of France.",
        "Berlin is the capital of Germany.",
      ],
      model: "cohere/rerank-v3.5",
      query: "What is the capital of France?",
    },
  });
  if (res.ok) {
    const { value: result } = res;
    console.log(result);
  } else {
    console.log("rerankRerank failed:", res.error);
  }
}

run();
```

### Parameters

| Parameter              | Type                                                                                                 | Required             | Description                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`              | [operations.CreateRerankRequest](/docs/sdks/typescript/api-reference/operations/creatererankrequest) | :heavy\_check\_mark: | The request object to use for the request.                                                                                                                                     |
| `options`              | RequestOptions                                                                                       | :heavy\_minus\_sign: | Used to set various options for making HTTP requests.                                                                                                                          |
| `options.fetchOptions` | [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#options)              | :heavy\_minus\_sign: | Options that are passed to the underlying HTTP request. This can be used to inject extra headers for examples. All `Request` options, except `method` and `body`, are allowed. |
| `options.retries`      | [RetryConfig](/docs/sdks/typescript/api-reference/lib/retryconfig)                                   | :heavy\_minus\_sign: | Enables retrying HTTP requests under certain failure conditions.                                                                                                               |

### Response

**Promise\<[operations.CreateRerankResponse](/docs/sdks/typescript/api-reference/operations/creatererankresponse)>**

### Errors

| Error Type                             | Status Code | Content Type     |
| -------------------------------------- | ----------- | ---------------- |
| errors.BadRequestResponseError         | 400         | application/json |
| errors.UnauthorizedResponseError       | 401         | application/json |
| errors.PaymentRequiredResponseError    | 402         | application/json |
| errors.NotFoundResponseError           | 404         | application/json |
| errors.TooManyRequestsResponseError    | 429         | application/json |
| errors.InternalServerResponseError     | 500         | application/json |
| errors.BadGatewayResponseError         | 502         | application/json |
| errors.ServiceUnavailableResponseError | 503         | application/json |
| errors.EdgeNetworkTimeoutResponseError | 524         | application/json |
| errors.ProviderOverloadedResponseError | 529         | application/json |
| errors.OpenRouterDefaultError          | 4XX, 5XX    | \*/\*            |
***

title: Latency and Performance
subtitle: Understanding OpenRouter's performance characteristics
headline: Latency and Performance | Minimizing Gateway Latency
canonical-url: '[https://openrouter.ai/docs/guides/best-practices/latency-and-performance](https://openrouter.ai/docs/guides/best-practices/latency-and-performance)'
'og:site\_name': OpenRouter Documentation
'og:title': Latency and Performance | Minimizing Gateway Latency
'og:description': >-
Learn about OpenRouter's performance characteristics, latency optimizations,
and best practices for achieving optimal response times.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Latency%20and%20Performance\&description=Understanding%20OpenRouter's%20performance%20characteristics](https://openrouter.ai/dynamic-og?title=Latency%20and%20Performance\&description=Understanding%20OpenRouter's%20performance%20characteristics)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

OpenRouter is designed with performance as a top priority. OpenRouter is heavily optimized to add as little latency as possible to your requests.

## Minimal Overhead

OpenRouter is designed to add minimal latency to your requests. This is achieved through:

* Edge computing using Cloudflare Workers to stay as close as possible to your application
* Efficient caching of user and API key data at the edge
* Optimized routing logic that minimizes processing time

## Performance Considerations

### Cache Warming

When OpenRouter's edge caches are cold (typically during the first 1-2 minutes of operation in a new region), you may experience slightly higher latency as the caches warm up. This normalizes once the caches are populated.

### Credit Balance Checks

To maintain accurate billing and prevent overages, OpenRouter performs additional database checks when:

* A user's credit balance is low (single digit dollars)
* An API key is approaching its configured credit limit

OpenRouter expires caches more aggressively under these conditions to ensure proper billing, which increases latency until additional credits are added.

### Model Fallback

When using [model routing](/docs/routing/auto-model-selection) or [provider routing](/docs/features/provider-routing), if the primary model or provider fails, OpenRouter will automatically try the next option. A failed initial completion unsurprisingly adds latency to the specific request. OpenRouter tracks provider failures, and will attempt to intelligently route around unavailable providers so that this latency is not incurred on every request.

## Best Practices

To achieve optimal performance with OpenRouter:

1. **Maintain Healthy Credit Balance**
   * Set up auto-topup with a higher threshold and amount
   * This helps avoid forced credit checks and reduces the risk of hitting zero balance
   * Recommended minimum balance: \$10-20 to ensure smooth operation

2. **Use Provider Preferences**
   * If you have specific latency requirements (whether time to first token, or time to last), there are [provider routing](/docs/features/provider-routing) features to help you achieve your performance and cost goals.
***

title: Prompt Caching
subtitle: Cache prompt messages
headline: Prompt Caching | Reduce AI Model Costs with OpenRouter
canonical-url: '[https://openrouter.ai/docs/guides/best-practices/prompt-caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)'
'og:site\_name': OpenRouter Documentation
'og:title': Prompt Caching - Optimize AI Model Costs with Smart Caching
'og:description': >-
Reduce your AI model costs with OpenRouter's prompt caching feature. Learn how
to cache and reuse responses across OpenAI, Anthropic Claude, and DeepSeek
models.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Prompt%20Caching\&description=Optimize%20AI%20model%20costs%20with%20OpenRouter](https://openrouter.ai/dynamic-og?title=Prompt%20Caching\&description=Optimize%20AI%20model%20costs%20with%20OpenRouter)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

To save on inference costs, you can enable prompt caching on supported providers and models.

Most providers automatically enable prompt caching, but note that some (see Anthropic below) require you to enable it on a per-message basis.

When using caching (whether automatically in supported models, or via the `cache_control` property), OpenRouter uses provider sticky routing to maximize cache hits — see [Provider Sticky Routing](#provider-sticky-routing) below for details.

## Provider Sticky Routing

To maximize cache hit rates, OpenRouter uses **provider sticky routing** to route your subsequent requests to the same provider endpoint after a cached request. This works automatically with both implicit caching (e.g. OpenAI, DeepSeek, Gemini 2.5) and explicit caching (e.g. Anthropic `cache_control` breakpoints).

**How it works:**

* After a request that uses prompt caching, OpenRouter remembers which provider served your request.
* Subsequent requests for the same model are routed to the same provider, keeping your cache warm.
* Sticky routing only activates when the provider's cache read pricing is cheaper than regular prompt pricing, ensuring you always benefit from cost savings.
* If the sticky provider becomes unavailable, OpenRouter automatically falls back to the next-best provider.
* Sticky routing is not used when you specify a manual [provider order](/docs/api-reference/provider-preferences) via `provider.order` — in that case, your explicit ordering takes priority.

**Sticky routing granularity:**

Sticky routing is tracked at the account level, per model, and per conversation. OpenRouter identifies conversations by hashing the first system (or developer) message and the first non-system message in each request, so requests that share the same opening messages are routed to the same provider. This means different conversations naturally stick to different providers, improving load-balancing and throughput while keeping caches warm within each conversation.

## Inspecting cache usage

To see how much caching saved on each generation, you can:

1. Click the detail button on the [Activity](/activity) page
2. Use the `/api/v1/generation` API, [documented here](/docs/api/api-reference/generations/get-generation)
3. Check the `prompt_tokens_details` object in the [usage response](/docs/guides/administration/usage-accounting) included with every API response

The `cache_discount` field in the response body will tell you how much the response saved on cache usage. Some providers, like Anthropic, will have a negative discount on cache writes, but a positive discount (which reduces total cost) on cache reads.

### Usage object fields

The usage object in API responses includes detailed cache metrics in the `prompt_tokens_details` field:

```json
{
  "usage": {
    "prompt_tokens": 10339,
    "completion_tokens": 60,
    "total_tokens": 10399,
    "prompt_tokens_details": {
      "cached_tokens": 10318,
      "cache_write_tokens": 0
    }
  }
}
```

The key fields are:

* `cached_tokens`: Number of tokens read from the cache (cache hit). When this is greater than zero, you're benefiting from cached content.
* `cache_write_tokens`: Number of tokens written to the cache. This appears on the first request when establishing a new cache entry.

## OpenAI

Caching price changes:

* **Cache writes**: no cost
* **Cache reads**: (depending on the model) charged at 0.25x or 0.50x the price of the original input pricing

[Click here to view OpenAI's cache pricing per model.](https://platform.openai.com/docs/pricing)

Prompt caching with OpenAI is automated and does not require any additional configuration. There is a minimum prompt size of 1024 tokens.

[Click here to read more about OpenAI prompt caching and its limitation.](https://platform.openai.com/docs/guides/prompt-caching)

## Grok

Caching price changes:

* **Cache writes**: no cost
* **Cache reads**: charged at {GROK_CACHE_READ_MULTIPLIER}x the price of the original input pricing

[Click here to view Grok's cache pricing per model.](https://docs.x.ai/docs/models#models-and-pricing)

Prompt caching with Grok is automated and does not require any additional configuration.

## Moonshot AI

Caching price changes:

* **Cache writes**: no cost
* **Cache reads**: charged at {MOONSHOT_CACHE_READ_MULTIPLIER}x the price of the original input pricing

Prompt caching with Moonshot AI is automated and does not require any additional configuration.

## Groq

Caching price changes:

* **Cache writes**: no cost
* **Cache reads**: charged at {GROQ_CACHE_READ_MULTIPLIER}x the price of the original input pricing

Prompt caching with Groq is automated and does not require any additional configuration. Currently available on Kimi K2 models.

[Click here to view Groq's documentation.](https://console.groq.com/docs/prompt-caching)

## Anthropic Claude

Caching price changes:

* **Cache writes (5-minute TTL)**: charged at {ANTHROPIC_CACHE_WRITE_MULTIPLIER}x the price of the original input pricing
* **Cache writes (1-hour TTL)**: charged at 2x the price of the original input pricing
* **Cache reads**: charged at {ANTHROPIC_CACHE_READ_MULTIPLIER}x the price of the original input pricing

There are two ways to enable prompt caching with Anthropic:

* **Automatic caching**: Add a single `cache_control` field at the top level of your request. The system automatically applies the cache breakpoint to the last cacheable block and advances it forward as conversations grow. Best for multi-turn conversations.
* **Explicit cache breakpoints**: Place `cache_control` directly on individual content blocks for fine-grained control over exactly what gets cached. There is a limit of four explicit breakpoints. It is recommended to reserve the cache breakpoints for large bodies of text, such as character cards, CSV data, RAG data, book chapters, etc.

<Note>
  **Automatic caching** (top-level `cache_control`) is only supported when requests are routed to the **Anthropic** provider directly. Amazon Bedrock and Google Vertex AI currently do not support top-level `cache_control` — when it is present, OpenRouter will only route to the Anthropic provider and exclude Bedrock and Vertex endpoints. Explicit per-block `cache_control` breakpoints work across all Anthropic-compatible providers including Bedrock and Vertex.
</Note>

By default, the cache expires after 5 minutes, but you can extend this to 1 hour by specifying `"ttl": "1h"` in the `cache_control` object.

[Click here to read more about Anthropic prompt caching and its limitation.](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

### Supported models

The following Claude models support prompt caching (both automatic and explicit):

* Claude Opus 4.6
* Claude Opus 4.5
* Claude Opus 4.1
* Claude Opus 4
* Claude Sonnet 4.6
* Claude Sonnet 4.5
* Claude Sonnet 4
* Claude Sonnet 3.7 (deprecated)
* Claude Haiku 4.5
* Claude Haiku 3.5

### Minimum token requirements

Each model has a minimum cacheable prompt length:

* **4096 tokens**: Claude Opus 4.6, Claude Opus 4.5, Claude Haiku 4.5
* **2048 tokens**: Claude Sonnet 4.6, Claude Haiku 3.5
* **1024 tokens**: Claude Sonnet 4.5, Claude Opus 4.1, Claude Opus 4, Claude Sonnet 4, Claude Sonnet 3.7

Prompts shorter than these minimums will not be cached.

### Cache TTL Options

OpenRouter supports two cache TTL values for Anthropic:

* **5 minutes** (default): `"cache_control": { "type": "ephemeral" }`
* **1 hour**: `"cache_control": { "type": "ephemeral", "ttl": "1h" }`

The 1-hour TTL is useful for longer sessions where you want to maintain cached content across multiple requests without incurring repeated cache write costs. The 1-hour TTL costs more for cache writes (2x base input price vs 1.25x for 5-minute TTL) but can save money over extended sessions by avoiding repeated cache writes. The 1-hour TTL for explicit cache breakpoints is supported across all Claude model providers (Anthropic, Amazon Bedrock, and Google Vertex AI).

### Examples

#### Automatic caching (recommended for multi-turn conversations)

With automatic caching, add `cache_control` at the top level of the request. The system automatically caches all content up to the last cacheable block:

```json
{
  "model": "anthropic/claude-sonnet-4.6",
  "cache_control": { "type": "ephemeral" },
  "messages": [
    {
      "role": "system",
      "content": "You are a historian studying the fall of the Roman Empire. You know the following book very well: HUGE TEXT BODY"
    },
    {
      "role": "user",
      "content": "What triggered the collapse?"
    }
  ]
}
```

As the conversation grows, the cache breakpoint automatically advances to cover the growing message history.

Automatic caching with 1-hour TTL:

```json
{
  "model": "anthropic/claude-sonnet-4.6",
  "cache_control": { "type": "ephemeral", "ttl": "1h" },
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "What is the meaning of life?"
    }
  ]
}
```

#### Explicit cache breakpoints (fine-grained control)

System message caching example (default 5-minute TTL):

```json
{
  "messages": [
    {
      "role": "system",
      "content": [
        {
          "type": "text",
          "text": "You are a historian studying the fall of the Roman Empire. You know the following book very well:"
        },
        {
          "type": "text",
          "text": "HUGE TEXT BODY",
          "cache_control": {
            "type": "ephemeral"
          }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "What triggered the collapse?"
        }
      ]
    }
  ]
}
```

User message caching example with 1-hour TTL:

```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "Given the book below:"
        },
        {
          "type": "text",
          "text": "HUGE TEXT BODY",
          "cache_control": {
            "type": "ephemeral",
            "ttl": "1h"
          }
        },
        {
          "type": "text",
          "text": "Name all the characters in the above book"
        }
      ]
    }
  ]
}
```

## DeepSeek

Caching price changes:

* **Cache writes**: charged at the same price as the original input pricing
* **Cache reads**: charged at {DEEPSEEK_CACHE_READ_MULTIPLIER}x the price of the original input pricing

Prompt caching with DeepSeek is automated and does not require any additional configuration.

## Google Gemini

### Implicit Caching

Gemini 2.5 Pro and 2.5 Flash models now support **implicit caching**, providing automatic caching functionality similar to OpenAI’s automatic caching. Implicit caching works seamlessly — no manual setup or additional `cache_control` breakpoints required.

Pricing Changes:

* No cache write or storage costs.
* Cached tokens are charged at {GOOGLE_CACHE_READ_MULTIPLIER}x the original input token cost.

Note that the TTL is on average 3-5 minutes, but will vary. There is a minimum of {GOOGLE_CACHE_MIN_TOKENS_2_5_FLASH} tokens for Gemini 2.5 Flash, and {GOOGLE_CACHE_MIN_TOKENS_2_5_PRO} tokens for Gemini 2.5 Pro for requests to be eligible for caching.

[Official announcement from Google](https://developers.googleblog.com/en/gemini-2-5-models-now-support-implicit-caching/)

<Tip>
  To maximize implicit cache hits, keep the initial portion of your message
  arrays consistent between requests. Push variations (such as user questions or
  dynamic context elements) toward the end of your prompt/requests.
</Tip>

### Pricing Changes for Cached Requests:

* **Cache Writes:** Charged at the input token cost plus 5 minutes of cache storage, calculated as follows:

```
Cache write cost = Input token price + (Cache storage price × (5 minutes / 60 minutes))
```

* **Cache Reads:** Charged at {GOOGLE_CACHE_READ_MULTIPLIER}× the original input token cost.

### Supported Models and Limitations:

Only certain Gemini models support caching. Please consult Google's [Gemini API Pricing Documentation](https://ai.google.dev/gemini-api/docs/pricing) for the most current details.

Cache Writes have a 5 minute Time-to-Live (TTL) that does not update. After 5 minutes, the cache expires and a new cache must be written.

Gemini models have typically have a 4096 token minimum for cache write to occur. Cached tokens count towards the model's maximum token usage. Gemini 2.5 Pro has a minimum of {GOOGLE_CACHE_MIN_TOKENS_2_5_PRO} tokens, and Gemini 2.5 Flash has a minimum of {GOOGLE_CACHE_MIN_TOKENS_2_5_FLASH} tokens.

### How Gemini Prompt Caching works on OpenRouter:

OpenRouter simplifies Gemini cache management, abstracting away complexities:

* You **do not** need to manually create, update, or delete caches.
* You **do not** need to manage cache names or TTL explicitly.

### How to Enable Gemini Prompt Caching:

Gemini caching in OpenRouter requires you to insert `cache_control` breakpoints explicitly within message content, similar to Anthropic. We recommend using caching primarily for large content pieces (such as CSV files, lengthy character cards, retrieval augmented generation (RAG) data, or extensive textual sources).

<Tip>
  There is not a limit on the number of `cache_control` breakpoints you can
  include in your request. OpenRouter will use only the last breakpoint for
  Gemini caching across normal message content. Including multiple breakpoints
  is safe and can help maintain compatibility with Anthropic, but only the
  final one will be used for Gemini.
</Tip>

<Note>
  Gemini has a single `systemInstruction` field, and cached Gemini content
  treats that `systemInstruction` as immutable. On OpenRouter, this means
  `cache_control` inside the first `system` or `developer` message can cache
  the normalized system prompt, but it cannot preserve an uncached dynamic tail
  inside that same message. If you need part of your prompt to stay dynamic,
  move that dynamic content into a later `user` message instead of appending it
  after a cached block in the first `system` message.
</Note>

### Examples:

#### System Message Caching Example

```json
{
  "messages": [
    {
      "role": "system",
      "content": [
        {
          "type": "text",
          "text": "You are a historian studying the fall of the Roman Empire. Below is an extensive reference book:"
        },
        {
          "type": "text",
          "text": "HUGE TEXT BODY HERE",
          "cache_control": {
            "type": "ephemeral"
          }
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "What triggered the collapse?"
        }
      ]
    }
  ]
}
```

This pattern works when the cached system content is stable across requests. If
you need a dynamic prompt segment, place it in a later `user` message rather
than as uncached trailing content in the first `system` message.

#### User Message Caching Example

```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "Based on the book text below:"
        },
        {
          "type": "text",
          "text": "HUGE TEXT BODY HERE",
          "cache_control": {
            "type": "ephemeral"
          }
        },
        {
          "type": "text",
          "text": "List all main characters mentioned in the text above."
        }
      ]
    }
  ]
}
```
***

title: Reasoning Tokens
headline: Reasoning Tokens | Enhanced AI Model Reasoning with OpenRouter
canonical-url: '[https://openrouter.ai/docs/guides/best-practices/reasoning-tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)'
'og:site\_name': OpenRouter Documentation
'og:title': Reasoning Tokens - Improve AI Model Decision Making
'og:description': >-
Learn how to use reasoning tokens to enhance AI model outputs. Implement
step-by-step reasoning traces for better decision making and transparency.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Reasoning%20Tokens\&description=Enhance%20AI%20model%20outputs%20with%20OpenRouter](https://openrouter.ai/dynamic-og?title=Reasoning%20Tokens\&description=Enhance%20AI%20model%20outputs%20with%20OpenRouter)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

For models that support it, the OpenRouter API can return **Reasoning Tokens**, also known as thinking tokens. OpenRouter normalizes the different ways of customizing the amount of reasoning tokens that the model will use, providing a unified interface across different providers.

Reasoning tokens provide a transparent look into the reasoning steps taken by a model. Reasoning tokens are considered output tokens and charged accordingly.

Reasoning tokens are included in the response by default if the model decides to output them. Reasoning tokens will appear in the `reasoning` field of each message, unless you decide to exclude them.

<Note title="Some reasoning models do not return their reasoning tokens">
  While most models and providers make reasoning tokens available in the
  response, some (like the OpenAI o-series) do not.
</Note>

## Controlling Reasoning Tokens

You can control reasoning tokens in your requests using the `reasoning` parameter:

```json
{
  "model": "your-model",
  "messages": [],
  "reasoning": {
    // One of the following (not both):
    "effort": "high", // Can be "xhigh", "high", "medium", "low", "minimal" or "none" (OpenAI-style)
    "max_tokens": 2000, // Specific token limit (Anthropic-style)

    // Optional: Default is false. All models support this.
    "exclude": false, // Set to true to exclude reasoning tokens from response

    // Or enable reasoning with the default parameters:
    "enabled": true // Default: inferred from `effort` or `max_tokens`
  }
}
```

The `reasoning` config object consolidates settings for controlling reasoning strength across different models. See the Note for each option below to see which models are supported and how other models will behave.

### Max Tokens for Reasoning

<Note title="Supported models">
  Currently supported by:

  <ul>
    <li>
      Gemini thinking models
    </li>

    <li>
      Anthropic reasoning models (by using the <code>reasoning.max\_tokens</code>{' '}
      parameter)
    </li>

    <li>
      Some Alibaba Qwen thinking models (mapped to 

      <code>thinking_budget</code>

      )
    </li>
  </ul>

  For Alibaba, support varies by model — please check the individual model descriptions to confirm
  whether <code>reasoning.max\_tokens</code> (via <code>thinking\_budget</code>) is available.
</Note>

For models that support reasoning token allocation, you can control it like this:

* `"max_tokens": 2000` - Directly specifies the maximum number of tokens to use for reasoning

For models that only support `reasoning.effort` (see below), the `max_tokens` value will be used to determine the effort level.

### Reasoning Effort Level

<Note title="Supported models">
  Currently supported by OpenAI reasoning models (o1 series, o3 series, GPT-5 series) and Grok models
</Note>

* `"effort": "xhigh"` - Allocates the largest portion of tokens for reasoning (approximately 95% of max\_tokens)
* `"effort": "high"` - Allocates a large portion of tokens for reasoning (approximately 80% of max\_tokens)
* `"effort": "medium"` - Allocates a moderate portion of tokens (approximately 50% of max\_tokens)
* `"effort": "low"` - Allocates a smaller portion of tokens (approximately 20% of max\_tokens)
* `"effort": "minimal"` - Allocates an even smaller portion of tokens (approximately 10% of max\_tokens)
* `"effort": "none"` - Disables reasoning entirely

For models that only support `reasoning.max_tokens`, the effort level will be set based on the percentages above.

### Excluding Reasoning Tokens

If you want the model to use reasoning internally but not include it in the response:

* `"exclude": true` - The model will still use reasoning, but it won't be returned in the response

Reasoning tokens will appear in the `reasoning` field of each message.

### Enable Reasoning with Default Config

To enable reasoning with the default parameters:

* `"enabled": true` - Enables reasoning at the "medium" effort level with no exclusions.

### Examples

#### Basic Usage with Reasoning Tokens

<Template
  data={{
  API_KEY_REF,
  MODEL: "openai/o3-mini"
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    import { OpenRouter } from '@openrouter/sdk';

    const openRouter = new OpenRouter({
      apiKey: '{{API_KEY_REF}}',
    });

    const response = await openRouter.chat.send({
      model: '{{MODEL}}',
      messages: [
        {
          role: 'user',
          content: "How would you build the world's tallest skyscraper?",
        },
      ],
      reasoning: {
        effort: 'high',
      },
      stream: false,
    });

    console.log('REASONING:', response.choices[0].message.reasoning);
    console.log('CONTENT:', response.choices[0].message.content);
    ```

    ```python title="Python (OpenAI SDK)"
    from openai import OpenAI

    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key="{{API_KEY_REF}}",
    )

    response = client.chat.completions.create(
        model="{{MODEL}}",
        messages=[
            {"role": "user", "content": "How would you build the world's tallest skyscraper?"}
        ],
        extra_body={
            "reasoning": {
                "effort": "high"
            }
        },
    )

    msg = response.choices[0].message
    print(getattr(msg, "reasoning", None))
    ```

    ```typescript title="TypeScript (OpenAI SDK)"
    import OpenAI from 'openai';

    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: '{{API_KEY_REF}}',
    });

    async function getResponseWithReasoning() {
      const response = await openai.chat.completions.create({
        model: '{{MODEL}}',
        messages: [
          {
            role: 'user',
            content: "How would you build the world's tallest skyscraper?",
          },
        ],
        reasoning: {
          effort: 'high',
        },
      });

      type ORChatMessage = (typeof response)['choices'][number]['message'] & {
        reasoning?: string;
        reasoning_details?: unknown;
      };

      const msg = response.choices[0].message as ORChatMessage;
      console.log('REASONING:', msg.reasoning);
      console.log('CONTENT:', msg.content);
    }

    getResponseWithReasoning();
    ```
  </CodeGroup>
</Template>

#### Using Max Tokens for Reasoning

For models that support direct token allocation (like Anthropic models), you can specify the exact number of tokens to use for reasoning:

<Template
  data={{
  API_KEY_REF,
  MODEL: "anthropic/claude-sonnet-4.5"
}}
>
  <CodeGroup>
    ```python Python
    from openai import OpenAI

    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key="{{API_KEY_REF}}",
    )

    response = client.chat.completions.create(
        model="{{MODEL}}",
        messages=[
            {"role": "user", "content": "What's the most efficient algorithm for sorting a large dataset?"}
        ],
        extra_body={
            "reasoning": {
                "max_tokens": 2000
            }
        },
    )

    msg = response.choices[0].message
    print(getattr(msg, "reasoning", None))
    print(getattr(msg, "content", None))
    ```

    ```typescript TypeScript
    import OpenAI from 'openai';

    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: '{{API_KEY_REF}}',
    });

    async function getResponseWithReasoning() {
      const response = await openai.chat.completions.create({
        model: '{{MODEL}}',
        messages: [
          {
            role: 'user',
            content: "How would you build the world's tallest skyscraper?",
          },
        ],
        reasoning: {
          max_tokens: 2000,
        },
      });

      type ORChatMessage = (typeof response)['choices'][number]['message'] & {
        reasoning?: string;
      };
      const msg = response.choices[0].message as ORChatMessage;

      console.log('REASONING:', msg.reasoning);
      console.log('CONTENT:', msg.content);
    }

    getResponseWithReasoning();
    ```
  </CodeGroup>
</Template>

#### Excluding Reasoning Tokens from Response

If you want the model to use reasoning internally but not include it in the response:

<Template
  data={{
  API_KEY_REF,
  MODEL: "deepseek/deepseek-r1"
}}
>
  <CodeGroup>
    ```python Python
    from openai import OpenAI

    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key="{{API_KEY_REF}}",
    )

    response = client.chat.completions.create(
        model="{{MODEL}}",
        messages=[
            {"role": "user", "content": "Explain quantum computing in simple terms."}
        ],
        extra_body={
            "reasoning": {
                "effort": "high",
                "exclude": True
            }
        },
    )

    msg = response.choices[0].message
    print(getattr(msg, "content", None))
    ```

    ```typescript TypeScript
    import OpenAI from 'openai';

    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: '{{API_KEY_REF}}',
    });

    async function getResponseWithReasoning() {
      const response = await openai.chat.completions.create({
        model: '{{MODEL}}',
        messages: [
          {
            role: 'user',
            content: "How would you build the world's tallest skyscraper?",
          },
        ],
        reasoning: {
          effort: 'high',
          exclude: true,
        },
      });

      const msg = response.choices[0].message as {
        content?: string | null;
      };
      console.log('CONTENT:', msg.content);
    }

    getResponseWithReasoning();
    ```
  </CodeGroup>
</Template>

#### Advanced Usage: Reasoning Chain-of-Thought

This example shows how to use reasoning tokens in a more complex workflow. It injects one model's reasoning into another model to improve its response quality:

<Template
  data={{
  API_KEY_REF,
}}
>
  <CodeGroup>
    ```python Python
    from openai import OpenAI

    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key="{{API_KEY_REF}}",
    )

    question = "Which is bigger: 9.11 or 9.9?"

    def do_req(model: str, content: str, reasoning_config: dict | None = None):
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": content}],
            "stop": "</think>",
        }
        if reasoning_config:
            payload.update(reasoning_config)
        return client.chat.completions.create(**payload)

    # Get reasoning from a capable model
    content = f"{question} Please think this through, but don't output an answer"
    reasoning_response = do_req("deepseek/deepseek-r1", content)
    reasoning = getattr(reasoning_response.choices[0].message, "reasoning", "")

    # Let's test! Here's the naive response:
    simple_response = do_req("openai/gpt-4o-mini", question)
    print(getattr(simple_response.choices[0].message, "content", None))

    # Here's the response with the reasoning token injected:
    content = f"{question}. Here is some context to help you: {reasoning}"
    smart_response = do_req("openai/gpt-4o-mini", content)
    print(getattr(smart_response.choices[0].message, "content", None))
    ```

    ```typescript TypeScript
    import OpenAI from 'openai';

    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: '{{API_KEY_REF}}',
    });

    async function doReq(model, content, reasoningConfig) {
      const payload = {
        model,
        messages: [{ role: 'user', content }],
        stop: '</think>',
        ...reasoningConfig,
      };

      return openai.chat.completions.create(payload);
    }

    async function getResponseWithReasoning() {
      const question = 'Which is bigger: 9.11 or 9.9?';
      const reasoningResponse = await doReq(
        'deepseek/deepseek-r1',
        `${question} Please think this through, but don't output an answer`,
      );
      const reasoning = reasoningResponse.choices[0].message.reasoning;

      // Let's test! Here's the naive response:
      const simpleResponse = await doReq('openai/gpt-4o-mini', question);
      console.log(simpleResponse.choices[0].message.content);

      // Here's the response with the reasoning token injected:
      const content = `${question}. Here is some context to help you: ${reasoning}`;
      const smartResponse = await doReq('openai/gpt-4o-mini', content);
      console.log(smartResponse.choices[0].message.content);
    }

    getResponseWithReasoning();
    ```
  </CodeGroup>
</Template>

## Preserving Reasoning

To preserve reasoning context across multiple turns, you can pass it back to the API in one of two ways:

1. **`message.reasoning`** (string): Pass the plaintext reasoning as a string field on the assistant message
2. **`message.reasoning_details`** (array): Pass the full reasoning\_details block

Use `reasoning_details` when working with models that return special reasoning types (such as encrypted or summarized) - this preserves the full structure needed for those models.

For models that only return raw reasoning strings, you can use the simpler `reasoning` field. You can also use `reasoning_content` as an alias - it functions identically to `reasoning`.

<Note title="Model Support">
  Preserving reasoning is currently supported by these proprietary models:

  <ul>
    <li>
      All OpenAI reasoning models (o1 series, o3 series, GPT-5 series and newer)
    </li>

    <li>
      All Anthropic reasoning models (Claude 3.7 series and newer)
    </li>

    <li>
      All Gemini Reasoning models
    </li>

    <li>
      All xAI reasoning models
    </li>
  </ul>

  And these open source models:

  <ul>
    <li>
      Alibaba: Qwen3.5 and newer
    </li>

    <li>
      MiniMax: MiniMax M2 and newer
    </li>

    <li>
      MoonShot: Kimi K2 Thinking and newer
    </li>

    <li>
      NVIDIA: Nemotron 3 Nano and newer
    </li>

    <li>
      Prime Intellect: INTELLECT-3
    </li>

    <li>
      Xiaomi: MiMo-V2-Flash and newer
    </li>

    <li>
      Z.ai: GLM 4.5 and newer
    </li>
  </ul>

  Note: standard interleaved thinking only. The <a href="https://docs.z.ai/guides/capabilities/thinking-mode#preserved-thinking">preserved thinking</a> feature for Z.ai models is currently not supported.
</Note>

The `reasoning_details` functionality works identically across all supported reasoning models. You can easily switch between OpenAI reasoning models (like `openai/gpt-5.2`) and Anthropic reasoning models (like `anthropic/claude-sonnet-4.5`) without changing your code structure.

Preserving reasoning blocks is useful specifically for tool calling. When models like Claude invoke tools, it is pausing its construction of a response to await external information. When tool results are returned, the model will continue building that existing response. This necessitates preserving reasoning blocks during tool use, for a couple of reasons:

**Reasoning continuity**: The reasoning blocks capture the model's step-by-step reasoning that led to tool requests. When you post tool results, including the original reasoning ensures the model can continue its reasoning from where it left off.

**Context maintenance**: While tool results appear as user messages in the API structure, they're part of a continuous reasoning flow. Preserving reasoning blocks maintains this conceptual flow across multiple API calls.

<Note title="Important for Reasoning Models">
  When providing reasoning\_details blocks, the entire sequence of consecutive
  reasoning blocks must match the outputs generated by the model during the
  original request; you cannot rearrange or modify the sequence of these blocks.
</Note>

### Example: Preserving Reasoning Blocks with OpenRouter and Claude

<Template
  data={{
  API_KEY_REF,
  MODEL: 'anthropic/claude-sonnet-4.5'
}}
>
  <CodeGroup>
    ```python
    from openai import OpenAI

    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key="{{API_KEY_REF}}",
    )

    # Define tools once and reuse
    tools = [{
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string"}
                },
                "required": ["location"]
            }
        }
    }]

    # First API call with tools
    # Note: You can use 'openai/gpt-5.2' instead of 'anthropic/claude-sonnet-4.5' - they're completely interchangeable
    response = client.chat.completions.create(
        model="{{MODEL}}",
        messages=[
            {"role": "user", "content": "What's the weather like in Boston? Then recommend what to wear."}
        ],
        tools=tools,
        extra_body={"reasoning": {"max_tokens": 2000}}
    )

    # Extract the assistant message with reasoning_details
    message = response.choices[0].message

    # Preserve the complete reasoning_details when passing back
    messages = [
        {"role": "user", "content": "What's the weather like in Boston? Then recommend what to wear."},
        {
            "role": "assistant",
            "content": message.content,
            "tool_calls": message.tool_calls,
            "reasoning_details": message.reasoning_details  # Pass back unmodified
        },
        {
            "role": "tool",
            "tool_call_id": message.tool_calls[0].id,
            "content": '{"temperature": 45, "condition": "rainy", "humidity": 85}'
        }
    ]

    # Second API call - Claude continues reasoning from where it left off
    response2 = client.chat.completions.create(
        model="{{MODEL}}",
        messages=messages,  # Includes preserved thinking blocks
        tools=tools
    )
    ```

    ```typescript
    import OpenAI from 'openai';

    const client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: '{{API_KEY_REF}}',
    });

    // Define tools once and reuse
    const tools = [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get current weather',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
            required: ['location'],
          },
        },
      },
    ] as const;

    // First API call with tools
    // Note: You can use 'openai/gpt-5.2' instead of 'anthropic/claude-sonnet-4.5' - they're completely interchangeable
    const response = await client.chat.completions.create({
      model: '{{MODEL}}',
      messages: [
        {
          role: 'user',
          content:
            "What's the weather like in Boston? Then recommend what to wear.",
        },
      ],
      tools,
      reasoning: { max_tokens: 2000 },
    });

    // Extract the assistant message with reasoning_details
    type ORChatMessage = (typeof response)['choices'][number]['message'] & {
      reasoning_details?: unknown;
    };
    const message = response.choices[0].message as ORChatMessage;

    // Preserve the complete reasoning_details when passing back
    const messages = [
      {
        role: 'user' as const,
        content: "What's the weather like in Boston? Then recommend what to wear.",
      },
      {
        role: 'assistant' as const,
        content: message.content,
        tool_calls: message.tool_calls,
        reasoning_details: message.reasoning_details, // Pass back unmodified
      },
      {
        role: 'tool' as const,
        tool_call_id: message.tool_calls?.[0]?.id,
        content: JSON.stringify({
          temperature: 45,
          condition: 'rainy',
          humidity: 85,
        }),
      },
    ];

    // Second API call - Claude continues reasoning from where it left off
    const response2 = await client.chat.completions.create({
      model: '{{MODEL}}',
      messages, // Includes preserved thinking blocks
      tools,
    });
    ```
  </CodeGroup>
</Template>

For more detailed information about thinking encryption, redacted blocks, and advanced use cases, see [Anthropic's documentation on extended thinking](https://docs.anthropic.com/en/docs/build-with-claude/tool-use#extended-thinking).

For more information about OpenAI reasoning models, see [OpenAI's reasoning documentation](https://platform.openai.com/docs/guides/reasoning#keeping-reasoning-items-in-context).

## Reasoning Details API Shape

When reasoning models generate responses, the reasoning information is structured in a standardized format through the `reasoning_details` array. This section documents the API response structure for reasoning details in both streaming and non-streaming responses.

### reasoning\_details Array Structure

The `reasoning_details` field contains an array of reasoning detail objects. Each object in the array represents a specific piece of reasoning information and follows one of three possible types. The location of this array differs between streaming and non-streaming responses.

* **Non-streaming responses**: `reasoning_details` appears in `choices[].message.reasoning_details`
* **Streaming responses**: `reasoning_details` appears in `choices[].delta.reasoning_details` for each chunk

#### Common Fields

All reasoning detail objects share these common fields:

* `id` (string | null): Unique identifier for the reasoning detail
* `format` (string): The format of the reasoning detail, with possible values:
  * `"unknown"` - Format is not specified
  * `"openai-responses-v1"` - OpenAI responses format version 1
  * `"azure-openai-responses-v1"` - Azure OpenAI responses format version 1
  * `"xai-responses-v1"` - xAI responses format version 1
  * `"anthropic-claude-v1"` - Anthropic Claude format version 1 (default)
  * `"google-gemini-v1"` - Google Gemini format version 1
* `index` (number, optional): Sequential index of the reasoning detail

#### Reasoning Detail Types

**1. Summary Type (`reasoning.summary`)**

Contains a high-level summary of the reasoning process:

```json
{
  "type": "reasoning.summary",
  "summary": "The model analyzed the problem by first identifying key constraints, then evaluating possible solutions...",
  "id": "reasoning-summary-1",
  "format": "anthropic-claude-v1",
  "index": 0
}
```

**2. Encrypted Type (`reasoning.encrypted`)**

Contains encrypted reasoning data that may be redacted or protected:

```json
{
  "type": "reasoning.encrypted",
  "data": "eyJlbmNyeXB0ZWQiOiJ0cnVlIiwiY29udGVudCI6IltSRURBQ1RFRF0ifQ==",
  "id": "reasoning-encrypted-1",
  "format": "anthropic-claude-v1",
  "index": 1
}
```

**3. Text Type (`reasoning.text`)**

Contains raw text reasoning with optional signature verification:

```json
{
  "type": "reasoning.text",
  "text": "Let me think through this step by step:\n1. First, I need to understand the user's question...",
  "signature": "sha256:abc123def456...",
  "id": "reasoning-text-1",
  "format": "anthropic-claude-v1",
  "index": 2
}
```

### Response Examples

#### Non-Streaming Response

In non-streaming responses, `reasoning_details` appears in the message:

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "Based on my analysis, I recommend the following approach...",
        "reasoning_details": [
          {
            "type": "reasoning.summary",
            "summary": "Analyzed the problem by breaking it into components",
            "id": "reasoning-summary-1",
            "format": "anthropic-claude-v1",
            "index": 0
          },
          {
            "type": "reasoning.text",
            "text": "Let me work through this systematically:\n1. First consideration...\n2. Second consideration...",
            "signature": null,
            "id": "reasoning-text-1",
            "format": "anthropic-claude-v1",
            "index": 1
          }
        ]
      }
    }
  ]
}
```

#### Streaming Response

In streaming responses, `reasoning_details` appears in delta chunks as the reasoning is generated:

```json
{
  "choices": [
    {
      "delta": {
        "reasoning_details": [
          {
            "type": "reasoning.text",
            "text": "Let me think about this step by step...",
            "signature": null,
            "id": "reasoning-text-1",
            "format": "anthropic-claude-v1",
            "index": 0
          }
        ]
      }
    }
  ]
}
```

**Streaming Behavior Notes:**

* Each reasoning detail chunk is sent as it becomes available
* The `reasoning_details` array in each chunk may contain one or more reasoning objects
* For encrypted reasoning, the content may appear as `[REDACTED]` in streaming responses
* The complete reasoning sequence is built by concatenating all chunks in order

## Legacy Parameters

For backward compatibility, OpenRouter still supports the following legacy parameters:

* `include_reasoning: true` - Equivalent to `reasoning: {}`
* `include_reasoning: false` - Equivalent to `reasoning: { exclude: true }`

However, we recommend using the new unified `reasoning` parameter for better control and future compatibility.

## Provider-Specific Reasoning Implementation

### Anthropic Models with Reasoning Tokens

The latest Claude models, such as [anthropic/claude-3.7-sonnet](https://openrouter.ai/anthropic/claude-3.7-sonnet), support working with and returning reasoning tokens.

You can enable reasoning on Anthropic models **only** using the unified `reasoning` parameter with either `effort` or `max_tokens`.

**Note:** The `:thinking` variant is no longer supported for Anthropic models. Use the `reasoning` parameter instead.

#### Reasoning Max Tokens for Anthropic Models

When using Anthropic models with reasoning:

* When using the `reasoning.max_tokens` parameter, that value is used directly with a minimum of 1024 tokens.
* When using the `reasoning.effort` parameter, the budget\_tokens are calculated based on the `max_tokens` value.

The reasoning token allocation is capped at 128,000 tokens maximum and 1024 tokens minimum. The formula for calculating the budget\_tokens is: `budget_tokens = max(min(max_tokens * {effort_ratio}, 128000), 1024)`

effort\_ratio is 0.95 for xhigh effort, 0.8 for high effort, 0.5 for medium effort, 0.2 for low effort, and 0.1 for minimal effort.

**Important**: `max_tokens` must be strictly higher than the reasoning budget to ensure there are tokens available for the final response after thinking.

<Note title="Token Usage and Billing">
  Please note that reasoning tokens are counted as output tokens for billing
  purposes. Using reasoning tokens will increase your token usage but can
  significantly improve the quality of model responses.
</Note>

#### Example: Streaming with Anthropic Reasoning Tokens

<Template
  data={{
  API_KEY_REF,
  MODEL: "anthropic/claude-3.7-sonnet"
}}
>
  <CodeGroup>
    ```python Python
    from openai import OpenAI

    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key="{{API_KEY_REF}}",
    )

    def chat_completion_with_reasoning(messages):
        response = client.chat.completions.create(
            model="{{MODEL}}",
            messages=messages,
            max_tokens=10000,
            extra_body={
                "reasoning": {
                    "max_tokens": 8000
                }
            },
            stream=True
        )
        return response

    for chunk in chat_completion_with_reasoning([
        {"role": "user", "content": "What's bigger, 9.9 or 9.11?"}
    ]):
        if hasattr(chunk.choices[0].delta, 'reasoning_details') and chunk.choices[0].delta.reasoning_details:
            print(f"REASONING_DETAILS: {chunk.choices[0].delta.reasoning_details}")
        elif getattr(chunk.choices[0].delta, 'content', None):
            print(f"CONTENT: {chunk.choices[0].delta.content}")
    ```

    ```typescript TypeScript
    import OpenAI from 'openai';

    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: '{{API_KEY_REF}}',
    });

    async function chatCompletionWithReasoning(messages) {
      const response = await openai.chat.completions.create({
        model: '{{MODEL}}',
        messages,
        max_tokens: 10000,
        reasoning: {
          max_tokens: 8000,
        },
        stream: true,
      });

      return response;
    }

    (async () => {
      for await (const chunk of chatCompletionWithReasoning([
        { role: 'user', content: "What's bigger, 9.9 or 9.11?" },
      ])) {
        if (chunk.choices[0].delta?.reasoning_details) {
          console.log(`REASONING_DETAILS:`, chunk.choices[0].delta.reasoning_details);
        } else if (chunk.choices[0].delta?.content) {
          console.log(`CONTENT: ${chunk.choices[0].delta.content}`);
        }
      }
    })();
    ```
  </CodeGroup>
</Template>

### Google Gemini 3 Models with Thinking Levels

Gemini 3 models (such as [google/gemini-3.1-pro-preview](https://openrouter.ai/google/gemini-3.1-pro-preview) and [google/gemini-3-flash-preview](https://openrouter.ai/google/gemini-3-flash-preview)) use Google's `thinkingLevel` API instead of the older `thinkingBudget` API used by Gemini 2.5 models.

OpenRouter maps the `reasoning.effort` parameter directly to Google's `thinkingLevel` values:

| OpenRouter `reasoning.effort` | Google `thinkingLevel` |
| ----------------------------- | ---------------------- |
| `"minimal"`                   | `"minimal"`            |
| `"low"`                       | `"low"`                |
| `"medium"`                    | `"medium"`             |
| `"high"`                      | `"high"`               |
| `"xhigh"`                     | `"high"` (mapped down) |

<Note title="Token Consumption is Determined by Google">
  When using `thinkingLevel`, the actual number of reasoning tokens consumed is determined internally by Google. There are no publicly documented token limit breakpoints for each level. For example, setting `effort: "low"` might result in several hundred reasoning tokens depending on the complexity of the task. This is expected behavior and reflects how Google implements thinking levels internally.
</Note>

If a model doesn't support a specific effort level (for example, if a model only supports `low` and `high`), OpenRouter will map your requested effort to the nearest supported level.

#### Using max\_tokens with Gemini 3

If you specify `reasoning.max_tokens` explicitly, OpenRouter will pass it through as `thinkingBudget` to Google's API. However, for Gemini 3 models, Google internally maps this budget value to a `thinkingLevel`, so you will not get precise token control. The actual token consumption is still determined by Google's thinkingLevel implementation, not by the specific budget value you provide.

#### Example: Using Thinking Levels with Gemini 3

<Template
  data={{
  API_KEY_REF,
  MODEL: "google/gemini-3.1-pro-preview"
}}
>
  <CodeGroup>
    ```python Python
    from openai import OpenAI

    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key="{{API_KEY_REF}}",
    )

    response = client.chat.completions.create(
        model="{{MODEL}}",
        messages=[
            {"role": "user", "content": "Explain the implications of quantum entanglement."}
        ],
        extra_body={
            "reasoning": {
                "effort": "low"  # Maps to thinkingLevel: "low"
            }
        },
    )

    msg = response.choices[0].message
    print(getattr(msg, "reasoning", None))
    print(getattr(msg, "content", None))
    ```

    ```typescript TypeScript
    import OpenAI from 'openai';

    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: '{{API_KEY_REF}}',
    });

    async function getResponseWithThinkingLevel() {
      const response = await openai.chat.completions.create({
        model: '{{MODEL}}',
        messages: [
          {
            role: 'user',
            content: 'Explain the implications of quantum entanglement.',
          },
        ],
        reasoning: {
          effort: 'low', // Maps to thinkingLevel: "low"
        },
      });

      type ORChatMessage = (typeof response)['choices'][number]['message'] & {
        reasoning?: string;
      };
      const msg = response.choices[0].message as ORChatMessage;

      console.log('REASONING:', msg.reasoning);
      console.log('CONTENT:', msg.content);
    }

    getResponseWithThinkingLevel();
    ```
  </CodeGroup>
</Template>
***

title: Distillation
subtitle: Ensure compliance with provider and model creator policies for distillation
headline: Distillation | Compliance with Provider and Model Creator Policies
canonical-url: '[https://openrouter.ai/docs/guides/evaluate-and-optimize/distillation](https://openrouter.ai/docs/guides/evaluate-and-optimize/distillation)'
'og:site\_name': OpenRouter Documentation
'og:title': Distillation - Compliance with Provider and Model Creator Policies
'og:description': >-
Learn how to use the distillable filter to ensure compliance with provider and
model creator policies when using model outputs for training or distillation.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Distillation\&description=Ensure%20compliance%20with%20provider%20and%20model%20creator%20policies](https://openrouter.ai/dynamic-og?title=Distillation\&description=Ensure%20compliance%20with%20provider%20and%20model%20creator%20policies)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

Model distillation is the process of training a smaller, more efficient model using outputs from a larger model. While this technique is powerful for creating specialized models, it's important to respect the terms of service set by model providers and creators.

Some model providers and creators explicitly prohibit using their model outputs to train other models, while others allow it. OpenRouter makes it easy to filter for models that permit distillation, helping you stay compliant with these policies.

## Why Distillation Compliance Matters

When you use model outputs to train or fine-tune other models, you need to ensure you have permission to do so. Using outputs from models that prohibit distillation could violate terms of service agreements and potentially expose you to legal liability.

OpenRouter tracks which models allow their outputs to be used for training purposes through the `is_trainable_text` property. Models where the author has explicitly allowed text distillation are marked as distillable.

<Tip>
  OpenRouter provides distillation information on a best-effort basis. You should always verify the specific license terms for your use case, as licensing requirements may vary depending on how you intend to use the model outputs.
</Tip>

## Finding Distillable Models on the Model Page

The easiest way to find models that allow distillation is to use the **Distillable** filter on the [Models page](https://openrouter.ai/models?distillable=true).

1. Navigate to the [Models page with the distillable filter enabled](https://openrouter.ai/models?distillable=true)
2. The **Distillable** filter in the filter panel will be set to **Yes**, showing only models that allow distillation

This filter shows you all models where the author has permitted their outputs to be used for training purposes, making it easy to build compliant distillation workflows.

## Using the Routing Parameter

For programmatic control, you can use the `enforce_distillable_text` parameter in your API requests. When set to `true`, OpenRouter will only route your request to models that allow text distillation.

| Field                      | Type    | Default | Description                                                   |
| -------------------------- | ------- | ------- | ------------------------------------------------------------- |
| `enforce_distillable_text` | boolean | -       | Restrict routing to only models that allow text distillation. |

When `enforce_distillable_text` is set to `true`, the request will only be routed to models where the author has explicitly enabled text distillation. If no distillable models are available for your request, you'll receive an error.

### Example: Enforcing Distillable Models

<CodeGroup>
  ```typescript title="TypeScript SDK"
  import { OpenRouter } from '@openrouter/sdk';

  const openRouter = new OpenRouter({
    apiKey: '<OPENROUTER_API_KEY>',
  });

  const completion = await openRouter.chat.send({
    model: 'meta-llama/llama-3.1-70b-instruct',
    messages: [{ role: 'user', content: 'Explain quantum computing' }],
    provider: {
      enforceDistillableText: true,
    },
    stream: false,
  });
  ```

  ```typescript title="TypeScript (fetch)"
  fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer <OPENROUTER_API_KEY>',
      'HTTP-Referer': '<YOUR_SITE_URL>',
      'X-OpenRouter-Title': '<YOUR_SITE_NAME>',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.1-70b-instruct',
      messages: [{ role: 'user', content: 'Explain quantum computing' }],
      provider: {
        enforce_distillable_text: true,
      },
    }),
  });
  ```

  ```python title="Python"
  import requests

  headers = {
    'Authorization': 'Bearer <OPENROUTER_API_KEY>',
    'HTTP-Referer': '<YOUR_SITE_URL>',
    'X-OpenRouter-Title': '<YOUR_SITE_NAME>',
    'Content-Type': 'application/json',
  }

  response = requests.post('https://openrouter.ai/api/v1/chat/completions', headers=headers, json={
    'model': 'meta-llama/llama-3.1-70b-instruct',
    'messages': [{ 'role': 'user', 'content': 'Explain quantum computing' }],
    'provider': {
      'enforce_distillable_text': True,
    },
  })
  ```

  ```bash title="cURL"
  curl https://openrouter.ai/api/v1/chat/completions \
    -H "Authorization: Bearer <OPENROUTER_API_KEY>" \
    -H "HTTP-Referer: <YOUR_SITE_URL>" \
    -H "X-OpenRouter-Title: <YOUR_SITE_NAME>" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "meta-llama/llama-3.1-70b-instruct",
      "messages": [{"role": "user", "content": "Explain quantum computing"}],
      "provider": {
        "enforce_distillable_text": true
      }
    }'
  ```
</CodeGroup>

## Use Cases

The distillable filter is particularly useful for:

* **Building training datasets**: When collecting model outputs to train or fine-tune your own models, ensure you only use outputs from models that permit this use.

* **Distillation pipelines**: When creating smaller, specialized models from larger teacher models, filter for models that allow their outputs to be used for training.

* **Compliance workflows**: Organizations with strict compliance requirements can enforce distillation policies programmatically across all API requests.

## Related Documentation

* [Provider Routing](/docs/features/provider-routing) - Learn more about the `enforce_distillable_text` parameter and other provider routing options
* [Models](/docs/overview/models) - Browse all available models and their capabilities
***

title: RAG with Embeddings & Rerank
subtitle: >-
Build retrieval-augmented generation pipelines using OpenRouter's embeddings
and rerank APIs
headline: RAG with Embeddings & Rerank | Retrieval-Augmented Generation on OpenRouter
canonical-url: '[https://openrouter.ai/docs/guides/evaluate-and-optimize/rag](https://openrouter.ai/docs/guides/evaluate-and-optimize/rag)'
'og:site\_name': OpenRouter Documentation
'og:title': RAG with Embeddings & Rerank - Build Retrieval-Augmented Generation Pipelines
'og:description': >-
Learn how to build RAG pipelines using OpenRouter embeddings for retrieval and
rerank models for precision, then generate answers with LLMs — all through a
single API.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=RAG%20with%20Embeddings%20%26%20Rerank\&description=Build%20retrieval-augmented%20generation%20pipelines](https://openrouter.ai/dynamic-og?title=RAG%20with%20Embeddings%20%26%20Rerank\&description=Build%20retrieval-augmented%20generation%20pipelines)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

Retrieval-Augmented Generation (RAG) grounds LLM responses in your own data by retrieving relevant documents before generating an answer. This prevents hallucinations and keeps responses up to date without fine-tuning.

OpenRouter provides all three building blocks for a RAG pipeline through a single API:

1. **Embeddings** — convert documents and queries into vectors for semantic search
2. **Rerank** — re-score retrieved candidates for higher precision
3. **Chat Completions** — generate a final answer using the retrieved context

## How RAG Works

A typical RAG pipeline follows these steps:

1. **Index** — chunk your documents and generate embeddings for each chunk
2. **Retrieve** — embed the user's query and find the most similar document chunks
3. **Rerank** (optional) — re-score the top candidates with a cross-encoder rerank model for better precision
4. **Generate** — pass the top documents as context to an LLM to produce a grounded answer

```
User Query
    │
    ▼
┌──────────┐     ┌──────────────┐     ┌──────────┐     ┌──────────────┐
│ Embed    │────▶│ Vector Search│────▶│ Rerank   │────▶│ LLM Generate │
│ Query    │     │ (Top N docs) │     │ (Top K)  │     │ with Context │
└──────────┘     └──────────────┘     └──────────┘     └──────────────┘
```

## Step 1: Index Your Documents

Split your documents into chunks and generate embeddings for each chunk. Store the embeddings in a vector database (or in-memory for prototyping).

<Template
  data={{
  API_KEY_REF,
  MODEL: 'openai/text-embedding-3-small'
}}
>
  <CodeGroup>
    ```python title="Python"
    import requests
    import json

    OPENROUTER_API_KEY = "{{API_KEY_REF}}"

    # Your documents, split into chunks
    chunks = [
        "OpenRouter is a unified API gateway for LLMs. It aggregates models from multiple providers.",
        "RAG stands for Retrieval-Augmented Generation. It grounds LLM answers in external data.",
        "Embeddings convert text into numerical vectors that capture semantic meaning.",
        "Reranking uses a cross-encoder to re-score documents for a given query, improving precision.",
        "Vector databases like Pinecone, Weaviate, and Qdrant store embeddings for fast similarity search.",
        "Prompt caching can reduce costs by reusing previous computations for repeated prefixes.",
        "OpenRouter supports provider routing to control which providers serve your requests.",
    ]

    # Generate embeddings for all chunks in one batch request
    response = requests.post(
        "https://openrouter.ai/api/v1/embeddings",
        headers={
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": "{{MODEL}}",
            "input": chunks,
        },
    )

    data = response.json()
    # Each item in data["data"] contains an "embedding" vector
    # Store these alongside your chunks in a vector database
    document_embeddings = [
        {"text": chunks[item["index"]], "embedding": item["embedding"]}
        for item in data["data"]
    ]

    print(f"Indexed {len(document_embeddings)} chunks with {len(document_embeddings[0]['embedding'])}-dim embeddings")
    ```

    ```typescript title="TypeScript (fetch)"
    const OPENROUTER_API_KEY = '{{API_KEY_REF}}';

    // Your documents, split into chunks
    const chunks = [
      'OpenRouter is a unified API gateway for LLMs. It aggregates models from multiple providers.',
      'RAG stands for Retrieval-Augmented Generation. It grounds LLM answers in external data.',
      'Embeddings convert text into numerical vectors that capture semantic meaning.',
      'Reranking uses a cross-encoder to re-score documents for a given query, improving precision.',
      'Vector databases like Pinecone, Weaviate, and Qdrant store embeddings for fast similarity search.',
      'Prompt caching can reduce costs by reusing previous computations for repeated prefixes.',
      'OpenRouter supports provider routing to control which providers serve your requests.',
    ];

    // Generate embeddings for all chunks in one batch request
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        input: chunks,
      }),
    });

    const data = await response.json();
    // Each item in data.data contains an "embedding" vector
    // Store these alongside your chunks in a vector database
    const documentEmbeddings = data.data.map((item: { index: number; embedding: number[] }) => ({
      text: chunks[item.index],
      embedding: item.embedding,
    }));

    console.log(`Indexed ${documentEmbeddings.length} chunks with ${documentEmbeddings[0].embedding.length}-dim embeddings`);
    ```

    ```shell title="Shell"
    curl https://openrouter.ai/api/v1/embeddings \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $OPENROUTER_API_KEY" \
      -d '{
        "model": "{{MODEL}}",
        "input": [
          "OpenRouter is a unified API gateway for LLMs.",
          "RAG stands for Retrieval-Augmented Generation.",
          "Embeddings convert text into numerical vectors."
        ]
      }'
    ```
  </CodeGroup>
</Template>

<Tip>
  In production, use a vector database (Pinecone, Weaviate, Qdrant, pgvector, etc.) to store and query embeddings efficiently. The in-memory approach shown here is for illustration only.
</Tip>

## Step 2: Retrieve Relevant Documents

When a user asks a question, embed the query and find the most similar document chunks using cosine similarity.

<Template
  data={{
  API_KEY_REF,
  MODEL: 'openai/text-embedding-3-small'
}}
>
  <CodeGroup>
    ```python title="Python"
    import numpy as np

    def cosine_similarity(a, b):
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

    def retrieve(query, document_embeddings, top_n=5):
        # Embed the query
        response = requests.post(
            "https://openrouter.ai/api/v1/embeddings",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "{{MODEL}}",
                "input": query,
            },
        )

        query_embedding = np.array(response.json()["data"][0]["embedding"])

        # Score each document by cosine similarity
        scored = []
        for doc in document_embeddings:
            score = cosine_similarity(query_embedding, np.array(doc["embedding"]))
            scored.append({"text": doc["text"], "score": float(score)})

        # Return the top N most similar chunks
        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:top_n]

    query = "What is RAG and how does it work?"
    results = retrieve(query, document_embeddings, top_n=5)

    print("Retrieved documents:")
    for i, r in enumerate(results):
        print(f"  {i+1}. (score: {r['score']:.4f}) {r['text']}")
    ```

    ```typescript title="TypeScript (fetch)"
    function cosineSimilarity(a: number[], b: number[]): number {
      const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
      const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
      const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
      return dot / (magA * magB);
    }

    async function retrieve(
      query: string,
      documentEmbeddings: { text: string; embedding: number[] }[],
      topN = 5,
    ) {
      // Embed the query
      const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: '{{MODEL}}',
          input: query,
        }),
      });

      const data = await response.json();
      const queryEmbedding: number[] = data.data[0].embedding;

      // Score each document by cosine similarity
      const scored = documentEmbeddings.map((doc) => ({
        text: doc.text,
        score: cosineSimilarity(queryEmbedding, doc.embedding),
      }));

      // Return the top N most similar chunks
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, topN);
    }

    const query = 'What is RAG and how does it work?';
    const results = await retrieve(query, documentEmbeddings, 5);

    console.log('Retrieved documents:');
    results.forEach((r, i) => {
      console.log(`  ${i + 1}. (score: ${r.score.toFixed(4)}) ${r.text}`);
    });
    ```
  </CodeGroup>
</Template>

## Step 3: Rerank for Better Precision

Embedding-based retrieval is fast but approximate. A rerank model uses a cross-encoder to compare each document directly against the query, producing more accurate relevance scores. This is especially valuable when you retrieve many candidates (e.g., 20) and want to narrow down to the best few (e.g., 3).

<Template
  data={{
  API_KEY_REF,
  RERANK_MODEL: 'cohere/rerank-v3.5'
}}
>
  <CodeGroup>
    ```python title="Python"
    def rerank(query, documents, top_n=3):
        response = requests.post(
            "https://openrouter.ai/api/v1/rerank",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "{{RERANK_MODEL}}",
                "query": query,
                "documents": documents,
                "top_n": top_n,
            },
        )

        data = response.json()
        return data["results"]

    # Use the texts from the retrieval step
    retrieved_texts = [r["text"] for r in results]

    reranked = rerank(query, retrieved_texts, top_n=3)

    print("Reranked documents:")
    for r in reranked:
        print(f"  Score: {r['relevance_score']:.4f} | {r['document']['text']}")
    ```

    ```typescript title="TypeScript (fetch)"
    async function rerank(query: string, documents: string[], topN = 3) {
      const response = await fetch('https://openrouter.ai/api/v1/rerank', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: '{{RERANK_MODEL}}',
          query,
          documents,
          top_n: topN,
        }),
      });

      const data = await response.json();
      return data.results;
    }

    // Use the texts from the retrieval step
    const retrievedTexts = results.map((r) => r.text);

    const reranked = await rerank(query, retrievedTexts, 3);

    console.log('Reranked documents:');
    for (const r of reranked) {
      console.log(`  Score: ${r.relevance_score.toFixed(4)} | ${r.document.text}`);
    }
    ```

    ```shell title="Shell"
    curl https://openrouter.ai/api/v1/rerank \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $OPENROUTER_API_KEY" \
      -d '{
        "model": "{{RERANK_MODEL}}",
        "query": "What is RAG and how does it work?",
        "documents": [
          "RAG stands for Retrieval-Augmented Generation. It grounds LLM answers in external data.",
          "Embeddings convert text into numerical vectors that capture semantic meaning.",
          "Reranking uses a cross-encoder to re-score documents for a given query, improving precision.",
          "OpenRouter is a unified API gateway for LLMs. It aggregates models from multiple providers.",
          "Vector databases like Pinecone, Weaviate, and Qdrant store embeddings for fast similarity search."
        ],
        "top_n": 3
      }'
    ```
  </CodeGroup>
</Template>

## Step 4: Generate an Answer with Context

Pass the top-ranked documents as context to a chat model. The LLM generates a grounded answer based on the retrieved information.

<Template
  data={{
  API_KEY_REF,
  CHAT_MODEL: 'openai/gpt-4.1-mini'
}}
>
  <CodeGroup>
    ```python title="Python"
    def generate_answer(query, context_docs):
        # Build a context string from the reranked documents
        context = "\n\n".join(
            f"[{i+1}] {doc['document']['text']}"
            for i, doc in enumerate(context_docs)
        )

        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "{{CHAT_MODEL}}",
                "messages": [
                    {
                        "role": "system",
                        "content": "Answer the user's question based on the provided context. "
                                   "Cite the relevant source numbers in brackets. "
                                   "If the context doesn't contain enough information, say so.",
                    },
                    {
                        "role": "user",
                        "content": f"Context:\n{context}\n\nQuestion: {query}",
                    },
                ],
            },
        )

        return response.json()["choices"][0]["message"]["content"]

    answer = generate_answer(query, reranked)
    print(f"Question: {query}")
    print(f"Answer: {answer}")
    ```

    ```typescript title="TypeScript (fetch)"
    async function generateAnswer(
      query: string,
      contextDocs: { document: { text: string } }[],
    ) {
      // Build a context string from the reranked documents
      const context = contextDocs
        .map((doc, i) => `[${i + 1}] ${doc.document.text}`)
        .join('\n\n');

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: '{{CHAT_MODEL}}',
          messages: [
            {
              role: 'system',
              content:
                "Answer the user's question based on the provided context. " +
                'Cite the relevant source numbers in brackets. ' +
                "If the context doesn't contain enough information, say so.",
            },
            {
              role: 'user',
              content: `Context:\n${context}\n\nQuestion: ${query}`,
            },
          ],
        }),
      });

      const data = await response.json();
      return data.choices[0].message.content;
    }

    const answer = await generateAnswer(query, reranked);
    console.log(`Question: ${query}`);
    console.log(`Answer: ${answer}`);
    ```
  </CodeGroup>
</Template>

## Complete Example

Here is a full end-to-end RAG pipeline combining all four steps:

<Template
  data={{
  API_KEY_REF,
  EMBEDDING_MODEL: 'openai/text-embedding-3-small',
  RERANK_MODEL: 'cohere/rerank-v3.5',
  CHAT_MODEL: 'openai/gpt-4.1-mini'
}}
>
  <CodeGroup>
    ```python title="Python"
    import requests
    import numpy as np

    OPENROUTER_API_KEY = "{{API_KEY_REF}}"
    EMBEDDING_MODEL = "{{EMBEDDING_MODEL}}"
    RERANK_MODEL = "{{RERANK_MODEL}}"
    CHAT_MODEL = "{{CHAT_MODEL}}"
    BASE_URL = "https://openrouter.ai/api/v1"

    def get_headers():
        return {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
        }

    def embed(texts):
        """Generate embeddings for a list of texts."""
        response = requests.post(
            f"{BASE_URL}/embeddings",
            headers=get_headers(),
            json={"model": EMBEDDING_MODEL, "input": texts},
        )
        return [item["embedding"] for item in response.json()["data"]]

    def cosine_similarity(a, b):
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

    def retrieve(query_embedding, doc_embeddings, top_n=10):
        """Find the top N most similar documents by cosine similarity."""
        scored = [
            (i, cosine_similarity(query_embedding, emb))
            for i, emb in enumerate(doc_embeddings)
        ]
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:top_n]

    def rerank(query, documents, top_n=3):
        """Rerank documents using a cross-encoder model."""
        response = requests.post(
            f"{BASE_URL}/rerank",
            headers=get_headers(),
            json={
                "model": RERANK_MODEL,
                "query": query,
                "documents": documents,
                "top_n": top_n,
            },
        )
        return response.json()["results"]

    def generate(query, context_docs):
        """Generate an answer grounded in the provided context."""
        context = "\n\n".join(
            f"[{i+1}] {doc}"
            for i, doc in enumerate(context_docs)
        )
        response = requests.post(
            f"{BASE_URL}/chat/completions",
            headers=get_headers(),
            json={
                "model": CHAT_MODEL,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "Answer the user's question using only the provided context. "
                            "Cite sources with [n]. If the context is insufficient, say so."
                        ),
                    },
                    {
                        "role": "user",
                        "content": f"Context:\n{context}\n\nQuestion: {query}",
                    },
                ],
            },
        )
        return response.json()["choices"][0]["message"]["content"]

    # --- Pipeline ---

    # 1. Index: chunk your knowledge base and embed
    chunks = [
        "OpenRouter is a unified API gateway for LLMs. It aggregates models from multiple providers into a single OpenAI-compatible interface.",
        "RAG stands for Retrieval-Augmented Generation. It retrieves relevant documents and uses them as context for LLM generation.",
        "Embeddings convert text into high-dimensional vectors where semantically similar texts are closer together.",
        "Reranking uses a cross-encoder to compare each document directly against the query, producing more accurate relevance scores than embedding similarity alone.",
        "Vector databases like Pinecone, Weaviate, and Qdrant are optimized for storing and querying embedding vectors at scale.",
        "Prompt caching reduces costs by reusing computations for repeated prompt prefixes across requests.",
        "OpenRouter supports provider routing to control which upstream providers serve your requests based on cost, latency, or privacy preferences.",
    ]
    doc_embeddings = embed(chunks)

    # 2. Retrieve: embed the query and find similar chunks
    query = "How does RAG improve LLM responses?"
    query_embedding = embed([query])[0]
    top_matches = retrieve(query_embedding, doc_embeddings, top_n=5)
    retrieved_texts = [chunks[i] for i, _ in top_matches]

    # 3. Rerank: re-score with a cross-encoder for better precision
    reranked = rerank(query, retrieved_texts, top_n=3)
    context_texts = [r["document"]["text"] for r in reranked]

    # 4. Generate: produce a grounded answer
    answer = generate(query, context_texts)
    print(f"Q: {query}\nA: {answer}")
    ```

    ```typescript title="TypeScript (fetch)"
    const OPENROUTER_API_KEY = '{{API_KEY_REF}}';
    const EMBEDDING_MODEL = '{{EMBEDDING_MODEL}}';
    const RERANK_MODEL = '{{RERANK_MODEL}}';
    const CHAT_MODEL = '{{CHAT_MODEL}}';
    const BASE_URL = 'https://openrouter.ai/api/v1';

    function getHeaders() {
      return {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      };
    }

    async function embed(texts: string[]): Promise<number[][]> {
      const response = await fetch(`${BASE_URL}/embeddings`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
      });
      const data = await response.json();
      return data.data.map((item: { embedding: number[] }) => item.embedding);
    }

    function cosineSimilarity(a: number[], b: number[]): number {
      const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
      const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
      const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
      return dot / (magA * magB);
    }

    function retrieve(
      queryEmbedding: number[],
      docEmbeddings: number[][],
      topN = 10,
    ): { index: number; score: number }[] {
      const scored = docEmbeddings.map((emb, i) => ({
        index: i,
        score: cosineSimilarity(queryEmbedding, emb),
      }));
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, topN);
    }

    async function rerank(query: string, documents: string[], topN = 3) {
      const response = await fetch(`${BASE_URL}/rerank`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          model: RERANK_MODEL,
          query,
          documents,
          top_n: topN,
        }),
      });
      const data = await response.json();
      return data.results as { index: number; relevance_score: number; document: { text: string } }[];
    }

    async function generate(query: string, contextDocs: string[]): Promise<string> {
      const context = contextDocs
        .map((doc, i) => `[${i + 1}] ${doc}`)
        .join('\n\n');
      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          model: CHAT_MODEL,
          messages: [
            {
              role: 'system',
              content:
                "Answer the user's question using only the provided context. " +
                'Cite sources with [n]. If the context is insufficient, say so.',
            },
            {
              role: 'user',
              content: `Context:\n${context}\n\nQuestion: ${query}`,
            },
          ],
        }),
      });
      const data = await response.json();
      return data.choices[0].message.content;
    }

    // --- Pipeline ---

    // 1. Index: chunk your knowledge base and embed
    const chunks = [
      'OpenRouter is a unified API gateway for LLMs. It aggregates models from multiple providers into a single OpenAI-compatible interface.',
      'RAG stands for Retrieval-Augmented Generation. It retrieves relevant documents and uses them as context for LLM generation.',
      'Embeddings convert text into high-dimensional vectors where semantically similar texts are closer together.',
      'Reranking uses a cross-encoder to compare each document directly against the query, producing more accurate relevance scores than embedding similarity alone.',
      'Vector databases like Pinecone, Weaviate, and Qdrant are optimized for storing and querying embedding vectors at scale.',
      'Prompt caching reduces costs by reusing computations for repeated prompt prefixes across requests.',
      'OpenRouter supports provider routing to control which upstream providers serve your requests based on cost, latency, or privacy preferences.',
    ];
    const docEmbeddings = await embed(chunks);

    // 2. Retrieve: embed the query and find similar chunks
    const query = 'How does RAG improve LLM responses?';
    const queryEmbedding = (await embed([query]))[0];
    const topMatches = retrieve(queryEmbedding, docEmbeddings, 5);
    const retrievedTexts = topMatches.map((m) => chunks[m.index]);

    // 3. Rerank: re-score with a cross-encoder for better precision
    const reranked = await rerank(query, retrievedTexts, 3);
    const contextTexts = reranked.map((r) => r.document.text);

    // 4. Generate: produce a grounded answer
    const answer = await generate(query, contextTexts);
    console.log(`Q: ${query}\nA: ${answer}`);
    ```
  </CodeGroup>
</Template>

## When to Use Rerank

Reranking adds an extra API call, so it's worth understanding when it helps most:

**Use rerank when:**

* Your knowledge base is large (hundreds or thousands of chunks) and embedding retrieval alone returns noisy results
* Precision matters more than latency (e.g., customer-facing Q\&A, legal or medical documents)
* You retrieve many candidates (e.g., top 20) and need to narrow to the best 3-5

**Skip rerank when:**

* Your knowledge base is small and embedding retrieval already returns highly relevant results
* You need the lowest possible latency (rerank adds one additional API call)
* You're building a prototype and want to keep the pipeline simple

## Chunking Strategies

How you split documents significantly affects retrieval quality:

* **By paragraph or section** — preserves semantic coherence and works well for structured documents
* **Fixed-size with overlap** — split into chunks of \~200-500 tokens with \~50-token overlap to avoid losing context at boundaries
* **By semantic boundary** — use headings, section breaks, or sentence boundaries to create natural chunks

<Tip>
  Smaller chunks (200-300 tokens) tend to produce more precise retrieval but may lose surrounding context. Larger chunks (500-1000 tokens) preserve more context but may dilute relevance signals. Experiment with your specific data to find the right balance.
</Tip>

## Best Practices

**Use the same embedding model for indexing and querying.** Mixing models produces incompatible vector spaces and will give poor retrieval results.

**Batch your embedding requests.** Send multiple texts in a single API call to reduce latency and costs. The embeddings API accepts arrays of inputs.

**Cache embeddings.** Embeddings for the same text are deterministic. Store them in a database to avoid recomputing.

**Retrieve more than you need, then rerank.** A common pattern is to retrieve 10-20 candidates via embeddings, then rerank to the top 3-5. This combines the speed of embedding search with the precision of cross-encoder reranking.

**Include metadata in your prompt.** When generating, include source metadata (document title, section, URL) alongside the text so the LLM can produce proper citations.

**Set a relevance threshold.** After reranking, filter out documents below a minimum relevance score to avoid injecting irrelevant context that could confuse the LLM.

## Available Models

Browse available models for each step:

* **Embedding models**: [openrouter.ai/models?output\_modalities=embeddings](https://openrouter.ai/models?fmt=cards\&output_modalities=embeddings)
* **Rerank models**: [openrouter.ai/models?output\_modalities=rerank](https://openrouter.ai/models?fmt=cards\&output_modalities=rerank)
* **Chat models**: [openrouter.ai/models](https://openrouter.ai/models)

## Related Resources

* [Embeddings API](/docs/api/reference/embeddings) — full API reference for generating embeddings
* [Provider Routing](/docs/features/provider-routing) — control which providers serve your requests
* [Prompt Caching](/docs/guides/best-practices/prompt-caching) — reduce costs for repeated prompt prefixes
* [Structured Outputs](/docs/guides/features/structured-outputs) — enforce JSON schema on LLM responses for structured RAG output
***

title: Enterprise Quickstart
subtitle: Get your organization up and running with OpenRouter
headline: Enterprise Quickstart | OpenRouter for Organizations
canonical-url: '[https://openrouter.ai/docs/guides/get-started/enterprise-quickstart](https://openrouter.ai/docs/guides/get-started/enterprise-quickstart)'
'og:site\_name': OpenRouter Documentation
'og:title': Enterprise Quickstart - OpenRouter for Organizations
'og:description': >-
A comprehensive guide for enterprise customers to get started with OpenRouter.
Learn about organizations, API key management, security controls, and
observability.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Enterprise%20Quickstart\&description=Get%20your%20organization%20up%20and%20running](https://openrouter.ai/dynamic-og?title=Enterprise%20Quickstart\&description=Get%20your%20organization%20up%20and%20running)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

## 1. Set Up Your Organization

Organizations enable teams to collaborate with shared credits, centralized API key management, and unified usage tracking.

To create an organization, navigate to [Settings > Preferences](https://openrouter.ai/settings/preferences) and click **Create Organization**. Once created, you can invite team members and switch between personal and organization contexts using the organization switcher.

Key organization capabilities include shared credit pools for centralized billing, role-based access control (Admin and Member roles), and organization-wide activity tracking.

For complete details on organization setup and management, see the [Organization Management](/docs/guides/administration/organization-management) guide.

## 2. Configure API Key Management

Enterprise deployments typically require programmatic API key management for automated provisioning, rotation, and lifecycle management.

### Management API Keys

Create a [Management API key](https://openrouter.ai/settings/management-keys) to manage API keys programmatically. This enables automated key creation for customer instances, programmatic key rotation for security compliance, and usage monitoring with automatic limit enforcement.

See [Management API Keys](/docs/guides/overview/auth/management-api-keys) for the full API reference and code examples.

### API Key Rotation

Regular key rotation limits the impact of compromised credentials. OpenRouter's Management API supports zero-downtime rotation: create a new key, update your applications, then delete the old key.

If you use [BYOK (Bring Your Own Key)](/docs/guides/overview/auth/byok), you can rotate OpenRouter API keys without touching your provider credentials, simplifying key management.

See [API Key Rotation](/docs/guides/administration/api-key-rotation) for step-by-step instructions.

## 3. Implement Security Controls

### Guardrails

Guardrails let organizations control how members and API keys use OpenRouter. Configure spending limits with daily, weekly, or monthly resets, model and provider allowlists to restrict access, and Zero Data Retention enforcement for sensitive workloads.

Guardrails can be assigned to organization members (baseline for all their keys) or directly to specific API keys for granular control. When multiple guardrails apply, stricter rules always win.

See [Guardrails](/docs/guides/features/guardrails) for configuration details and the [Guardrails API reference](/docs/api/api-reference/guardrails/list-guardrails) for programmatic management.

### Zero Data Retention (ZDR)

Zero Data Retention ensures providers do not store your prompts or responses. Enable ZDR globally in your [privacy settings](https://openrouter.ai/settings/privacy) or per-request using the `zdr` parameter.

OpenRouter itself has a ZDR policy and does not retain your prompts unless you explicitly opt in to prompt logging.

See [Zero Data Retention](/docs/guides/features/zdr) for the full list of ZDR-compatible endpoints and configuration options.

### Data Privacy

OpenRouter does not store your prompts or responses unless you opt in to prompt logging. Only metadata (token counts, latency, etc.) is stored for reporting and your activity feed.

See [Data Collection](/docs/guides/privacy/data-collection) and [Provider Logging](/docs/guides/privacy/provider-logging) for complete privacy documentation.

## 4. Set Up Observability

### Broadcast

Broadcast automatically sends traces from your OpenRouter requests to external observability platforms without additional instrumentation. Supported destinations include Datadog, Langfuse, LangSmith, Braintrust, OpenTelemetry Collector, S3, and more.

Configure broadcast at [Settings > Observability](https://openrouter.ai/settings/observability). You can filter traces by API key, set sampling rates, and configure up to 5 destinations of the same type for different environments.

See [Broadcast](/docs/guides/features/broadcast) for setup instructions and destination-specific walkthroughs.

### User Tracking

Track your end-users by including a `user` parameter in API requests. This improves caching performance (sticky routing per user) and enables user-level analytics in your activity feed and exports.

See [User Tracking](/docs/guides/administration/user-tracking) for implementation details.

## 5. Monitor Usage and Costs

### Usage Accounting

Every API response includes detailed usage information: token counts (prompt, completion, reasoning, cached), cost in credits, and timing data. This enables real-time cost tracking without additional API calls.

See [Usage Accounting](/docs/guides/administration/usage-accounting) for response format details and code examples.

### Activity Export

Export aggregated usage data as CSV or PDF from the [Activity page](https://openrouter.ai/activity). Filter by time period and group by Model, API Key, or Creator (organization member) for detailed reporting.

See [Activity Export](/docs/guides/administration/activity-export) for export instructions.

## 6. Optimize for Reliability

### Provider Routing and Fallbacks

OpenRouter monitors provider health in real-time and automatically routes around outages. Configure fallback chains by specifying multiple models, and customize provider selection based on cost, latency, or specific provider preferences.

See [Provider Selection](/docs/guides/routing/provider-selection) and [Model Fallbacks](/docs/guides/routing/model-fallbacks) for configuration options.

### Uptime Optimization

OpenRouter tracks response times, error rates, and availability across all providers. This data powers intelligent routing decisions and provides transparency about service reliability.

See [Uptime Optimization](/docs/guides/best-practices/uptime-optimization) for details on how OpenRouter maximizes availability.

## Next Steps

Once your organization is configured, explore these additional resources:

* [Quickstart](/docs/quickstart) for basic API integration examples
* [Structured Outputs](/docs/guides/features/structured-outputs) for JSON schema enforcement
* [Tool Calling](/docs/guides/features/tool-calling) for function calling capabilities
* [Prompt Caching](/docs/guides/best-practices/prompt-caching) for cost optimization
* [Latency and Performance](/docs/guides/best-practices/latency-and-performance) for performance tuning

For enterprise sales inquiries or custom requirements, contact our sales team at [openrouter.ai/enterprise](https://openrouter.ai/enterprise).
***

title: Structured Outputs
subtitle: Return structured data from your models
headline: Structured Outputs | Enforce JSON Schema in OpenRouter API Responses
canonical-url: '[https://openrouter.ai/docs/guides/features/structured-outputs](https://openrouter.ai/docs/guides/features/structured-outputs)'
'og:site\_name': OpenRouter Documentation
'og:title': Structured Outputs - Type-Safe JSON Responses from AI Models
'og:description': >-
Enforce JSON Schema validation on AI model responses. Get consistent,
type-safe outputs and avoid parsing errors with OpenRouter's structured output
feature.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Structured%20Outputs\&description=Type-Safe%20JSON%20Responses%20from%20AI%20Models](https://openrouter.ai/dynamic-og?title=Structured%20Outputs\&description=Type-Safe%20JSON%20Responses%20from%20AI%20Models)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

OpenRouter supports structured outputs for compatible models, ensuring responses follow a specific JSON Schema format. This feature is particularly useful when you need consistent, well-formatted responses that can be reliably parsed by your application.

## Overview

Structured outputs allow you to:

* Enforce specific JSON Schema validation on model responses
* Get consistent, type-safe outputs
* Avoid parsing errors and hallucinated fields
* Simplify response handling in your application

## Using Structured Outputs

To use structured outputs, include a `response_format` parameter in your request, with `type` set to `json_schema` and the `json_schema` object containing your schema:

```typescript
{
  "messages": [
    { "role": "user", "content": "What's the weather like in London?" }
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "weather",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "location": {
            "type": "string",
            "description": "City or location name"
          },
          "temperature": {
            "type": "number",
            "description": "Temperature in Celsius"
          },
          "conditions": {
            "type": "string",
            "description": "Weather conditions description"
          }
        },
        "required": ["location", "temperature", "conditions"],
        "additionalProperties": false
      }
    }
  }
}
```

The model will respond with a JSON object that strictly follows your schema:

```json
{
  "location": "London",
  "temperature": 18,
  "conditions": "Partly cloudy with light drizzle"
}
```

## Model Support

Structured outputs are supported by select models.

You can find a list of models that support structured outputs on the [models page](https://openrouter.ai/models?order=newest\&supported_parameters=structured_outputs).

* OpenAI models (GPT-4o and later versions) [Docs](https://platform.openai.com/docs/guides/structured-outputs)
* Google Gemini models [Docs](https://ai.google.dev/gemini-api/docs/structured-output)
* Anthropic models (Sonnet 4.5, Opus 4.1+) [Docs](https://docs.claude.com/en/docs/build-with-claude/structured-outputs)
* Most open-source models
* All Fireworks provided models [Docs](https://docs.fireworks.ai/structured-responses/structured-response-formatting#structured-response-modes)

To ensure your chosen model supports structured outputs:

1. Check the model's supported parameters on the [models page](https://openrouter.ai/models)
2. Set `require_parameters: true` in your provider preferences (see [Provider Routing](/docs/features/provider-routing))
3. Include `response_format` and set `type: json_schema` in the required parameters

## Best Practices

1. **Include descriptions**: Add clear descriptions to your schema properties to guide the model

2. **Use strict mode**: Always set `strict: true` to ensure the model follows your schema exactly

## Example Implementation

Here's a complete example using the Fetch API:

<Template
  data={{
  API_KEY_REF,
  MODEL: 'openai/gpt-4'
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    import { OpenRouter } from '@openrouter/sdk';

    const openRouter = new OpenRouter({
      apiKey: '{{API_KEY_REF}}',
    });

    const response = await openRouter.chat.send({
      model: '{{MODEL}}',
      messages: [
        { role: 'user', content: 'What is the weather like in London?' },
      ],
      responseFormat: {
        type: 'json_schema',
        jsonSchema: {
          name: 'weather',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'City or location name',
              },
              temperature: {
                type: 'number',
                description: 'Temperature in Celsius',
              },
              conditions: {
                type: 'string',
                description: 'Weather conditions description',
              },
            },
            required: ['location', 'temperature', 'conditions'],
            additionalProperties: false,
          },
        },
      },
      stream: false,
    });

    const weatherInfo = response.choices[0].message.content;
    ```

    ```python title="Python"
    import requests
    import json

    response = requests.post(
      "https://openrouter.ai/api/v1/chat/completions",
      headers={
        "Authorization": f"Bearer {{API_KEY_REF}}",
        "Content-Type": "application/json",
      },

      json={
        "model": "{{MODEL}}",
        "messages": [
          {"role": "user", "content": "What is the weather like in London?"},
        ],
        "response_format": {
          "type": "json_schema",
          "json_schema": {
            "name": "weather",
            "strict": True,
            "schema": {
              "type": "object",
              "properties": {
                "location": {
                  "type": "string",
                  "description": "City or location name",
                },
                "temperature": {
                  "type": "number",
                  "description": "Temperature in Celsius",
                },
                "conditions": {
                  "type": "string",
                  "description": "Weather conditions description",
                },
              },
              "required": ["location", "temperature", "conditions"],
              "additionalProperties": False,
            },
          },
        },
      },
    )

    data = response.json()
    weather_info = data["choices"][0]["message"]["content"]
    ```

    ```typescript title="TypeScript (fetch)"
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer {{API_KEY_REF}}',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        messages: [
          { role: 'user', content: 'What is the weather like in London?' },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'weather',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                location: {
                  type: 'string',
                  description: 'City or location name',
                },
                temperature: {
                  type: 'number',
                  description: 'Temperature in Celsius',
                },
                conditions: {
                  type: 'string',
                  description: 'Weather conditions description',
                },
              },
              required: ['location', 'temperature', 'conditions'],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    const data = await response.json();
    const weatherInfo = data.choices[0].message.content;
    ```
  </CodeGroup>
</Template>

## Streaming with Structured Outputs

Structured outputs are also supported with streaming responses. The model will stream valid partial JSON that, when complete, forms a valid response matching your schema.

To enable streaming with structured outputs, simply add `stream: true` to your request:

```typescript
{
  "stream": true,
  "response_format": {
    "type": "json_schema",
    // ... rest of your schema
  }
}
```

## Error Handling

When using structured outputs, you may encounter these scenarios:

1. **Model doesn't support structured outputs**: The request will fail with an error indicating lack of support
2. **Invalid schema**: The model will return an error if your JSON Schema is invalid

## Response Healing

For non-streaming requests using `response_format` with `type: "json_schema"`, you can enable the [Response Healing](/docs/guides/features/plugins/response-healing) plugin to reduce the risk of invalid JSON when models return imperfect formatting. Learn more in the [Response Healing documentation](/docs/guides/features/plugins/response-healing).
***

title: Message Transforms
subtitle: Transform prompt messages
headline: Message Transforms | Pre-process AI Model Inputs with OpenRouter
canonical-url: '[https://openrouter.ai/docs/guides/features/message-transforms](https://openrouter.ai/docs/guides/features/message-transforms)'
'og:site\_name': OpenRouter Documentation
'og:title': Message Transforms - Optimize AI Model Inputs
'og:description': >-
Transform and optimize messages before sending them to AI models. Learn about
middle-out compression and context window optimization with OpenRouter.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Message%20Transforms\&description=Optimize%20AI%20model%20inputs%20with%20OpenRouter](https://openrouter.ai/dynamic-og?title=Message%20Transforms\&description=Optimize%20AI%20model%20inputs%20with%20OpenRouter)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

To help with prompts that exceed the maximum context size of a model, OpenRouter supports a context compression [plugin](/docs/guides/features/plugins) that can be enabled per-request:

```typescript
{
  plugins: [{ id: "context-compression" }], // Compress prompts that are > context size.
  messages: [...],
  model // Works with any model
}
```

This can be useful for situations where perfect recall is not required. The plugin works by removing or truncating messages from the middle of the prompt, until the prompt fits within the model's context window.

In some cases, the issue is not the token context length, but the actual number of messages. The plugin addresses this as well: For instance, Anthropic's Claude models enforce a maximum of {anthropicMaxMessagesCount} messages. When this limit is exceeded with context compression enabled, the plugin will keep half of the messages from the start and half from the end of the conversation.

When context compression is enabled, OpenRouter will first try to find models whose context length is at least half of your total required tokens (input + completion). For example, if your prompt requires 10,000 tokens total, models with at least 5,000 context length will be considered. If no models meet this criteria, OpenRouter will fall back to using the model with the highest available context length.

The compression will then attempt to fit your content within the chosen model's context window by removing or truncating content from the middle of the prompt. If context compression is disabled and your total tokens exceed the model's context length, the request will fail with an error message suggesting you either reduce the length or enable context compression.

<Note>
  [All OpenRouter endpoints](/models) with 8k (8,192 tokens) or less context
  length will default to using context compression. To disable this, pass
  `plugins: [{"id": "context-compression", "enabled": false}]` in the request body.
</Note>

The middle of the prompt is compressed because [LLMs pay less attention](https://arxiv.org/abs/2307.03172) to the middle of sequences.
***

title: Server Tools
subtitle: Tools operated by OpenRouter that models can call during request
headline: Server Tools | Model-Callable Tools Operated by OpenRouter
canonical-url: '[https://openrouter.ai/docs/guides/features/server-tools](https://openrouter.ai/docs/guides/features/server-tools)'
'og:site\_name': OpenRouter Documentation
'og:title': Server Tools - Model-Callable Tools by OpenRouter
'og:description': >-
Add powerful server-side tools like web search and datetime to any model on
OpenRouter. Models decide when to call them — OpenRouter executes them
automatically.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Server%20Tools\&description=Model-Callable%20Tools%20by%20OpenRouter](https://openrouter.ai/dynamic-og?title=Server%20Tools\&description=Model-Callable%20Tools%20by%20OpenRouter)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

<Note title="Beta">
  Server tools are currently in beta. The API and behavior may change.
</Note>

Server tools are specialized tools operated by OpenRouter that any model can call during a request. When a model decides to use a server tool, OpenRouter executes it server-side and returns the result to the model — no client-side implementation needed.

## Server Tools vs Plugins vs User-Defined Tools

|                           | Server Tools             | Plugins          | User-Defined Tools       |
| ------------------------- | ------------------------ | ---------------- | ------------------------ |
| **Who decides to use it** | The model                | Always runs      | The model                |
| **Who executes it**       | OpenRouter               | OpenRouter       | Your application         |
| **Call frequency**        | 0 to N times per request | Once per request | 0 to N times per request |
| **Specified via**         | `tools` array            | `plugins` array  | `tools` array            |
| **Type prefix**           | `openrouter:*`           | N/A              | `function`               |

**Server tools** are tools the model can invoke zero or more times during a request. OpenRouter handles execution transparently.

**Plugins** inject or mutate a request or response to add functionality (e.g. response healing, PDF parsing). They always run once when enabled.

**User-defined tools** are standard function-calling tools where the model suggests a call and *your* application executes it.

## Available Server Tools

| Tool                                                                        | Type                          | Description                            |
| --------------------------------------------------------------------------- | ----------------------------- | -------------------------------------- |
| [**Web Search**](/docs/guides/features/server-tools/web-search)             | `openrouter:web_search`       | Search the web for current information |
| [**Datetime**](/docs/guides/features/server-tools/datetime)                 | `openrouter:datetime`         | Get the current date and time          |
| [**Image Generation**](/docs/guides/features/server-tools/image-generation) | `openrouter:image_generation` | Generate images from text prompts      |

## How Server Tools Work

1. You include one or more server tools in the `tools` array of your API request.
2. The model decides whether and when to call each server tool based on the user's prompt.
3. OpenRouter intercepts the tool call, executes it server-side, and returns the result to the model.
4. The model uses the result to formulate its response. It may call the tool again if needed.

Server tools work alongside your own user-defined tools — you can include both in the same request.

## Quick Start

Add server tools to the `tools` array using the `openrouter:` type prefix:

<Template
  data={{
  API_KEY_REF,
  MODEL: 'openai/gpt-5.2'
}}
>
  <CodeGroup>
    ```typescript title="TypeScript"
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer {{API_KEY_REF}}',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        messages: [
          {
            role: 'user',
            content: 'What are the latest developments in AI?'
          }
        ],
        tools: [
          { type: 'openrouter:web_search' },
          { type: 'openrouter:datetime' }
        ]
      }),
    });

    const data = await response.json();
    console.log(data.choices[0].message.content);
    ```

    ```python title="Python"
    import requests

    response = requests.post(
      "https://openrouter.ai/api/v1/chat/completions",
      headers={
        "Authorization": f"Bearer {{API_KEY_REF}}",
        "Content-Type": "application/json",
      },
      json={
        "model": "{{MODEL}}",
        "messages": [
          {
            "role": "user",
            "content": "What are the latest developments in AI?"
          }
        ],
        "tools": [
          {"type": "openrouter:web_search"},
          {"type": "openrouter:datetime"}
        ]
      }
    )

    data = response.json()
    print(data["choices"][0]["message"]["content"])
    ```

    ```bash title="cURL"
    curl https://openrouter.ai/api/v1/chat/completions \
      -H "Authorization: Bearer {{API_KEY_REF}}" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "{{MODEL}}",
        "messages": [
          {
            "role": "user",
            "content": "What are the latest developments in AI?"
          }
        ],
        "tools": [
          {"type": "openrouter:web_search"},
          {"type": "openrouter:datetime"}
        ]
      }'
    ```
  </CodeGroup>
</Template>

## Combining with User-Defined Tools

Server tools and user-defined tools can be used in the same request:

```json
{
  "model": "openai/gpt-5.2",
  "messages": [...],
  "tools": [
    { "type": "openrouter:web_search", "parameters": { "max_results": 3 } },
    { "type": "openrouter:datetime" },
    {
      "type": "function",
      "function": {
        "name": "get_stock_price",
        "description": "Get the current stock price for a ticker symbol",
        "parameters": {
          "type": "object",
          "properties": {
            "ticker": { "type": "string" }
          },
          "required": ["ticker"]
        }
      }
    }
  ]
}
```

The model can call any combination of server tools and user-defined tools. OpenRouter executes the server tools automatically, while your application handles the user-defined tool calls as usual.

## Usage Tracking

Server tool usage is tracked in the response `usage` object:

```json
{
  "usage": {
    "input_tokens": 105,
    "output_tokens": 250,
    "server_tool_use": {
      "web_search_requests": 2
    }
  }
}
```

## Next Steps

* [Web Search](/docs/guides/features/server-tools/web-search) — Search the web for real-time information
* [Datetime](/docs/guides/features/server-tools/datetime) — Get the current date and time
* [Image Generation](/docs/guides/features/server-tools/image-generation) — Generate images from text prompts
* [Tool Calling](/docs/guides/features/tool-calling) — Learn about user-defined tool calling
***

title: Web Search
subtitle: Give any model access to real-time web information
headline: Web Search Server Tool | Real-Time Web Search for Any Model
canonical-url: '[https://openrouter.ai/docs/guides/features/server-tools/web-search](https://openrouter.ai/docs/guides/features/server-tools/web-search)'
'og:site\_name': OpenRouter Documentation
'og:title': Web Search Server Tool - Real-Time Web Search for Any Model
'og:description': >-
Add real-time web search to any model on OpenRouter. The model decides when to
search, OpenRouter executes it, and results are returned with citations.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?pathname=features/server-tools/web-search\&title=Web%20Search%20Server%20Tool\&description=Real-time%20web%20search%20for%20any%20model](https://openrouter.ai/dynamic-og?pathname=features/server-tools/web-search\&title=Web%20Search%20Server%20Tool\&description=Real-time%20web%20search%20for%20any%20model)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

<Note title="Beta">
  Server tools are currently in beta. The API and behavior may change.
</Note>

The `openrouter:web_search` server tool gives any model on OpenRouter access to real-time web information. When the model determines it needs current information, it calls the tool with a search query. OpenRouter executes the search and returns results that the model uses to formulate a grounded, cited response.

## How It Works

1. You include `{ "type": "openrouter:web_search" }` in your `tools` array.
2. Based on the user's prompt, the model decides whether a web search is needed and generates a search query.
3. OpenRouter executes the search using the configured engine (defaults to `auto`, which uses native provider search when available or falls back to [Exa](https://exa.ai)).
4. The search results (URLs, titles, and content snippets) are returned to the model.
5. The model synthesizes the results into its response. It may search multiple times in a single request if needed.

## Quick Start

<Template
  data={{
  API_KEY_REF,
  MODEL: 'openai/gpt-5.2'
}}
>
  <CodeGroup>
    ```typescript title="TypeScript"
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer {{API_KEY_REF}}',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        messages: [
          {
            role: 'user',
            content: 'What were the major AI announcements this week?'
          }
        ],
        tools: [
          { type: 'openrouter:web_search' }
        ]
      }),
    });

    const data = await response.json();
    console.log(data.choices[0].message.content);
    ```

    ```python title="Python"
    import requests

    response = requests.post(
      "https://openrouter.ai/api/v1/chat/completions",
      headers={
        "Authorization": f"Bearer {{API_KEY_REF}}",
        "Content-Type": "application/json",
      },
      json={
        "model": "{{MODEL}}",
        "messages": [
          {
            "role": "user",
            "content": "What were the major AI announcements this week?"
          }
        ],
        "tools": [
          {"type": "openrouter:web_search"}
        ]
      }
    )

    data = response.json()
    print(data["choices"][0]["message"]["content"])
    ```

    ```bash title="cURL"
    curl https://openrouter.ai/api/v1/chat/completions \
      -H "Authorization: Bearer {{API_KEY_REF}}" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "{{MODEL}}",
        "messages": [
          {
            "role": "user",
            "content": "What were the major AI announcements this week?"
          }
        ],
        "tools": [
          {"type": "openrouter:web_search"}
        ]
      }'
    ```
  </CodeGroup>
</Template>

## Configuration

The web search tool accepts optional `parameters` to customize search behavior:

```json
{
  "type": "openrouter:web_search",
  "parameters": {
    "engine": "exa",
    "max_results": 5,
    "max_total_results": 20,
    "search_context_size": "medium",
    "allowed_domains": ["example.com"],
    "excluded_domains": ["reddit.com"]
  }
}
```

| Parameter             | Type      | Default  | Description                                                                                                                           |
| --------------------- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `engine`              | string    | `auto`   | Search engine to use: `auto`, `native`, `exa`, `firecrawl`, or `parallel`                                                             |
| `max_results`         | integer   | 5        | Maximum results per search call (1–25). Applies to Exa, Firecrawl, and Parallel engines; ignored with native provider search          |
| `max_total_results`   | integer   | —        | Maximum total results across all search calls in a single request. Useful for controlling cost and context size in agentic loops      |
| `search_context_size` | string    | `medium` | How much context to retrieve per result: `low`, `medium`, or `high`. Only applies to Exa engine                                       |
| `user_location`       | object    | —        | Approximate user location for location-biased results (see below)                                                                     |
| `allowed_domains`     | string\[] | —        | Limit results to these domains. Supported by Exa, Parallel, and most native providers (see [domain filtering](#domain-filtering))     |
| `excluded_domains`    | string\[] | —        | Exclude results from these domains. Supported by Exa, Parallel, and some native providers (see [domain filtering](#domain-filtering)) |

### User Location

Pass an approximate user location to bias search results geographically:

```json
{
  "type": "openrouter:web_search",
  "parameters": {
    "user_location": {
      "type": "approximate",
      "city": "San Francisco",
      "region": "California",
      "country": "US",
      "timezone": "America/Los_Angeles"
    }
  }
}
```

All fields within `user_location` are optional.

## Engine Selection

The web search server tool supports multiple search engines:

* **`auto`** (default): Uses native search if the provider supports it, otherwise falls back to Exa
* **`native`**: Forces the provider's built-in web search (falls back to Exa with a warning if the provider doesn't support it)
* **`exa`**: Uses [Exa](https://exa.ai)'s search API, which combines keyword and embeddings-based search
* **`firecrawl`**: Uses [Firecrawl](https://firecrawl.dev)'s search API (BYOK — bring your own key)
* **`parallel`**: Uses [Parallel](https://parallel.ai)'s search API

### Engine Capabilities

| Feature                  | Exa         | Firecrawl       | Parallel    | Native             |
| ------------------------ | ----------- | --------------- | ----------- | ------------------ |
| **Domain filtering**     | Yes         | No              | Yes         | Varies by provider |
| **Context size control** | Yes         | No              | No          | No                 |
| **API key**              | Server-side | BYOK (your key) | Server-side | Provider-handled   |

### Firecrawl (BYOK)

Firecrawl uses your own API key. To set it up:

1. Go to your [OpenRouter plugin settings](https://openrouter.ai/settings/plugins) and select Firecrawl as the web search engine
2. Accept the [Firecrawl Terms of Service](https://www.firecrawl.dev/terms-of-service) — this creates a Firecrawl account linked to your email
3. Your account starts with a **free hobby plan and 100,000 credits**

Firecrawl searches use your Firecrawl credits directly — no additional charge from OpenRouter. Domain filtering is not supported with Firecrawl.

### Parallel

[Parallel](https://parallel.ai) supports domain filtering and uses OpenRouter credits at the same rate as Exa (\$4 per 1,000 results).

## Domain Filtering

Restrict which domains appear in search results using `allowed_domains` and `excluded_domains`:

```json
{
  "type": "openrouter:web_search",
  "parameters": {
    "allowed_domains": ["arxiv.org", "nature.com"],
    "excluded_domains": ["reddit.com"]
  }
}
```

| Engine                  | `allowed_domains` | `excluded_domains` | Notes                                                                  |
| ----------------------- | :---------------: | :----------------: | ---------------------------------------------------------------------- |
| **Exa**                 |        Yes        |         Yes        | Both can be used simultaneously                                        |
| **Parallel**            |        Yes        |         Yes        | Mutually exclusive                                                     |
| **Firecrawl**           |         No        |         No         | Returns an error if domain filters are set                             |
| **Native (Anthropic)**  |        Yes        |         Yes        | Mutually exclusive (`allowed_domains` or `excluded_domains`, not both) |
| **Native (OpenAI)**     |        Yes        |         No         | `excluded_domains` silently ignored                                    |
| **Native (xAI)**        |        Yes        |         Yes        | Mutually exclusive                                                     |
| **Native (Perplexity)** |         No        |         No         | Not supported via server tool path                                     |

## Controlling Total Results

When the model searches multiple times in a single request, use `max_total_results` to cap the cumulative number of results:

```json
{
  "type": "openrouter:web_search",
  "parameters": {
    "max_results": 5,
    "max_total_results": 15
  }
}
```

Once the limit is reached, subsequent search calls return a message telling the model the limit was hit instead of performing another search. This is useful for controlling cost and context window usage in agentic loops.

## Works with the Responses API

The web search server tool also works with the Responses API:

<Template
  data={{
  API_KEY_REF,
  MODEL: 'openai/gpt-5.2'
}}
>
  <CodeGroup>
    ```typescript title="TypeScript"
    const response = await fetch('https://openrouter.ai/api/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer {{API_KEY_REF}}',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        input: 'What is the current price of Bitcoin?',
        tools: [
          { type: 'openrouter:web_search', parameters: { max_results: 3 } }
        ]
      }),
    });

    const data = await response.json();
    console.log(data);
    ```

    ```python title="Python"
    import requests

    response = requests.post(
      "https://openrouter.ai/api/v1/responses",
      headers={
        "Authorization": f"Bearer {{API_KEY_REF}}",
        "Content-Type": "application/json",
      },
      json={
        "model": "{{MODEL}}",
        "input": "What is the current price of Bitcoin?",
        "tools": [
          {"type": "openrouter:web_search", "parameters": {"max_results": 3}}
        ]
      }
    )

    data = response.json()
    print(data)
    ```
  </CodeGroup>
</Template>

## Usage Tracking

Web search usage is reported in the response `usage` object:

```json
{
  "usage": {
    "input_tokens": 105,
    "output_tokens": 250,
    "server_tool_use": {
      "web_search_requests": 2
    }
  }
}
```

The `web_search_requests` field counts the total number of search queries the model made during the request.

## Pricing

| Engine        | Pricing                                                                                                                                                                                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exa**       | \$4 per 1,000 results using OpenRouter credits (default 5 results = max \$0.02 per search)                                                                                                                                                                                                                                                   |
| **Parallel**  | \$4 per 1,000 results using OpenRouter credits (same as Exa)                                                                                                                                                                                                                                                                                 |
| **Firecrawl** | Uses your Firecrawl credits directly — no OpenRouter charge                                                                                                                                                                                                                                                                                  |
| **Native**    | Passed through from the provider ([OpenAI](https://platform.openai.com/docs/pricing#built-in-tools), [Anthropic](https://docs.claude.com/en/docs/agents-and-tools/tool-use/web-search-tool#usage-and-pricing), [Perplexity](https://docs.perplexity.ai/getting-started/pricing), [xAI](https://docs.x.ai/docs/models#tool-invocation-costs)) |

All pricing is in addition to standard LLM token costs for processing the search result content.

## Migrating from the Web Search Plugin

<Note>
  The [web search plugin](/docs/guides/features/plugins/web-search) (`plugins: [{ id: "web" }]`) and the [`:online` variant](/docs/guides/routing/model-variants/online) are deprecated. Use the `openrouter:web_search` server tool instead.
</Note>

The key differences:

|                           | Web Search Plugin (deprecated)   | Web Search Server Tool                       |
| ------------------------- | -------------------------------- | -------------------------------------------- |
| **How to enable**         | `plugins: [{ id: "web" }]`       | `tools: [{ type: "openrouter:web_search" }]` |
| **Who decides to search** | Always searches once             | Model decides when/whether to search         |
| **Call frequency**        | Once per request                 | 0 to N times per request                     |
| **Engine options**        | Native, Exa, Firecrawl, Parallel | Auto, Native, Exa, Firecrawl, Parallel       |
| **Domain filtering**      | Yes (Exa, Parallel, some native) | Yes (Exa, Parallel, most native)             |
| **Context size control**  | Via `web_search_options`         | Via `search_context_size` parameter          |
| **Total results cap**     | No                               | Yes (`max_total_results`)                    |
| **Pricing**               | Varies by engine                 | Varies by engine (same rates)                |

### Migration example

```json
// Before (deprecated)
{
  "model": "openai/gpt-5.2",
  "messages": [...],
  "plugins": [{ "id": "web", "max_results": 3 }]
}

// After
{
  "model": "openai/gpt-5.2",
  "messages": [...],
  "tools": [
    { "type": "openrouter:web_search", "parameters": { "max_results": 3 } }
  ]
}
```

```json
// Before (deprecated) — engine and domain filtering
{
  "model": "openai/gpt-5.2",
  "messages": [...],
  "plugins": [{
    "id": "web",
    "engine": "exa",
    "max_results": 5,
    "include_domains": ["arxiv.org"]
  }]
}

// After
{
  "model": "openai/gpt-5.2",
  "messages": [...],
  "tools": [{
    "type": "openrouter:web_search",
    "parameters": {
      "engine": "exa",
      "max_results": 5,
      "allowed_domains": ["arxiv.org"]
    }
  }]
}
```

```json
// Before (deprecated) — :online variant
{
  "model": "openai/gpt-5.2:online"
}

// After
{
  "model": "openai/gpt-5.2",
  "tools": [{ "type": "openrouter:web_search" }]
}
```

## Next Steps

* [Server Tools Overview](/docs/guides/features/server-tools) — Learn about server tools
* [Datetime](/docs/guides/features/server-tools/datetime) — Get the current date and time
* [Tool Calling](/docs/guides/features/tool-calling) — Learn about user-defined tool calling
***

title: Datetime
subtitle: Give any model access to the current date and time
headline: Datetime Server Tool | Current Date and Time for Any Model
canonical-url: '[https://openrouter.ai/docs/guides/features/server-tools/datetime](https://openrouter.ai/docs/guides/features/server-tools/datetime)'
'og:site\_name': OpenRouter Documentation
'og:title': Datetime Server Tool - Current Date and Time for Any Model
'og:description': >-
Add current date and time awareness to any model on OpenRouter. The model
calls the tool when it needs temporal context.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Datetime%20Server%20Tool\&description=Current%20date%20and%20time%20for%20any%20model](https://openrouter.ai/dynamic-og?title=Datetime%20Server%20Tool\&description=Current%20date%20and%20time%20for%20any%20model)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

<Note title="Beta">
  Server tools are currently in beta. The API and behavior may change.
</Note>

The `openrouter:datetime` server tool gives any model access to the current date and time. This is useful for prompts that require temporal awareness — scheduling, time-sensitive questions, or any task where the model needs to know "right now."

## Quick Start

<Template
  data={{
  API_KEY_REF,
  MODEL: 'openai/gpt-5.2'
}}
>
  <CodeGroup>
    ```typescript title="TypeScript"
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer {{API_KEY_REF}}',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        messages: [
          {
            role: 'user',
            content: 'What day of the week is it today?'
          }
        ],
        tools: [
          { type: 'openrouter:datetime' }
        ]
      }),
    });

    const data = await response.json();
    console.log(data.choices[0].message.content);
    ```

    ```python title="Python"
    import requests

    response = requests.post(
      "https://openrouter.ai/api/v1/chat/completions",
      headers={
        "Authorization": f"Bearer {{API_KEY_REF}}",
        "Content-Type": "application/json",
      },
      json={
        "model": "{{MODEL}}",
        "messages": [
          {
            "role": "user",
            "content": "What day of the week is it today?"
          }
        ],
        "tools": [
          {"type": "openrouter:datetime"}
        ]
      }
    )

    data = response.json()
    print(data["choices"][0]["message"]["content"])
    ```

    ```bash title="cURL"
    curl https://openrouter.ai/api/v1/chat/completions \
      -H "Authorization: Bearer {{API_KEY_REF}}" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "{{MODEL}}",
        "messages": [
          {
            "role": "user",
            "content": "What day of the week is it today?"
          }
        ],
        "tools": [
          {"type": "openrouter:datetime"}
        ]
      }'
    ```
  </CodeGroup>
</Template>

## Configuration

The datetime tool accepts an optional `timezone` parameter:

```json
{
  "type": "openrouter:datetime",
  "parameters": {
    "timezone": "America/New_York"
  }
}
```

| Parameter  | Type   | Default | Description                                                                       |
| ---------- | ------ | ------- | --------------------------------------------------------------------------------- |
| `timezone` | string | `UTC`   | IANA timezone name (e.g. `"America/New_York"`, `"Europe/London"`, `"Asia/Tokyo"`) |

## Response

When the model calls the datetime tool, it receives a response like:

```json
{
  "datetime": "2025-07-15T14:30:00.000-04:00",
  "timezone": "America/New_York"
}
```

## Pricing

The datetime tool has no additional cost beyond standard token usage.

## Next Steps

* [Server Tools Overview](/docs/guides/features/server-tools) — Learn about server tools
* [Web Search](/docs/guides/features/server-tools/web-search) — Search the web for real-time information
* [Tool Calling](/docs/guides/features/tool-calling) — Learn about user-defined tool calling
***

title: Tool & Function Calling
subtitle: Use tools in your prompts
headline: Tool & Function Calling | Use Tools with OpenRouter
canonical-url: '[https://openrouter.ai/docs/guides/features/tool-calling](https://openrouter.ai/docs/guides/features/tool-calling)'
'og:site\_name': OpenRouter Documentation
'og:title': Tool & Function Calling - Use Tools with OpenRouter
'og:description': >-
Use tools (or functions) in your prompts with OpenRouter. Learn how to use
tools with OpenAI, Anthropic, and other models that support tool calling.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Tool%20&%20Function%20Calling\&description=Use%20tools%20with%20OpenRouter](https://openrouter.ai/dynamic-og?title=Tool%20&%20Function%20Calling\&description=Use%20tools%20with%20OpenRouter)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

Tool calls (also known as function calls) give an LLM access to external tools. The LLM does not call the tools directly. Instead, it suggests the tool to call. The user then calls the tool separately and provides the results back to the LLM. Finally, the LLM formats the response into an answer to the user's original question.

OpenRouter standardizes the tool calling interface across models and providers, making it easy to integrate external tools with any supported model.

**Supported Models**: You can find models that support tool calling by filtering on [openrouter.ai/models?supported\_parameters=tools](https://openrouter.ai/models?supported_parameters=tools).

If you prefer to learn from a full end-to-end example, keep reading.

## Request Body Examples

Tool calling with OpenRouter involves three key steps. Here are the essential request body formats for each step:

### Step 1: Inference Request with Tools

```json
{
  "model": "google/gemini-3-flash-preview",
  "messages": [
    {
      "role": "user",
      "content": "What are the titles of some James Joyce books?"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "search_gutenberg_books",
        "description": "Search for books in the Project Gutenberg library",
        "parameters": {
          "type": "object",
          "properties": {
            "search_terms": {
              "type": "array",
              "items": {"type": "string"},
              "description": "List of search terms to find books"
            }
          },
          "required": ["search_terms"]
        }
      }
    }
  ]
}
```

### Step 2: Tool Execution (Client-Side)

After receiving the model's response with `tool_calls`, execute the requested tool locally and prepare the result:

```javascript
// Model responds with tool_calls, you execute the tool locally
const toolResult = await searchGutenbergBooks(["James", "Joyce"]);
```

### Step 3: Inference Request with Tool Results

```json
{
  "model": "google/gemini-3-flash-preview",
  "messages": [
    {
      "role": "user",
      "content": "What are the titles of some James Joyce books?"
    },
    {
      "role": "assistant",
      "content": null,
      "tool_calls": [
        {
          "id": "call_abc123",
          "type": "function",
          "function": {
            "name": "search_gutenberg_books",
            "arguments": "{\"search_terms\": [\"James\", \"Joyce\"]}"
          }
        }
      ]
    },
    {
      "role": "tool",
      "tool_call_id": "call_abc123",
      "content": "[{\"id\": 4300, \"title\": \"Ulysses\", \"authors\": [{\"name\": \"Joyce, James\"}]}]"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "search_gutenberg_books",
        "description": "Search for books in the Project Gutenberg library",
        "parameters": {
          "type": "object",
          "properties": {
            "search_terms": {
              "type": "array",
              "items": {"type": "string"},
              "description": "List of search terms to find books"
            }
          },
          "required": ["search_terms"]
        }
      }
    }
  ]
}
```

**Note**: The `tools` parameter must be included in every request (Steps 1 and 3) so the router can validate the tool schema on each call.

### Tool Calling Example

Here is Python code that gives LLMs the ability to call an external API -- in this case Project Gutenberg, to search for books.

First, let's do some basic setup:

<Template
  data={{
  API_KEY_REF,
  MODEL: 'google/gemini-3-flash-preview'
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    import { OpenRouter } from '@openrouter/sdk';

    const OPENROUTER_API_KEY = "{{API_KEY_REF}}";

    // You can use any model that supports tool calling
    const MODEL = "{{MODEL}}";

    const openRouter = new OpenRouter({
      apiKey: OPENROUTER_API_KEY,
    });

    const task = "What are the titles of some James Joyce books?";

    const messages = [
      {
        role: "system",
        content: "You are a helpful assistant."
      },
      {
        role: "user",
        content: task,
      }
    ];
    ```

    ```python
    import json, requests
    from openai import OpenAI

    OPENROUTER_API_KEY = f"{{API_KEY_REF}}"

    # You can use any model that supports tool calling
    MODEL = "{{MODEL}}"

    openai_client = OpenAI(
      base_url="https://openrouter.ai/api/v1",
      api_key=OPENROUTER_API_KEY,
    )

    task = "What are the titles of some James Joyce books?"

    messages = [
      {
        "role": "system",
        "content": "You are a helpful assistant."
      },
      {
        "role": "user",
        "content": task,
      }
    ]

    ```

    ```typescript title="TypeScript (fetch)"
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer {{API_KEY_REF}}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          {
            role: 'user',
            content: 'What are the titles of some James Joyce books?',
          },
        ],
      }),
    });
    ```
  </CodeGroup>
</Template>

### Define the Tool

Next, we define the tool that we want to call. Remember, the tool is going to get *requested* by the LLM, but the code we are writing here is ultimately responsible for executing the call and returning the results to the LLM.

<Template
  data={{
  API_KEY_REF,
  MODEL: 'google/gemini-3-flash-preview'
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    async function searchGutenbergBooks(searchTerms: string[]): Promise<Book[]> {
      const searchQuery = searchTerms.join(' ');
      const url = 'https://gutendex.com/books';
      const response = await fetch(`${url}?search=${searchQuery}`);
      const data = await response.json();

      return data.results.map((book: any) => ({
        id: book.id,
        title: book.title,
        authors: book.authors,
      }));
    }

    const tools = [
      {
        type: 'function',
        function: {
          name: 'searchGutenbergBooks',
          description:
            'Search for books in the Project Gutenberg library based on specified search terms',
          parameters: {
            type: 'object',
            properties: {
              search_terms: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description:
                  "List of search terms to find books in the Gutenberg library (e.g. ['dickens', 'great'] to search for books by Dickens with 'great' in the title)",
              },
            },
            required: ['search_terms'],
          },
        },
      },
    ];

    const TOOL_MAPPING = {
      searchGutenbergBooks,
    };
    ```

    ```python
    def search_gutenberg_books(search_terms):
        search_query = " ".join(search_terms)
        url = "https://gutendex.com/books"
        response = requests.get(url, params={"search": search_query})

        simplified_results = []
        for book in response.json().get("results", []):
            simplified_results.append({
                "id": book.get("id"),
                "title": book.get("title"),
                "authors": book.get("authors")
            })

        return simplified_results

    tools = [
      {
        "type": "function",
        "function": {
          "name": "search_gutenberg_books",
          "description": "Search for books in the Project Gutenberg library based on specified search terms",
          "parameters": {
            "type": "object",
            "properties": {
              "search_terms": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "description": "List of search terms to find books in the Gutenberg library (e.g. ['dickens', 'great'] to search for books by Dickens with 'great' in the title)"
              }
            },
            "required": ["search_terms"]
          }
        }
      }
    ]

    TOOL_MAPPING = {
        "search_gutenberg_books": search_gutenberg_books
    }

    ```
  </CodeGroup>
</Template>

Note that the "tool" is just a normal function. We then write a JSON "spec" compatible with the OpenAI function calling parameter. We'll pass that spec to the LLM so that it knows this tool is available and how to use it. It will request the tool when needed, along with any arguments. We'll then marshal the tool call locally, make the function call, and return the results to the LLM.

### Tool use and tool results

Let's make the first OpenRouter API call to the model:

<Template
  data={{
  API_KEY_REF,
  MODEL: 'google/gemini-3-flash-preview'
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    const result = await openRouter.chat.send({
      model: '{{MODEL}}',
      tools,
      messages,
      stream: false,
    });

    const response_1 = result.choices[0].message;
    ```

    ```python
    request_1 = {
        "model": {{MODEL}},
        "tools": tools,
        "messages": messages
    }

    response_1 = openai_client.chat.completions.create(**request_1).message
    ```

    ```typescript title="TypeScript (fetch)"
    const request_1 = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer {{API_KEY_REF}}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        tools,
        messages,
      }),
    });

    const data = await request_1.json();
    const response_1 = data.choices[0].message;
    ```
  </CodeGroup>
</Template>

The LLM responds with a finish reason of `tool_calls`, and a `tool_calls` array. In a generic LLM response-handler, you would want to check the `finish_reason` before processing tool calls, but here we will assume it's the case. Let's keep going, by processing the tool call:

<Template
  data={{
  API_KEY_REF,
  MODEL: 'google/gemini-3-flash-preview'
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    // Append the response to the messages array so the LLM has the full context
    // It's easy to forget this step!
    messages.push(response_1);

    // Now we process the requested tool calls, and use our book lookup tool
    for (const toolCall of response_1.tool_calls) {
      const toolName = toolCall.function.name;
      const { search_params } = JSON.parse(toolCall.function.arguments);
      const toolResponse = await TOOL_MAPPING[toolName](search_params);
      messages.push({
        role: 'tool',
        toolCallId: toolCall.id,
        name: toolName,
        content: JSON.stringify(toolResponse),
      });
    }
    ```

    ```python
    # Append the response to the messages array so the LLM has the full context
    # It's easy to forget this step!
    messages.append(response_1)

    # Now we process the requested tool calls, and use our book lookup tool
    for tool_call in response_1.tool_calls:
        '''
        In this case we only provided one tool, so we know what function to call.
        When providing multiple tools, you can inspect `tool_call.function.name`
        to figure out what function you need to call locally.
        '''
        tool_name = tool_call.function.name
        tool_args = json.loads(tool_call.function.arguments)
        tool_response = TOOL_MAPPING[tool_name](**tool_args)
        messages.append({
          "role": "tool",
          "tool_call_id": tool_call.id,
          "content": json.dumps(tool_response),
        })
    ```
  </CodeGroup>
</Template>

The messages array now has:

1. Our original request
2. The LLM's response (containing a tool call request)
3. The result of the tool call (a json object returned from the Project Gutenberg API)

Now, we can make a second OpenRouter API call, and hopefully get our result!

<Template
  data={{
  API_KEY_REF,
  MODEL: 'google/gemini-3-flash-preview'
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    const response_2 = await openRouter.chat.send({
      model: '{{MODEL}}',
      messages,
      tools,
      stream: false,
    });

    console.log(response_2.choices[0].message.content);
    ```

    ```python
    request_2 = {
      "model": MODEL,
      "messages": messages,
      "tools": tools
    }

    response_2 = openai_client.chat.completions.create(**request_2)

    print(response_2.choices[0].message.content)
    ```

    ```typescript title="TypeScript (fetch)"
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer {{API_KEY_REF}}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        messages,
        tools,
      }),
    });

    const data = await response.json();
    console.log(data.choices[0].message.content);
    ```
  </CodeGroup>
</Template>

The output will be something like:

```text
Here are some books by James Joyce:

*   *Ulysses*
*   *Dubliners*
*   *A Portrait of the Artist as a Young Man*
*   *Chamber Music*
*   *Exiles: A Play in Three Acts*
```

We did it! We've successfully used a tool in a prompt.

## Interleaved Thinking

Interleaved thinking allows models to reason between tool calls, enabling more sophisticated decision-making after receiving tool results. This feature helps models chain multiple tool calls with reasoning steps in between and make nuanced decisions based on intermediate results.

**Important**: Interleaved thinking increases token usage and response latency. Consider your budget and performance requirements when enabling this feature.

### How Interleaved Thinking Works

With interleaved thinking, the model can:

* Reason about the results of a tool call before deciding what to do next
* Chain multiple tool calls with reasoning steps in between
* Make more nuanced decisions based on intermediate results
* Provide transparent reasoning for its tool selection process

### Example: Multi-Step Research with Reasoning

Here's an example showing how a model might use interleaved thinking to research a topic across multiple sources:

**Initial Request:**

```json
{
  "model": "anthropic/claude-sonnet-4.5",
  "messages": [
    {
      "role": "user",
      "content": "Research the environmental impact of electric vehicles and provide a comprehensive analysis."
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "search_academic_papers",
        "description": "Search for academic papers on a given topic",
        "parameters": {
          "type": "object",
          "properties": {
            "query": {"type": "string"},
            "field": {"type": "string"}
          },
          "required": ["query"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "get_latest_statistics",
        "description": "Get latest statistics on a topic",
        "parameters": {
          "type": "object",
          "properties": {
            "topic": {"type": "string"},
            "year": {"type": "integer"}
          },
          "required": ["topic"]
        }
      }
    }
  ]
}
```

**Model's Reasoning and Tool Calls:**

1. **Initial Thinking**: "I need to research electric vehicle environmental impact. Let me start with academic papers to get peer-reviewed research."

2. **First Tool Call**: `search_academic_papers({"query": "electric vehicle lifecycle environmental impact", "field": "environmental science"})`

3. **After First Tool Result**: "The papers show mixed results on manufacturing impact. I need current statistics to complement this academic research."

4. **Second Tool Call**: `get_latest_statistics({"topic": "electric vehicle carbon footprint", "year": 2024})`

5. **After Second Tool Result**: "Now I have both academic research and current data. Let me search for manufacturing-specific studies to address the gaps I found."

6. **Third Tool Call**: `search_academic_papers({"query": "electric vehicle battery manufacturing environmental cost", "field": "materials science"})`

7. **Final Analysis**: Synthesizes all gathered information into a comprehensive response.

### Best Practices for Interleaved Thinking

* **Clear Tool Descriptions**: Provide detailed descriptions so the model can reason about when to use each tool
* **Structured Parameters**: Use well-defined parameter schemas to help the model make precise tool calls
* **Context Preservation**: Maintain conversation context across multiple tool interactions
* **Error Handling**: Design tools to provide meaningful error messages that help the model adjust its approach

### Implementation Considerations

When implementing interleaved thinking:

* Models may take longer to respond due to additional reasoning steps
* Token usage will be higher due to the reasoning process
* The quality of reasoning depends on the model's capabilities
* Some models may be better suited for this approach than others

## A Simple Agentic Loop

In the example above, the calls are made explicitly and sequentially. To handle a wide variety of user inputs and tool calls, you can use an agentic loop.

Here's an example of a simple agentic loop (using the same `tools` and initial `messages` as above):

<Template
  data={{
  API_KEY_REF,
  MODEL: 'google/gemini-3-flash-preview'
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    async function callLLM(messages: Message[]): Promise<ChatResponse> {
      const result = await openRouter.chat.send({
        model: '{{MODEL}}',
        tools,
        messages,
        stream: false,
      });

      messages.push(result.choices[0].message);
      return result;
    }

    async function getToolResponse(response: ChatResponse): Promise<Message> {
      const toolCall = response.choices[0].message.toolCalls[0];
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments);

      // Look up the correct tool locally, and call it with the provided arguments
      // Other tools can be added without changing the agentic loop
      const toolResult = await TOOL_MAPPING[toolName](toolArgs);

      return {
        role: 'tool',
        toolCallId: toolCall.id,
        content: toolResult,
      };
    }

    const maxIterations = 10;
    let iterationCount = 0;

    while (iterationCount < maxIterations) {
      iterationCount++;
      const response = await callLLM(messages);

      if (response.choices[0].message.toolCalls) {
        messages.push(await getToolResponse(response));
      } else {
        break;
      }
    }

    if (iterationCount >= maxIterations) {
      console.warn("Warning: Maximum iterations reached");
    }

    console.log(messages[messages.length - 1].content);
    ```

    ```python

    def call_llm(msgs):
        resp = openai_client.chat.completions.create(
            model={{MODEL}},
            tools=tools,
            messages=msgs
        )
        msgs.append(resp.choices[0].message.dict())
        return resp

    def get_tool_response(response):
        tool_call = response.choices[0].message.tool_calls[0]
        tool_name = tool_call.function.name
        tool_args = json.loads(tool_call.function.arguments)

        # Look up the correct tool locally, and call it with the provided arguments
        # Other tools can be added without changing the agentic loop
        tool_result = TOOL_MAPPING[tool_name](**tool_args)

        return {
            "role": "tool",
            "tool_call_id": tool_call.id,
            "content": tool_result,
        }

    max_iterations = 10
    iteration_count = 0

    while iteration_count < max_iterations:
        iteration_count += 1
        resp = call_llm(_messages)

        if resp.choices[0].message.tool_calls is not None:
            messages.append(get_tool_response(resp))
        else:
            break

    if iteration_count >= max_iterations:
        print("Warning: Maximum iterations reached")

    print(messages[-1]['content'])

    ```
  </CodeGroup>
</Template>

## Best Practices and Advanced Patterns

### Function Definition Guidelines

When defining tools for LLMs, follow these best practices:

**Clear and Descriptive Names**: Use descriptive function names that clearly indicate the tool's purpose.

```json
// Good: Clear and specific
{ "name": "get_weather_forecast" }
```

```json
// Avoid: Too vague
{ "name": "weather" }
```

**Comprehensive Descriptions**: Provide detailed descriptions that help the model understand when and how to use the tool.

```json
{
  "description": "Get current weather conditions and 5-day forecast for a specific location. Supports cities, zip codes, and coordinates.",
  "parameters": {
    "type": "object",
    "properties": {
      "location": {
        "type": "string",
        "description": "City name, zip code, or coordinates (lat,lng). Examples: 'New York', '10001', '40.7128,-74.0060'"
      },
      "units": {
        "type": "string",
        "enum": ["celsius", "fahrenheit"],
        "description": "Temperature unit preference",
        "default": "celsius"
      }
    },
    "required": ["location"]
  }
}
```

### Streaming with Tool Calls

When using streaming responses with tool calls, handle the different content types appropriately:

```typescript
const stream = await fetch('/api/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'anthropic/claude-sonnet-4.5',
    messages: messages,
    tools: tools,
    stream: true
  })
});

const reader = stream.body.getReader();
let toolCalls = [];

while (true) {
  const { done, value } = await reader.read();
  if (done) {
    break;
  }

  const chunk = new TextDecoder().decode(value);
  const lines = chunk.split('\n').filter(line => line.trim());

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6));

      if (data.choices[0].delta.tool_calls) {
        toolCalls.push(...data.choices[0].delta.tool_calls);
      }

      if (data.choices[0].delta.finish_reason === 'tool_calls') {
        await handleToolCalls(toolCalls);
      } else if (data.choices[0].delta.finish_reason === 'stop') {
        // Regular completion without tool calls
        break;
      }
    }
  }
}
```

### Tool Choice Configuration

Control tool usage with the `tool_choice` parameter:

```json
// Let model decide (default)
{ "tool_choice": "auto" }
```

```json
// Disable tool usage
{ "tool_choice": "none" }
```

```json
// Force specific tool
{
  "tool_choice": {
    "type": "function",
    "function": {"name": "search_database"}
  }
}
```

### Parallel Tool Calls

Control whether multiple tools can be called simultaneously with the `parallel_tool_calls` parameter (default is true for most models):

```json
// Disable parallel tool calls - tools will be called sequentially
{ "parallel_tool_calls": false }
```

When `parallel_tool_calls` is `false`, the model will only request one tool call at a time instead of potentially multiple calls in parallel.

### Multi-Tool Workflows

Design tools that work well together:

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "search_products",
        "description": "Search for products in the catalog"
      }
    },
    {
      "type": "function",
      "function": {
        "name": "get_product_details",
        "description": "Get detailed information about a specific product"
      }
    },
    {
      "type": "function",
      "function": {
        "name": "check_inventory",
        "description": "Check current inventory levels for a product"
      }
    }
  ]
}
```

This allows the model to naturally chain operations: search → get details → check inventory.

For more details on OpenRouter's message format and tool parameters, see the [API Reference](https://openrouter.ai/docs/api-reference/overview).
***

title: Multimodal Capabilities
subtitle: 'Send images, PDFs, audio, and video to OpenRouter models'
headline: OpenRouter Multimodal | Complete Documentation
canonical-url: '[https://openrouter.ai/docs/guides/overview/multimodal/overview](https://openrouter.ai/docs/guides/overview/multimodal/overview)'
'og:site\_name': OpenRouter Documentation
'og:title': OpenRouter Multimodal Capabilities - Complete Documentation
'og:description': >-
Send images, PDFs, audio, and video to OpenRouter models through our unified
API.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=OpenRouter%20Multimodal\&description=Send%20images%2C%20PDFs%2C%20audio%2C%20and%20video%20to%20OpenRouter%20models](https://openrouter.ai/dynamic-og?title=OpenRouter%20Multimodal\&description=Send%20images%2C%20PDFs%2C%20audio%2C%20and%20video%20to%20OpenRouter%20models).
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

OpenRouter supports multiple input modalities beyond text, allowing you to send images, PDFs, audio, and video files to compatible models through our unified API. This enables rich multimodal interactions for a wide variety of use cases.

## Supported Modalities

### Images

Send images to vision-capable models for analysis, description, OCR, and more. OpenRouter supports multiple image formats and both URL-based and base64-encoded images.

[Learn more about image inputs →](/docs/features/multimodal/images)

### Image Generation

Generate images from text prompts using AI models with image output capabilities. OpenRouter supports various image generation models that can create high-quality images based on your descriptions.

[Learn more about image generation →](/docs/features/multimodal/image-generation)

### PDFs

Process PDF documents with any model on OpenRouter. Our intelligent PDF parsing system extracts text and handles both text-based and scanned documents.

[Learn more about PDF processing →](/docs/features/multimodal/pdfs)

### Audio

Send audio files to speech-capable models for transcription, analysis, and processing, or receive audio responses from models with audio output capabilities. OpenRouter supports common audio formats for both input and output.

[Learn more about audio →](/docs/features/multimodal/audio)

### Video

Send video files to video-capable models for analysis, description, object detection, and action recognition. OpenRouter supports multiple video formats for comprehensive video understanding tasks.

[Learn more about video inputs →](/docs/features/multimodal/videos)

### Video Generation

Generate videos from text prompts using AI models with video output capabilities. OpenRouter supports an asynchronous video generation API with configurable resolution, aspect ratio, duration, and optional reference images.

[Learn more about video generation →](/docs/features/multimodal/video-generation)

## Getting Started

All multimodal inputs use the same `/api/v1/chat/completions` endpoint with the `messages` parameter. Different content types are specified in the message content array:

* **Images**: Use `image_url` content type
* **PDFs**: Use `file` content type with PDF data
* **Audio**: Use `input_audio` content type
* **Video**: Use `video_url` content type

You can combine multiple modalities in a single request, and the number of files you can send varies by provider and model.

## Model Compatibility

Not all models support every modality. OpenRouter automatically filters available models based on your request content:

* **Vision models**: Required for image processing
* **File-compatible models**: Can process PDFs natively or through our parsing system
* **Audio-capable models**: Required for audio input processing
* **Video-capable models**: Required for video input processing

Use our [Models page](https://openrouter.ai/models) to find models that support your desired input modalities.

## Input Format Support

OpenRouter supports both **direct URLs** and **base64-encoded data** for multimodal inputs:

### URLs (Recommended for public content)

* **Images**: `https://example.com/image.jpg`
* **PDFs**: `https://example.com/document.pdf`
* **Audio**: Not supported via URL (base64 only)
* **Video**: Provider-specific (e.g., YouTube links for Gemini on AI Studio)

### Base64 Encoding (Required for local files)

* **Images**: `data:image/jpeg;base64,{base64_data}`
* **PDFs**: `data:application/pdf;base64,{base64_data}`
* **Audio**: Raw base64 string with format specification
* **Video**: `data:video/mp4;base64,{base64_data}`

<Info>
  URLs are more efficient for large files as they don't require local encoding and reduce request payload size. Base64 encoding is required for local files or when the content is not publicly accessible.

  **Note for video URLs**: Video URL support varies by provider. For example, Google Gemini on AI Studio only supports YouTube links. See the [video inputs documentation](/docs/features/multimodal/videos) for provider-specific details.
</Info>

## Frequently Asked Questions

<AccordionGroup>
  <Accordion title="Can I mix different modalities in one request?">
    Yes! You can send text, images, PDFs, audio, and video in the same request. The model will process all inputs together.
  </Accordion>

  <Accordion title="How is multimodal content priced?">
    * **Images**: Typically priced per image or as input tokens
    * **PDFs**: Free text extraction, paid OCR processing, or native model pricing
    * **Audio input**: Priced as input tokens based on duration
    * **Audio output**: Priced as completion tokens
    * **Video**: Priced as input tokens based on duration and resolution
  </Accordion>

  <Accordion title="Which models support video input?">
    Video support varies by model. Use the [Models page](/models?fmt=cards\&input_modalities=video) to filter for video-capable models. Check each model's documentation for specific video format and duration limits.
  </Accordion>

  <Accordion title="How does video generation work?">
    Video generation uses an asynchronous API at `/api/v1/videos`. You submit a prompt, receive a job ID, then poll until the video is ready to download. See the [video generation documentation](/docs/features/multimodal/video-generation) for details.
  </Accordion>
</AccordionGroup>
***

title: Image Inputs
subtitle: How to send images to OpenRouter models
headline: OpenRouter Image Inputs | Complete Documentation
canonical-url: '[https://openrouter.ai/docs/guides/overview/multimodal/images](https://openrouter.ai/docs/guides/overview/multimodal/images)'
'og:site\_name': OpenRouter Documentation
'og:title': OpenRouter Image Inputs - Complete Documentation
'og:description': Send images to vision models through the OpenRouter API.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=OpenRouter%20Image%20Inputs\&description=Send%20images%20to%20vision%20models%20through%20the%20OpenRouter%20API](https://openrouter.ai/dynamic-og?title=OpenRouter%20Image%20Inputs\&description=Send%20images%20to%20vision%20models%20through%20the%20OpenRouter%20API).
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

Requests with images, to multimodel models, are available via the `/api/v1/chat/completions` API with a multi-part `messages` parameter. The `image_url` can either be a URL or a base64-encoded image. Note that multiple images can be sent in separate content array entries. The number of images you can send in a single request varies per provider and per model. Due to how the content is parsed, we recommend sending the text prompt first, then the images. If the images must come first, we recommend putting it in the system prompt.

OpenRouter supports both **direct URLs** and **base64-encoded data** for images:

* **URLs**: More efficient for publicly accessible images as they don't require local encoding
* **Base64**: Required for local files or private images that aren't publicly accessible

### Using Image URLs

Here's how to send an image using a URL:

<Template
  data={{
  API_KEY_REF,
  MODEL: 'google/gemini-3-flash-preview'
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    import { OpenRouter } from '@openrouter/sdk';

    const openRouter = new OpenRouter({
      apiKey: '{{API_KEY_REF}}',
    });

    const result = await openRouter.chat.send({
      model: '{{MODEL}}',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: "What's in this image?",
            },
            {
              type: 'image_url',
              imageUrl: {
                url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/2560px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg',
              },
            },
          ],
        },
      ],
      stream: false,
    });

    console.log(result);
    ```

    ```python
    import requests
    import json

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {API_KEY_REF}",
        "Content-Type": "application/json"
    }

    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "What's in this image?"
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/2560px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg"
                    }
                }
            ]
        }
    ]

    payload = {
        "model": "{{MODEL}}",
        "messages": messages
    }

    response = requests.post(url, headers=headers, json=payload)
    print(response.json())
    ```

    ```typescript title="TypeScript (fetch)"
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY_REF}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: "What's in this image?",
              },
              {
                type: 'image_url',
                image_url: {
                  url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/2560px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg',
                },
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();
    console.log(data);
    ```
  </CodeGroup>
</Template>

### Using Base64 Encoded Images

For locally stored images, you can send them using base64 encoding. Here's how to do it:

<Template
  data={{
  API_KEY_REF,
  MODEL: 'google/gemini-3-flash-preview'
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    import { OpenRouter } from '@openrouter/sdk';
    import * as fs from 'fs';

    const openRouter = new OpenRouter({
      apiKey: '{{API_KEY_REF}}',
    });

    async function encodeImageToBase64(imagePath: string): Promise<string> {
      const imageBuffer = await fs.promises.readFile(imagePath);
      const base64Image = imageBuffer.toString('base64');
      return `data:image/jpeg;base64,${base64Image}`;
    }

    // Read and encode the image
    const imagePath = 'path/to/your/image.jpg';
    const base64Image = await encodeImageToBase64(imagePath);

    const result = await openRouter.chat.send({
      model: '{{MODEL}}',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: "What's in this image?",
            },
            {
              type: 'image_url',
              imageUrl: {
                url: base64Image,
              },
            },
          ],
        },
      ],
      stream: false,
    });

    console.log(result);
    ```

    ```python
    import requests
    import json
    import base64
    from pathlib import Path

    def encode_image_to_base64(image_path):
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode('utf-8')

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {API_KEY_REF}",
        "Content-Type": "application/json"
    }

    # Read and encode the image
    image_path = "path/to/your/image.jpg"
    base64_image = encode_image_to_base64(image_path)
    data_url = f"data:image/jpeg;base64,{base64_image}"

    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "What's in this image?"
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": data_url
                    }
                }
            ]
        }
    ]

    payload = {
        "model": "{{MODEL}}",
        "messages": messages
    }

    response = requests.post(url, headers=headers, json=payload)
    print(response.json())
    ```

    ```typescript title="TypeScript (fetch)"
    async function encodeImageToBase64(imagePath: string): Promise<string> {
      const imageBuffer = await fs.promises.readFile(imagePath);
      const base64Image = imageBuffer.toString('base64');
      return `data:image/jpeg;base64,${base64Image}`;
    }

    // Read and encode the image
    const imagePath = 'path/to/your/image.jpg';
    const base64Image = await encodeImageToBase64(imagePath);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY_REF}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: "What's in this image?",
              },
              {
                type: 'image_url',
                image_url: {
                  url: base64Image,
                },
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();
    console.log(data);
    ```
  </CodeGroup>
</Template>

Supported image content types are:

* `image/png`
* `image/jpeg`
* `image/webp`
* `image/gif`
***

title: PDF Inputs
subtitle: How to send PDFs to OpenRouter models
headline: OpenRouter PDF Inputs | Complete Documentation
canonical-url: '[https://openrouter.ai/docs/guides/overview/multimodal/pdfs](https://openrouter.ai/docs/guides/overview/multimodal/pdfs)'
'og:site\_name': OpenRouter Documentation
'og:title': OpenRouter PDF Inputs - Complete Documentation
'og:description': Send PDF documents to any model on OpenRouter.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=OpenRouter%20PDF%20Inputs\&description=Send%20PDF%20documents%20to%20any%20model%20on%20OpenRouter](https://openrouter.ai/dynamic-og?title=OpenRouter%20PDF%20Inputs\&description=Send%20PDF%20documents%20to%20any%20model%20on%20OpenRouter).
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

OpenRouter supports PDF processing through the `/api/v1/chat/completions` API. PDFs can be sent as **direct URLs** or **base64-encoded data URLs** in the messages array, via the file content type. This feature works on **any** model on OpenRouter.

**URL support**: Send publicly accessible PDFs directly without downloading or encoding
**Base64 support**: Required for local files or private documents that aren't publicly accessible

PDFs also work in the chat room for interactive testing.

<Info>
  When a model supports file input natively, the PDF is passed directly to the
  model. When the model does not support file input natively, OpenRouter will
  parse the file and pass the parsed results to the requested model.
</Info>

<Tip>
  You can send both PDFs and other file types in the same request.
</Tip>

## Plugin Configuration

To configure PDF processing, use the `plugins` parameter in your request. OpenRouter provides several PDF processing engines with different capabilities and pricing:

```typescript
{
  plugins: [
    {
      id: 'file-parser',
      pdf: {
        engine: 'cloudflare-ai', // or 'mistral-ocr' or 'native'
      },
    },
  ],
}
```

## Pricing

OpenRouter provides several PDF processing engines:

1. <code>"{PDFParserEngine.MistralOCR}"</code>: Best for scanned documents or
   PDFs with images (\${MISTRAL_OCR_COST.toString()} per 1,000 pages).
2. <code>"{PDFParserEngine.CloudflareAI}"</code>: Converts PDFs to markdown
   using Cloudflare Workers AI (Free).
3. <code>"{PDFParserEngine.Native}"</code>: Only available for models that
   support file input natively (charged as input tokens).

<Info>
  The `"pdf-text"` engine is deprecated and automatically redirected to
  `"cloudflare-ai"`. Existing requests using `"pdf-text"` will continue to work.
</Info>

If you don't explicitly specify an engine, OpenRouter will default first to the model's native file processing capabilities, and if that's not available, we will use the <code>"{DEFAULT_PDF_ENGINE}"</code> engine.

## Using PDF URLs

For publicly accessible PDFs, you can send the URL directly without needing to download and encode the file:

<Template
  data={{
  API_KEY_REF,
  MODEL: 'anthropic/claude-sonnet-4',
  ENGINE: PDFParserEngine.MistralOCR,
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    import { OpenRouter } from '@openrouter/sdk';

    const openRouter = new OpenRouter({
      apiKey: '{{API_KEY_REF}}',
    });

    const result = await openRouter.chat.send({
      model: '{{MODEL}}',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'What are the main points in this document?',
            },
            {
              type: 'file',
              file: {
                filename: 'document.pdf',
                fileData: 'https://bitcoin.org/bitcoin.pdf',
              },
            },
          ],
        },
      ],
      // Optional: Configure PDF processing engine
      plugins: [
        {
          id: 'file-parser',
          pdf: {
            engine: '{{ENGINE}}',
          },
        },
      ],
      stream: false,
    });

    console.log(result);
    ```

    ```python
    import requests
    import json

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {API_KEY_REF}",
        "Content-Type": "application/json"
    }

    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "What are the main points in this document?"
                },
                {
                    "type": "file",
                    "file": {
                        "filename": "document.pdf",
                        "file_data": "https://bitcoin.org/bitcoin.pdf"
                    }
                },
            ]
        }
    ]

    # Optional: Configure PDF processing engine
    plugins = [
        {
            "id": "file-parser",
            "pdf": {
                "engine": "{{ENGINE}}"
            }
        }
    ]

    payload = {
        "model": "{{MODEL}}",
        "messages": messages,
        "plugins": plugins
    }

    response = requests.post(url, headers=headers, json=payload)
    print(response.json())
    ```

    ```typescript title="TypeScript (fetch)"
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY_REF}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'What are the main points in this document?',
              },
              {
                type: 'file',
                file: {
                  filename: 'document.pdf',
                  file_data: 'https://bitcoin.org/bitcoin.pdf',
                },
              },
            ],
          },
        ],
        // Optional: Configure PDF processing engine
        plugins: [
          {
            id: 'file-parser',
            pdf: {
              engine: '{{ENGINE}}',
            },
          },
        ],
      }),
    });

    const data = await response.json();
    console.log(data);
    ```
  </CodeGroup>
</Template>

<Info>
  PDF URLs work with all processing engines. For Mistral OCR, the URL is passed directly to the service. For other engines, OpenRouter fetches the PDF and processes it internally.
</Info>

## Using Base64 Encoded PDFs

For local PDF files or when you need to send PDF content directly, you can base64 encode the file:

<Template
  data={{
  API_KEY_REF,
  MODEL: 'google/gemma-3-27b-it',
  ENGINE: PDFParserEngine.CloudflareAI,
  DEFAULT_PDF_ENGINE,
}}
>
  <CodeGroup>
    ```python
    import requests
    import json
    import base64
    from pathlib import Path

    def encode_pdf_to_base64(pdf_path):
        with open(pdf_path, "rb") as pdf_file:
            return base64.b64encode(pdf_file.read()).decode('utf-8')

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {API_KEY_REF}",
        "Content-Type": "application/json"
    }

    # Read and encode the PDF
    pdf_path = "path/to/your/document.pdf"
    base64_pdf = encode_pdf_to_base64(pdf_path)
    data_url = f"data:application/pdf;base64,{base64_pdf}"

    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "What are the main points in this document?"
                },
                {
                    "type": "file",
                    "file": {
                        "filename": "document.pdf",
                        "file_data": data_url
                    }
                },
            ]
        }
    ]

    # Optional: Configure PDF processing engine
    # PDF parsing will still work even if the plugin is not explicitly set
    plugins = [
        {
            "id": "file-parser",
            "pdf": {
                "engine": "{{ENGINE}}"  # defaults to "{{DEFAULT_PDF_ENGINE}}". See Pricing above
            }
        }
    ]

    payload = {
        "model": "{{MODEL}}",
        "messages": messages,
        "plugins": plugins
    }

    response = requests.post(url, headers=headers, json=payload)
    print(response.json())
    ```

    ```typescript
    async function encodePDFToBase64(pdfPath: string): Promise<string> {
      const pdfBuffer = await fs.promises.readFile(pdfPath);
      const base64PDF = pdfBuffer.toString('base64');
      return `data:application/pdf;base64,${base64PDF}`;
    }

    // Read and encode the PDF
    const pdfPath = 'path/to/your/document.pdf';
    const base64PDF = await encodePDFToBase64(pdfPath);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY_REF}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'What are the main points in this document?',
              },
              {
                type: 'file',
                file: {
                  filename: 'document.pdf',
                  file_data: base64PDF,
                },
              },
            ],
          },
        ],
        // Optional: Configure PDF processing engine
        // PDF parsing will still work even if the plugin is not explicitly set
        plugins: [
          {
            id: 'file-parser',
            pdf: {
              engine: '{{ENGINE}}', // defaults to "{{DEFAULT_PDF_ENGINE}}". See Pricing above
            },
          },
        ],
      }),
    });

    const data = await response.json();
    console.log(data);
    ```
  </CodeGroup>
</Template>

## Skip Parsing Costs

When you send a PDF to the API, the response may include file annotations in the assistant's message. These annotations contain structured information about the PDF document that was parsed. By sending these annotations back in subsequent requests, you can avoid re-parsing the same PDF document multiple times, which saves both processing time and costs.

Here's how to reuse file annotations:

<Template
  data={{
  API_KEY_REF,
  MODEL: 'google/gemma-3-27b-it'
}}
>
  <CodeGroup>
    ```python
    import requests
    import json
    import base64
    from pathlib import Path

    # First, encode and send the PDF
    def encode_pdf_to_base64(pdf_path):
        with open(pdf_path, "rb") as pdf_file:
            return base64.b64encode(pdf_file.read()).decode('utf-8')

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {API_KEY_REF}",
        "Content-Type": "application/json"
    }

    # Read and encode the PDF
    pdf_path = "path/to/your/document.pdf"
    base64_pdf = encode_pdf_to_base64(pdf_path)
    data_url = f"data:application/pdf;base64,{base64_pdf}"

    # Initial request with the PDF
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "What are the main points in this document?"
                },
                {
                    "type": "file",
                    "file": {
                        "filename": "document.pdf",
                        "file_data": data_url
                    }
                },
            ]
        }
    ]

    payload = {
        "model": "{{MODEL}}",
        "messages": messages
    }

    response = requests.post(url, headers=headers, json=payload)
    response_data = response.json()

    # Store the annotations from the response
    file_annotations = None
    if response_data.get("choices") and len(response_data["choices"]) > 0:
        if "annotations" in response_data["choices"][0]["message"]:
            file_annotations = response_data["choices"][0]["message"]["annotations"]

    # Follow-up request using the annotations (without sending the PDF again)
    if file_annotations:
        follow_up_messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "What are the main points in this document?"
                    },
                    {
                        "type": "file",
                        "file": {
                            "filename": "document.pdf",
                            "file_data": data_url
                        }
                    }
                ]
            },
            {
                "role": "assistant",
                "content": "The document contains information about...",
                "annotations": file_annotations
            },
            {
                "role": "user",
                "content": "Can you elaborate on the second point?"
            }
        ]

        follow_up_payload = {
            "model": "{{MODEL}}",
            "messages": follow_up_messages
        }

        follow_up_response = requests.post(url, headers=headers, json=follow_up_payload)
        print(follow_up_response.json())
    ```

    ```typescript
    import fs from 'fs/promises';

    async function encodePDFToBase64(pdfPath: string): Promise<string> {
      const pdfBuffer = await fs.readFile(pdfPath);
      const base64PDF = pdfBuffer.toString('base64');
      return `data:application/pdf;base64,${base64PDF}`;
    }

    // Initial request with the PDF
    async function processDocument() {
      // Read and encode the PDF
      const pdfPath = 'path/to/your/document.pdf';
      const base64PDF = await encodePDFToBase64(pdfPath);

      const initialResponse = await fetch(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${API_KEY_REF}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: '{{MODEL}}',
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: 'What are the main points in this document?',
                  },
                  {
                    type: 'file',
                    file: {
                      filename: 'document.pdf',
                      file_data: base64PDF,
                    },
                  },
                ],
              },
            ],
          }),
        },
      );

      const initialData = await initialResponse.json();

      // Store the annotations from the response
      let fileAnnotations = null;
      if (initialData.choices && initialData.choices.length > 0) {
        if (initialData.choices[0].message.annotations) {
          fileAnnotations = initialData.choices[0].message.annotations;
        }
      }

      // Follow-up request using the annotations (without sending the PDF again)
      if (fileAnnotations) {
        const followUpResponse = await fetch(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${API_KEY_REF}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: '{{MODEL}}',
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: 'What are the main points in this document?',
                    },
                    {
                      type: 'file',
                      file: {
                        filename: 'document.pdf',
                        file_data: base64PDF,
                      },
                    },
                  ],
                },
                {
                  role: 'assistant',
                  content: 'The document contains information about...',
                  annotations: fileAnnotations,
                },
                {
                  role: 'user',
                  content: 'Can you elaborate on the second point?',
                },
              ],
            }),
          },
        );

        const followUpData = await followUpResponse.json();
        console.log(followUpData);
      }
    }

    processDocument();
    ```
  </CodeGroup>
</Template>

<Info>
  When you include the file annotations from a previous response in your
  subsequent requests, OpenRouter will use this pre-parsed information instead
  of re-parsing the PDF, which saves processing time and costs. This is
  especially beneficial for large documents or when using the `mistral-ocr`
  engine which incurs additional costs.
</Info>

## File Annotations Schema

When OpenRouter parses a PDF, the response includes file annotations in the assistant message. Here is the TypeScript type for the annotation schema:

```typescript
type FileAnnotation = {
  type: 'file';
  file: {
    hash: string;           // Unique hash identifying the parsed file
    name?: string;          // Original filename (optional)
    content: ContentPart[]; // Parsed content from the file
  };
};

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };
```

The `content` array contains the parsed content from the PDF, which may include text blocks and images (as base64 data URLs). The `hash` field uniquely identifies the parsed file content and is used to skip re-parsing when you include the annotation in subsequent requests.

## Response Format

The API will return a response in the following format:

```json
{
  "id": "gen-1234567890",
  "provider": "DeepInfra",
  "model": "google/gemma-3-27b-it",
  "object": "chat.completion",
  "created": 1234567890,
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "The document discusses...",
        "annotations": [
          {
            "type": "file",
            "file": {
              "hash": "abc123...",
              "name": "document.pdf",
              "content": [
                { "type": "text", "text": "Parsed text content..." },
                { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
              ]
            }
          }
        ]
      }
    }
  ],
  "usage": {
    "prompt_tokens": 1000,
    "completion_tokens": 100,
    "total_tokens": 1100
  }
}
```
***

title: Audio
subtitle: How to send and receive audio with OpenRouter models
headline: OpenRouter Audio | Complete Documentation
canonical-url: '[https://openrouter.ai/docs/guides/overview/multimodal/audio](https://openrouter.ai/docs/guides/overview/multimodal/audio)'
'og:site\_name': OpenRouter Documentation
'og:title': OpenRouter Audio - Complete Documentation
'og:description': >-
Send audio files to and receive audio responses from speech-capable models
through the OpenRouter API.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=OpenRouter%20Audio\&description=Send%20and%20receive%20audio%20with%20speech-capable%20models%20through%20the%20OpenRouter%20API](https://openrouter.ai/dynamic-og?title=OpenRouter%20Audio\&description=Send%20and%20receive%20audio%20with%20speech-capable%20models%20through%20the%20OpenRouter%20API).
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

OpenRouter supports both sending audio files to compatible models and receiving audio responses via the API. This guide covers how to work with audio inputs and outputs.

## Audio Inputs

Send audio files to compatible models for transcription, analysis, and processing. Audio input requests use the `/api/v1/chat/completions` API with the `input_audio` content type. Audio files must be base64-encoded and include the format specification.

**Note**: Audio files must be **base64-encoded** - direct URLs are not supported for audio content.

You can search for models that support audio input by filtering to audio input modality on our [Models page](/models?fmt=cards\&input_modalities=audio).

### Sending Audio Files

Here's how to send an audio file for processing:

<Template
  data={{
  API_KEY_REF,
  MODEL: 'google/gemini-2.5-flash'
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    import { OpenRouter } from '@openrouter/sdk';
    import fs from "fs/promises";

    const openRouter = new OpenRouter({
      apiKey: '{{API_KEY_REF}}',
    });

    async function encodeAudioToBase64(audioPath: string): Promise<string> {
      const audioBuffer = await fs.readFile(audioPath);
      return audioBuffer.toString("base64");
    }

    // Read and encode the audio file
    const audioPath = "path/to/your/audio.wav";
    const base64Audio = await encodeAudioToBase64(audioPath);

    const result = await openRouter.chat.send({
      model: "{{MODEL}}",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Please transcribe this audio file.",
            },
            {
              type: "input_audio",
              inputAudio: {
                data: base64Audio,
                format: "wav",
              },
            },
          ],
        },
      ],
      stream: false,
    });

    console.log(result);
    ```

    ```python
    import requests
    import json
    import base64

    def encode_audio_to_base64(audio_path):
        with open(audio_path, "rb") as audio_file:
            return base64.b64encode(audio_file.read()).decode('utf-8')

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {API_KEY_REF}",
        "Content-Type": "application/json"
    }

    # Read and encode the audio file
    audio_path = "path/to/your/audio.wav"
    base64_audio = encode_audio_to_base64(audio_path)

    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "Please transcribe this audio file."
                },
                {
                    "type": "input_audio",
                    "input_audio": {
                        "data": base64_audio,
                        "format": "wav"
                    }
                }
            ]
        }
    ]

    payload = {
        "model": "{{MODEL}}",
        "messages": messages
    }

    response = requests.post(url, headers=headers, json=payload)
    print(response.json())
    ```

    ```typescript title="TypeScript (fetch)"
    import fs from "fs/promises";

    async function encodeAudioToBase64(audioPath: string): Promise<string> {
      const audioBuffer = await fs.readFile(audioPath);
      return audioBuffer.toString("base64");
    }

    // Read and encode the audio file
    const audioPath = "path/to/your/audio.wav";
    const base64Audio = await encodeAudioToBase64(audioPath);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY_REF}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "{{MODEL}}",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Please transcribe this audio file.",
              },
              {
                type: "input_audio",
                input_audio: {
                  data: base64Audio,
                  format: "wav",
                },
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();
    console.log(data);
    ```
  </CodeGroup>
</Template>

### Supported Audio Input Formats

Supported audio formats vary by provider. Common formats include:

* `wav` - WAV audio
* `mp3` - MP3 audio
* `aiff` - AIFF audio
* `aac` - AAC audio
* `ogg` - OGG Vorbis audio
* `flac` - FLAC audio
* `m4a` - M4A audio
* `pcm16` - PCM16 audio
* `pcm24` - PCM24 audio

**Note:** Check your model's documentation to confirm which audio formats it supports. Not all models support all formats.

## Audio Output

OpenRouter supports receiving audio responses from models that have audio output capabilities. To request audio output, include the `modalities` and `audio` parameters in your request.

You can search for models that support audio output by filtering to audio output modality on our [Models page](/models?fmt=cards\&output_modalities=audio).

### Requesting Audio Output

To receive audio output, set `modalities` to `["text", "audio"]` and provide the `audio` configuration with your desired voice and format:

<Template
  data={{
  API_KEY_REF,
  MODEL: 'openai/gpt-4o-audio-preview'
}}
>
  <CodeGroup>
    ```python
    import requests
    import json
    import base64

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {API_KEY_REF}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": "{{MODEL}}",
        "messages": [
            {
                "role": "user",
                "content": "Say hello in a friendly tone."
            }
        ],
        "modalities": ["text", "audio"],
        "audio": {
            "voice": "alloy",
            "format": "wav"
        },
        "stream": True
    }

    # Audio output requires streaming — the response is delivered as SSE chunks
    response = requests.post(url, headers=headers, json=payload, stream=True)

    audio_data_chunks = []
    transcript_chunks = []

    for line in response.iter_lines():
        if not line:
            continue
        decoded = line.decode("utf-8")
        if not decoded.startswith("data: "):
            continue
        data = decoded[len("data: "):]
        if data.strip() == "[DONE]":
            break
        chunk = json.loads(data)
        delta = chunk["choices"][0].get("delta", {})
        audio = delta.get("audio", {})
        if audio.get("data"):
            audio_data_chunks.append(audio["data"])
        if audio.get("transcript"):
            transcript_chunks.append(audio["transcript"])

    transcript = "".join(transcript_chunks)
    print(f"Transcript: {transcript}")

    # Combine and decode the base64 audio chunks, then save
    full_audio_b64 = "".join(audio_data_chunks)
    audio_bytes = base64.b64decode(full_audio_b64)
    with open("output.wav", "wb") as f:
        f.write(audio_bytes)
    ```

    ```typescript title="TypeScript (fetch)"
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY_REF}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "{{MODEL}}",
        messages: [
          {
            role: "user",
            content: "Say hello in a friendly tone.",
          },
        ],
        modalities: ["text", "audio"],
        audio: {
          voice: "alloy",
          format: "wav",
        },
        stream: true,
      }),
    });

    // Audio output requires streaming — parse the SSE chunks
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    const audioDataChunks: string[] = [];
    const transcriptChunks: string[] = [];
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!; // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice("data: ".length).trim();
        if (data === "[DONE]") break;

        const chunk = JSON.parse(data);
        const audio = chunk.choices?.[0]?.delta?.audio;
        if (audio?.data) audioDataChunks.push(audio.data);
        if (audio?.transcript) transcriptChunks.push(audio.transcript);
      }
    }

    const transcript = transcriptChunks.join("");
    console.log(`Transcript: ${transcript}`);

    // audioDataChunks joined together is the full base64-encoded audio
    const fullAudioB64 = audioDataChunks.join("");
    ```
  </CodeGroup>
</Template>

### Streaming Chunk Format

Audio output requires streaming (`stream: true`). Audio data and transcript are delivered incrementally via the `delta.audio` field in each chunk:

```json
{
  "choices": [
    {
      "delta": {
        "audio": {
          "data": "<base64-encoded audio chunk>",
          "transcript": "Hello"
        }
      }
    }
  ]
}
```

### Audio Configuration Options

The `audio` parameter accepts the following options:

| Option   | Description                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `voice`  | The voice to use for audio generation (e.g., `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`). Available voices vary by model. |
| `format` | The audio format for the output (e.g., `wav`, `mp3`, `flac`, `opus`, `pcm16`). Available formats vary by model.                    |
***

title: Video Inputs
subtitle: How to send video files to OpenRouter models
headline: OpenRouter Video Inputs | Complete Documentation
canonical-url: '[https://openrouter.ai/docs/guides/overview/multimodal/videos](https://openrouter.ai/docs/guides/overview/multimodal/videos)'
'og:site\_name': OpenRouter Documentation
'og:title': OpenRouter Video Inputs - Complete Documentation
'og:description': Send video files to video-capable models through the OpenRouter API.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=OpenRouter%20Video%20Inputs\&description=Send%20video%20files%20to%20video-capable%20models%20through%20the%20OpenRouter%20API](https://openrouter.ai/dynamic-og?title=OpenRouter%20Video%20Inputs\&description=Send%20video%20files%20to%20video-capable%20models%20through%20the%20OpenRouter%20API).
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

OpenRouter supports sending video files to compatible models via the API. This guide will show you how to work with video using our API.

OpenRouter supports both **direct URLs** and **base64-encoded data URLs** for videos:

* **URLs**: Efficient for publicly accessible videos as they don't require local encoding
* **Base64 Data URLs**: Required for local files or private videos that aren't publicly accessible

<Info>
  **Important:** Video URL support varies by provider. OpenRouter only sends video URLs to providers that explicitly support them. For example, Google Gemini on AI Studio only supports YouTube links (not Vertex AI).
</Info>

<Warning>
  **API Only:** Video inputs are currently only supported via the API. Video uploads are not available in the OpenRouter chatroom interface at this time.
</Warning>

## Video Inputs

Requests with video files to compatible models are available via the `/api/v1/chat/completions` API with the `video_url` content type. The `url` can either be a URL or a base64-encoded data URL. Note that only models with video processing capabilities will handle these requests.

You can search for models that support video by filtering to video input modality on our [Models page](/models?fmt=cards\&input_modalities=video).

### Using Video URLs

Here's how to send a video using a URL. Note that for Google Gemini on AI Studio, only YouTube links are supported:

<Template
  data={{
  API_KEY_REF,
  MODEL: 'google/gemini-2.5-flash'
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    import { OpenRouter } from '@openrouter/sdk';

    const openRouter = new OpenRouter({
      apiKey: '{{API_KEY_REF}}',
    });

    const result = await openRouter.chat.send({
      model: "{{MODEL}}",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Please describe what's happening in this video.",
            },
            {
              type: "video_url",
              videoUrl: {
                url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
              },
            },
          ],
        },
      ],
      stream: false,
    });

    console.log(result);
    ```

    ```python
    import requests
    import json

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {API_KEY_REF}",
        "Content-Type": "application/json"
    }

    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "Please describe what's happening in this video."
                },
                {
                    "type": "video_url",
                    "video_url": {
                        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                    }
                }
            ]
        }
    ]

    payload = {
        "model": "{{MODEL}}",
        "messages": messages
    }

    response = requests.post(url, headers=headers, json=payload)
    print(response.json())
    ```

    ```typescript title="TypeScript (fetch)"
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY_REF}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "{{MODEL}}",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Please describe what's happening in this video.",
              },
              {
                type: "video_url",
                video_url: {
                  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                },
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();
    console.log(data);
    ```
  </CodeGroup>
</Template>

### Using Base64 Encoded Videos

For locally stored videos, you can send them using base64 encoding as data URLs:

<Template
  data={{
  API_KEY_REF,
  MODEL: 'google/gemini-2.5-flash'
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    import { OpenRouter } from '@openrouter/sdk';
    import * as fs from 'fs';

    const openRouter = new OpenRouter({
      apiKey: '{{API_KEY_REF}}',
    });

    async function encodeVideoToBase64(videoPath: string): Promise<string> {
      const videoBuffer = await fs.promises.readFile(videoPath);
      const base64Video = videoBuffer.toString('base64');
      return `data:video/mp4;base64,${base64Video}`;
    }

    // Read and encode the video
    const videoPath = 'path/to/your/video.mp4';
    const base64Video = await encodeVideoToBase64(videoPath);

    const result = await openRouter.chat.send({
      model: '{{MODEL}}',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: "What's in this video?",
            },
            {
              type: 'video_url',
              videoUrl: {
                url: base64Video,
              },
            },
          ],
        },
      ],
      stream: false,
    });

    console.log(result);
    ```

    ```python
    import requests
    import json
    import base64
    from pathlib import Path

    def encode_video_to_base64(video_path):
        with open(video_path, "rb") as video_file:
            return base64.b64encode(video_file.read()).decode('utf-8')

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {API_KEY_REF}",
        "Content-Type": "application/json"
    }

    # Read and encode the video
    video_path = "path/to/your/video.mp4"
    base64_video = encode_video_to_base64(video_path)
    data_url = f"data:video/mp4;base64,{base64_video}"

    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "What's in this video?"
                },
                {
                    "type": "video_url",
                    "video_url": {
                        "url": data_url
                    }
                }
            ]
        }
    ]

    payload = {
        "model": "{{MODEL}}",
        "messages": messages
    }

    response = requests.post(url, headers=headers, json=payload)
    print(response.json())
    ```

    ```typescript title="TypeScript (fetch)"
    import * as fs from 'fs';

    async function encodeVideoToBase64(videoPath: string): Promise<string> {
      const videoBuffer = await fs.promises.readFile(videoPath);
      const base64Video = videoBuffer.toString('base64');
      return `data:video/mp4;base64,${base64Video}`;
    }

    // Read and encode the video
    const videoPath = 'path/to/your/video.mp4';
    const base64Video = await encodeVideoToBase64(videoPath);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY_REF}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: "What's in this video?",
              },
              {
                type: 'video_url',
                video_url: {
                  url: base64Video,
                },
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();
    console.log(data);
    ```
  </CodeGroup>
</Template>

## Supported Video Formats

OpenRouter supports the following video formats:

* `video/mp4`
* `video/mpeg`
* `video/mov`
* `video/webm`

## Common Use Cases

Video inputs enable a wide range of applications:

* **Video Summarization**: Generate text summaries of video content
* **Object and Activity Recognition**: Identify objects, people, and actions in videos
* **Scene Understanding**: Describe settings, environments, and contexts
* **Sports Analysis**: Analyze gameplay, movements, and tactics
* **Surveillance**: Monitor and analyze security footage
* **Educational Content**: Analyze instructional videos and provide insights

## Best Practices

### File Size Considerations

Video files can be large, which affects both upload time and processing costs:

* **Compress videos** when possible to reduce file size without significant quality loss
* **Trim videos** to include only relevant segments
* **Consider resolution**: Lower resolutions (e.g., 720p vs 4K) reduce file size while maintaining usability for most analysis tasks
* **Frame rate**: Lower frame rates can reduce file size for videos where high temporal resolution isn't critical

### Optimal Video Length

Different models may have different limits on video duration:

* Check model-specific documentation for maximum video length
* For long videos, consider splitting into shorter segments
* Focus on key moments rather than sending entire long-form content

### Quality vs. Size Trade-offs

Balance video quality with practical considerations:

* **High quality** (1080p+, high bitrate): Best for detailed visual analysis, object detection, text recognition
* **Medium quality** (720p, moderate bitrate): Suitable for most general analysis tasks
* **Lower quality** (480p, lower bitrate): Acceptable for basic scene understanding and action recognition

## Provider-Specific Video URL Support

Video URL support varies significantly by provider:

* **Google Gemini (AI Studio)**: Only supports YouTube links (e.g., `https://www.youtube.com/watch?v=...`)
* **Google Gemini (Vertex AI)**: Does not support video URLs - use base64-encoded data URLs instead
* **Other providers**: Check model-specific documentation for video URL support

## Troubleshooting

**Video not processing?**

* Verify the model supports video input (check `input_modalities` includes `"video"`)
* If using a video URL, confirm the provider supports video URLs (see Provider-Specific Video URL Support above)
* For Gemini on AI Studio, ensure you're using a YouTube link, not a direct video file URL
* If the video URL isn't working, try using a base64-encoded data URL instead
* Check that the video format is supported
* Verify the video file isn't corrupted

**Large file errors?**

* Compress the video to reduce file size
* Reduce video resolution or frame rate
* Trim the video to a shorter duration
* Check model-specific file size limits
* Consider using a video URL (if supported by the provider) instead of base64 encoding for large files

**Poor analysis results?**

* Ensure video quality is sufficient for the task
* Provide clear, specific prompts about what to analyze
* Consider if the video duration is appropriate for the model
* Check if the video content is clearly visible and well-lit
***

title: Models
subtitle: One API for hundreds of models
headline: OpenRouter Models | Access 300+ AI Models Through One API
canonical-url: '[https://openrouter.ai/docs/guides/overview/models](https://openrouter.ai/docs/guides/overview/models)'
'og:site\_name': OpenRouter Documentation
'og:title': OpenRouter Models - Unified Access to 300+ AI Models
'og:description': >-
Access all major language models (LLMs) through OpenRouter's unified API.
Browse available models, compare capabilities, and integrate with your
preferred provider.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?pathname=models\&title=AI%20Model%20Hub\&description=Access%20all%20LLMs%20through%20one%20unified%20API%20endpoint](https://openrouter.ai/dynamic-og?pathname=models\&title=AI%20Model%20Hub\&description=Access%20all%20LLMs%20through%20one%20unified%20API%20endpoint)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

Explore and browse 300+ models and providers [on our website](/models), or [with our API](/docs/api-reference/models/get-models). You can also subscribe to our [RSS feed](/api/v1/models?use_rss=true) to stay updated on new models.

## Query Parameters

The Models API supports query parameters to filter the list of models returned.

### `output_modalities`

Filter models by their output capabilities. Accepts a comma-separated list of modalities or `"all"` to include every model regardless of output type.

| Value        | Description                                 |
| ------------ | ------------------------------------------- |
| `text`       | Models that produce text output (default)   |
| `image`      | Models that generate images                 |
| `audio`      | Models that produce audio output            |
| `embeddings` | Embedding models                            |
| `all`        | Include all models, skip modality filtering |

Examples:

```bash
# Default — text models only
curl "https://openrouter.ai/api/v1/models"

# Image generation models only
curl "https://openrouter.ai/api/v1/models?output_modalities=image"

# Text and image models
curl "https://openrouter.ai/api/v1/models?output_modalities=text,image"

# All models regardless of modality
curl "https://openrouter.ai/api/v1/models?output_modalities=all"
```

The same parameter is available on the [`/v1/models/count`](/docs/api-reference/models/count) endpoint so that counts stay consistent with list results.

### `supported_parameters`

Filter models by the API parameters they support. For example, to find models that support tool calling:

```bash
curl "https://openrouter.ai/api/v1/models?supported_parameters=tools"
```

## Models API Standard

Our [Models API](/docs/api-reference/models/get-models) makes the most important information about all LLMs freely available as soon as we confirm it.

### API Response Schema

The Models API returns a standardized JSON response format that provides comprehensive metadata for each available model. This schema is cached at the edge and designed for reliable integration with production applications.

#### Root Response Object

```json
{
  "data": [
    /* Array of Model objects */
  ]
}
```

#### Model Object Schema

Each model in the `data` array contains the following standardized fields:

| Field                  | Type                                          | Description                                                                            |
| ---------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `id`                   | `string`                                      | Unique model identifier used in API requests (e.g., `"google/gemini-2.5-pro-preview"`) |
| `canonical_slug`       | `string`                                      | Permanent slug for the model that never changes                                        |
| `name`                 | `string`                                      | Human-readable display name for the model                                              |
| `created`              | `number`                                      | Unix timestamp of when the model was added to OpenRouter                               |
| `description`          | `string`                                      | Detailed description of the model's capabilities and characteristics                   |
| `context_length`       | `number`                                      | Maximum context window size in tokens                                                  |
| `architecture`         | `Architecture`                                | Object describing the model's technical capabilities                                   |
| `pricing`              | `Pricing`                                     | Lowest price structure for using this model                                            |
| `top_provider`         | `TopProvider`                                 | Configuration details for the primary provider                                         |
| `per_request_limits`   | Rate limiting information (null if no limits) |                                                                                        |
| `supported_parameters` | `string[]`                                    | Array of supported API parameters for this model                                       |
| `default_parameters`   | `object \| null`                              | Default parameter values for this model (null if none)                                 |
| `expiration_date`      | `string \| null`                              | Deprecation date for the model endpoint (null if not deprecated)                       |

#### Architecture Object

```typescript
{
  "input_modalities": string[], // Supported input types: ["file", "image", "text"]
  "output_modalities": string[], // Supported output types: ["text"]
  "tokenizer": string,          // Tokenization method used
  "instruct_type": string | null // Instruction format type (null if not applicable)
}
```

#### Pricing Object

All pricing values are in USD per token/request/unit. A value of `"0"` indicates the feature is free.

```typescript
{
  "prompt": string,           // Cost per input token
  "completion": string,       // Cost per output token
  "request": string,          // Fixed cost per API request
  "image": string,           // Cost per image input
  "web_search": string,      // Cost per web search operation
  "internal_reasoning": string, // Cost for internal reasoning tokens
  "input_cache_read": string,   // Cost per cached input token read
  "input_cache_write": string   // Cost per cached input token write
}
```

#### Top Provider Object

```typescript
{
  "context_length": number,        // Provider-specific context limit
  "max_completion_tokens": number, // Maximum tokens in response
  "is_moderated": boolean         // Whether content moderation is applied
}
```

#### Supported Parameters

The `supported_parameters` array indicates which OpenAI-compatible parameters work with each model:

* `tools` - Function calling capabilities
* `tool_choice` - Tool selection control
* `max_tokens` - Response length limiting
* `temperature` - Randomness control
* `top_p` - Nucleus sampling
* `reasoning` - Internal reasoning mode
* `include_reasoning` - Include reasoning in response
* `structured_outputs` - JSON schema enforcement
* `response_format` - Output format specification
* `stop` - Custom stop sequences
* `frequency_penalty` - Repetition reduction
* `presence_penalty` - Topic diversity
* `seed` - Deterministic outputs

<Note title="Different models tokenize text in different ways">
  Some models break up text into chunks of multiple characters (GPT, Claude,
  Llama, etc), while others tokenize by character (PaLM). This means that token
  counts (and therefore costs) will vary between models, even when inputs and
  outputs are the same. Costs are displayed and billed according to the
  tokenizer for the model in use. You can use the `usage` field in the response
  to get the token counts for the input and output.
</Note>

If there are models or providers you are interested in that OpenRouter doesn't have, please tell us about them in our [Discord channel](https://openrouter.ai/discord).

## For Providers

If you're interested in working with OpenRouter, you can learn more on our [providers page](/docs/use-cases/for-providers).
***

title: Quickstart
subtitle: Get started with OpenRouter
slug: quickstart
headline: OpenRouter Quickstart Guide | Developer Documentation
canonical-url: '[https://openrouter.ai/docs/quickstart](https://openrouter.ai/docs/quickstart)'
'og:site\_name': OpenRouter Documentation
'og:title': OpenRouter Quickstart Guide
'og:description': >-
Get started with OpenRouter's unified API for hundreds of AI models. Learn how
to integrate using OpenAI SDK, direct API calls, or third-party frameworks.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?pathname=quickstart\&title=Quick%20Start\&description=Start%20using%20OpenRouter%20API%20in%20minutes%20with%20any%20SDK](https://openrouter.ai/dynamic-og?pathname=quickstart\&title=Quick%20Start\&description=Start%20using%20OpenRouter%20API%20in%20minutes%20with%20any%20SDK)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

OpenRouter provides a unified API that gives you access to hundreds of AI models through a single endpoint, while automatically handling fallbacks and selecting the most cost-effective options. Get started with just a few lines of code using your preferred SDK or framework.

<Note>
  ```
  Read https://openrouter.ai/skills/create-agent/SKILL.md and follow the instructions to build an agent using OpenRouter.
  ```
</Note>

<Tip>
  Looking for information about free models and rate limits? Please see the [FAQ](/docs/faq#how-are-rate-limits-calculated)
</Tip>

In the examples below, the OpenRouter-specific headers are optional. Setting them allows your app to appear on the OpenRouter leaderboards. For detailed information about app attribution, see our [App Attribution guide](/docs/app-attribution).

## Using the OpenRouter SDK (Beta)

First, install the SDK:

<CodeGroup>
  ```bash title="npm"
  npm install @openrouter/sdk
  ```

  ```bash title="yarn"
  yarn add @openrouter/sdk
  ```

  ```bash title="pnpm"
  pnpm add @openrouter/sdk
  ```
</CodeGroup>

Then use it in your code:

<CodeGroup>
  ```typescript title="TypeScript SDK"
  import { OpenRouter } from '@openrouter/sdk';

  const openRouter = new OpenRouter({
    apiKey: '<OPENROUTER_API_KEY>',
    defaultHeaders: {
      'HTTP-Referer': '<YOUR_SITE_URL>', // Optional. Site URL for rankings on openrouter.ai.
      'X-OpenRouter-Title': '<YOUR_SITE_NAME>', // Optional. Site title for rankings on openrouter.ai.
    },
  });

  const completion = await openRouter.chat.send({
    model: 'openai/gpt-5.2',
    messages: [
      {
        role: 'user',
        content: 'What is the meaning of life?',
      },
    ],
    stream: false,
  });

  console.log(completion.choices[0].message.content);
  ```
</CodeGroup>

## Using the OpenRouter API directly

<Tip>
  You can use the interactive [Request Builder](/request-builder) to generate OpenRouter API requests in the language of your choice.
</Tip>

<CodeGroup>
  ```python title="Python"
  import requests
  import json

  response = requests.post(
    url="https://openrouter.ai/api/v1/chat/completions",
    headers={
      "Authorization": "Bearer <OPENROUTER_API_KEY>",
      "HTTP-Referer": "<YOUR_SITE_URL>", # Optional. Site URL for rankings on openrouter.ai.
      "X-OpenRouter-Title": "<YOUR_SITE_NAME>", # Optional. Site title for rankings on openrouter.ai.
    },
    data=json.dumps({
      "model": "openai/gpt-5.2", # Optional
      "messages": [
        {
          "role": "user",
          "content": "What is the meaning of life?"
        }
      ]
    })
  )
  ```

  ```typescript title="TypeScript (fetch)"
  fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer <OPENROUTER_API_KEY>',
      'HTTP-Referer': '<YOUR_SITE_URL>', // Optional. Site URL for rankings on openrouter.ai.
      'X-OpenRouter-Title': '<YOUR_SITE_NAME>', // Optional. Site title for rankings on openrouter.ai.
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-5.2',
      messages: [
        {
          role: 'user',
          content: 'What is the meaning of life?',
        },
      ],
    }),
  });
  ```

  ```shell title="Shell"
  curl https://openrouter.ai/api/v1/chat/completions \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $OPENROUTER_API_KEY" \
    -d '{
    "model": "openai/gpt-5.2",
    "messages": [
      {
        "role": "user",
        "content": "What is the meaning of life?"
      }
    ]
  }'
  ```
</CodeGroup>

## Using the OpenAI SDK

<CodeGroup>
  ```typescript title="Typescript"
  import OpenAI from 'openai';

  const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: '<OPENROUTER_API_KEY>',
    defaultHeaders: {
      'HTTP-Referer': '<YOUR_SITE_URL>', // Optional. Site URL for rankings on openrouter.ai.
      'X-OpenRouter-Title': '<YOUR_SITE_NAME>', // Optional. Site title for rankings on openrouter.ai.
    },
  });

  async function main() {
    const completion = await openai.chat.completions.create({
      model: 'openai/gpt-5.2',
      messages: [
        {
          role: 'user',
          content: 'What is the meaning of life?',
        },
      ],
    });

    console.log(completion.choices[0].message);
  }

  main();
  ```

  ```python title="Python"
  from openai import OpenAI

  client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key="<OPENROUTER_API_KEY>",
  )

  completion = client.chat.completions.create(
    extra_headers={
      "HTTP-Referer": "<YOUR_SITE_URL>", # Optional. Site URL for rankings on openrouter.ai.
      "X-OpenRouter-Title": "<YOUR_SITE_NAME>", # Optional. Site title for rankings on openrouter.ai.
    },
    model="openai/gpt-5.2",
    messages=[
      {
        "role": "user",
        "content": "What is the meaning of life?"
      }
    ]
  )

  print(completion.choices[0].message.content)
  ```
</CodeGroup>

The API also supports [streaming](/docs/api/reference/streaming).

## Using third-party SDKs

For information about using third-party SDKs and frameworks with OpenRouter, please [see our frameworks documentation.](/docs/guides/community/frameworks-and-integrations-overview)
