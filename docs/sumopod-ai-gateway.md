AI API Quick Start
Get started with SumoPod AI API in minutes. Compatible with OpenAI SDK and tools.

Base URL:
https://ai.sumopod.com

Getting Started
1. Authentication
Create an API key from the API Keys tab. Set a budget limit to control your spending.

API Key Format:
sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
💡 Pro Tips:
• Set budget limits to avoid unexpected charges
• Use different keys for different projects
• Monitor usage in the Usage tab
• Keep your API keys secure and never share them
2. Code Examples
🌐cURL
🐍Python
⚡JavaScript
📦Node.js
cURL

Copy
curl https://ai.sumopod.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {
        "role": "user",
        "content": "Say hello in a creative way"
      }
    ],
    "max_tokens": 150,
    "temperature": 0.7
  }'
3. Streaming Response (Python)
Get real-time streaming responses for better user experience:

Python

Copy
from openai import OpenAI

client = OpenAI(
    api_key="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    base_url="https://ai.sumopod.com/v1"
)

# Stream the response
stream = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "user", "content": "Write a short story about AI"}
    ],
    max_tokens=500,
    temperature=0.7,
    stream=True  # Enable streaming
)

# Print each chunk as it arrives
for chunk in stream:
    if chunk.choices[0].delta.content is not None:
        print(chunk.choices[0].delta.content, end="")
4. Popular Models
Choose the right model for your use case:

gpt-4o-mini
Fast and cost-effective for most tasks

Best for: Chat, simple tasks, high volume
gpt-4o
Most capable model for complex tasks

Best for: Complex reasoning, analysis, coding
claude-3-haiku
Fast Anthropic model for quick responses

Best for: Quick tasks, summarization
deepseek-chat
Excellent for coding and technical tasks

Best for: Programming, technical writing
View all models and pricing
n8n Integration
Using with n8n Workflows
Integrate SumoPod AI into your n8n workflows using the OpenAI node with custom configuration:

1
Add OpenAI Node
Add an OpenAI node to your n8n workflow from the node palette.

2
Configure Credentials
Create new OpenAI credentials with these settings:

API Key:
sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Base URL:
https://ai.sumopod.com/v1

3
Select Model
Choose from available models like gpt-4o-mini,gpt-4o, or others from theModels tab.

✓
Ready to Use!
Your n8n workflow can now use SumoPod AI models with the same OpenAI node interface. Monitor usage and costs in your dashboard.