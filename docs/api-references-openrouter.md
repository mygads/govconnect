***

title: Embeddings
subtitle: Generate vector embeddings from text and images
headline: >-
Embeddings API | Convert Text and Images to Vector Representations with
OpenRouter
canonical-url: '[https://openrouter.ai/docs/api/reference/embeddings](https://openrouter.ai/docs/api/reference/embeddings)'
'og:site\_name': OpenRouter Documentation
'og:title': Embeddings API - Generate Vector Embeddings from Text and Images
'og:description': >-
Generate vector embeddings from text and images using OpenRouter's unified
embeddings API. Access multiple embedding models from different providers with
a single interface.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Embeddings%20API\&description=Generate%20Vector%20Embeddings%20from%20Text%20and%20Images](https://openrouter.ai/dynamic-og?title=Embeddings%20API\&description=Generate%20Vector%20Embeddings%20from%20Text%20and%20Images)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

Embeddings are numerical representations of text that capture semantic meaning. They convert text into vectors (arrays of numbers) that can be used for various machine learning tasks. OpenRouter provides a unified API to access embedding models from multiple providers.

## What are Embeddings?

Embeddings transform text into high-dimensional vectors where semantically similar texts are positioned closer together in vector space. For example, "cat" and "kitten" would have similar embeddings, while "cat" and "airplane" would be far apart.

These vector representations enable machines to understand relationships between pieces of text, making them essential for many AI applications.

## Common Use Cases

Embeddings are used in a wide variety of applications:

**RAG (Retrieval-Augmented Generation)**: Build RAG systems that retrieve relevant context from a knowledge base before generating answers. Embeddings help find the most relevant documents to include in the LLM's context.

**Semantic Search**: Convert documents and queries into embeddings, then find the most relevant documents by comparing vector similarity. This provides more accurate results than traditional keyword matching because it understands meaning rather than just matching words.

**Recommendation Systems**: Generate embeddings for items (products, articles, movies) and user preferences to recommend similar items. By comparing embedding vectors, you can find items that are semantically related even if they don't share obvious keywords.

**Clustering and Classification**: Group similar documents together or classify text into categories by analyzing embedding patterns. Documents with similar embeddings likely belong to the same topic or category.

**Duplicate Detection**: Identify duplicate or near-duplicate content by comparing embedding similarity. This works even when text is paraphrased or reworded.

**Anomaly Detection**: Detect unusual or outlier content by identifying embeddings that are far from typical patterns in your dataset.

## How to Use Embeddings

### Basic Request

To generate embeddings, send a POST request to `/embeddings` with your text input and chosen model:

<Template
  data={{
  API_KEY_REF,
  MODEL: 'openai/text-embedding-3-small'
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    import { OpenRouter } from '@openrouter/sdk';

    const openRouter = new OpenRouter({
      apiKey: '{{API_KEY_REF}}',
    });

    const response = await openRouter.embeddings.generate({
      model: '{{MODEL}}',
      input: 'The quick brown fox jumps over the lazy dog',
    });

    console.log(response.data[0].embedding);
    ```

    ```python title="Python"
    import requests

    response = requests.post(
      "https://openrouter.ai/api/v1/embeddings",
      headers={
        "Authorization": f"Bearer {{API_KEY_REF}}",
        "Content-Type": "application/json",
      },
      json={
        "model": "{{MODEL}}",
        "input": "The quick brown fox jumps over the lazy dog"
      }
    )

    data = response.json()
    embedding = data["data"][0]["embedding"]
    print(f"Embedding dimension: {len(embedding)}")
    ```

    ```typescript title="TypeScript (fetch)"
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer {{API_KEY_REF}}',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        input: 'The quick brown fox jumps over the lazy dog',
      }),
    });

    const data = await response.json();
    const embedding = data.data[0].embedding;
    console.log(`Embedding dimension: ${embedding.length}`);
    ```

    ```shell title="Shell"
    curl https://openrouter.ai/api/v1/embeddings \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $OPENROUTER_API_KEY" \
      -d '{
        "model": "{{MODEL}}",
        "input": "The quick brown fox jumps over the lazy dog"
      }'
    ```
  </CodeGroup>
</Template>

### Batch Processing

You can generate embeddings for multiple texts in a single request by passing an array of strings:

<Template
  data={{
  API_KEY_REF,
  MODEL: 'openai/text-embedding-3-small'
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    import { OpenRouter } from '@openrouter/sdk';

    const openRouter = new OpenRouter({
      apiKey: '{{API_KEY_REF}}',
    });

    const response = await openRouter.embeddings.generate({
      model: '{{MODEL}}',
      input: [
        'Machine learning is a subset of artificial intelligence',
        'Deep learning uses neural networks with multiple layers',
        'Natural language processing enables computers to understand text'
      ],
    });

    // Process each embedding
    response.data.forEach((item, index) => {
      console.log(`Embedding ${index}: ${item.embedding.length} dimensions`);
    });
    ```

    ```python title="Python"
    import requests

    response = requests.post(
      "https://openrouter.ai/api/v1/embeddings",
      headers={
        "Authorization": f"Bearer {{API_KEY_REF}}",
        "Content-Type": "application/json",
      },
      json={
        "model": "{{MODEL}}",
        "input": [
          "Machine learning is a subset of artificial intelligence",
          "Deep learning uses neural networks with multiple layers",
          "Natural language processing enables computers to understand text"
        ]
      }
    )

    data = response.json()
    for i, item in enumerate(data["data"]):
      print(f"Embedding {i}: {len(item['embedding'])} dimensions")
    ```

    ```typescript title="TypeScript (fetch)"
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer {{API_KEY_REF}}',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        input: [
          'Machine learning is a subset of artificial intelligence',
          'Deep learning uses neural networks with multiple layers',
          'Natural language processing enables computers to understand text'
        ],
      }),
    });

    const data = await response.json();
    data.data.forEach((item, index) => {
      console.log(`Embedding ${index}: ${item.embedding.length} dimensions`);
    });
    ```

    ```shell title="Shell"
    curl https://openrouter.ai/api/v1/embeddings \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $OPENROUTER_API_KEY" \
      -d '{
        "model": "{{MODEL}}",
        "input": [
          "Machine learning is a subset of artificial intelligence",
          "Deep learning uses neural networks with multiple layers",
          "Natural language processing enables computers to understand text"
        ]
      }'
    ```
  </CodeGroup>
</Template>

### Image Input

Some embedding models support image inputs, enabling multimodal embeddings that capture visual content alongside text. This is useful for image search, visual similarity, and cross-modal retrieval tasks.

To send an image, wrap your input in the multimodal format with a `content` array containing `image_url` objects. You can also combine text and images in a single input block.

<Template
  data={{
  API_KEY_REF,
  MODEL: 'nvidia/llama-nemotron-embed-vl-1b-v2'
}}
>
  <CodeGroup>
    ```python title="Python"
    import requests

    response = requests.post(
      "https://openrouter.ai/api/v1/embeddings",
      headers={
        "Authorization": f"Bearer {{API_KEY_REF}}",
        "Content-Type": "application/json",
      },
      json={
        "model": "{{MODEL}}",
        "input": [
          {
            "content": [
              {"type": "image_url", "image_url": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/640px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg"}}
            ]
          }
        ],
        "encoding_format": "float",
      }
    )

    data = response.json()
    embedding = data["data"][0]["embedding"]
    print(f"Embedding dimension: {len(embedding)}")
    ```

    ```typescript title="TypeScript (fetch)"
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer {{API_KEY_REF}}',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        input: [
          {
            content: [
              { type: 'image_url', image_url: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/640px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg' } }
            ]
          }
        ],
        encoding_format: 'float',
      }),
    });

    const data = await response.json();
    const embedding = data.data[0].embedding;
    console.log(`Embedding dimension: ${embedding.length}`);
    ```

    ```shell title="Shell"
    curl https://openrouter.ai/api/v1/embeddings \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $OPENROUTER_API_KEY" \
      -d '{
        "model": "{{MODEL}}",
        "input": [
          {
            "content": [
              {"type": "image_url", "image_url": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/640px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg"}}
            ]
          }
        ],
        "encoding_format": "float"
      }'
    ```
  </CodeGroup>
</Template>

You can also combine text and images in a single input to generate a joint embedding:

<Template
  data={{
  API_KEY_REF,
  MODEL: 'nvidia/llama-nemotron-embed-vl-1b-v2'
}}
>
  <CodeGroup>
    ```python title="Python"
    import requests

    response = requests.post(
      "https://openrouter.ai/api/v1/embeddings",
      headers={
        "Authorization": f"Bearer {{API_KEY_REF}}",
        "Content-Type": "application/json",
      },
      json={
        "model": "{{MODEL}}",
        "input": [
          {
            "content": [
              {"type": "text", "text": "A scenic boardwalk through a green meadow"},
              {"type": "image_url", "image_url": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/640px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg"}}
            ]
          }
        ],
        "encoding_format": "float",
      }
    )

    data = response.json()
    embedding = data["data"][0]["embedding"]
    print(f"Embedding dimension: {len(embedding)}")
    ```

    ```typescript title="TypeScript (fetch)"
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer {{API_KEY_REF}}',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        input: [
          {
            content: [
              { type: 'text', text: 'A scenic boardwalk through a green meadow' },
              { type: 'image_url', image_url: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/640px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg' } }
            ]
          }
        ],
        encoding_format: 'float',
      }),
    });

    const data = await response.json();
    const embedding = data.data[0].embedding;
    console.log(`Embedding dimension: ${embedding.length}`);
    ```

    ```shell title="Shell"
    curl https://openrouter.ai/api/v1/embeddings \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $OPENROUTER_API_KEY" \
      -d '{
        "model": "{{MODEL}}",
        "input": [
          {
            "content": [
              {"type": "text", "text": "A scenic boardwalk through a green meadow"},
              {"type": "image_url", "image_url": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/640px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg"}}
            ]
          }
        ],
        "encoding_format": "float"
      }'
    ```
  </CodeGroup>
</Template>

## API Reference

For detailed information about request parameters, response format, and all available options, see the [Embeddings API Reference](/docs/api-reference/embeddings/create-embeddings).

## Available Models

OpenRouter provides access to various embedding models from different providers. You can view all available embedding models at:

[https://openrouter.ai/models?fmt=cards\&output\_modalities=embeddings](https://openrouter.ai/models?fmt=cards\&output_modalities=embeddings)

To list all available embedding models programmatically:

<Template
  data={{
  API_KEY_REF
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    import { OpenRouter } from '@openrouter/sdk';

    const openRouter = new OpenRouter({
      apiKey: '{{API_KEY_REF}}',
    });

    const models = await openRouter.embeddings.listModels();
    console.log(models.data);
    ```

    ```python title="Python"
    import requests

    response = requests.get(
      "https://openrouter.ai/api/v1/embeddings/models",
      headers={
        "Authorization": f"Bearer {{API_KEY_REF}}",
      }
    )

    models = response.json()
    for model in models["data"]:
      print(f"{model['id']}: {model.get('context_length', 'N/A')} tokens")
    ```

    ```typescript title="TypeScript (fetch)"
    const response = await fetch('https://openrouter.ai/api/v1/embeddings/models', {
      headers: {
        'Authorization': 'Bearer {{API_KEY_REF}}',
      },
    });

    const models = await response.json();
    console.log(models.data);
    ```

    ```shell title="Shell"
    curl https://openrouter.ai/api/v1/embeddings/models \
      -H "Authorization: Bearer $OPENROUTER_API_KEY"
    ```
  </CodeGroup>
</Template>

## Practical Example: Semantic Search

Here's a complete example of building a semantic search system using embeddings:

<Template
  data={{
  API_KEY_REF,
  MODEL: 'openai/text-embedding-3-small'
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    import { OpenRouter } from '@openrouter/sdk';

    const openRouter = new OpenRouter({
      apiKey: '{{API_KEY_REF}}',
    });

    // Sample documents
    const documents = [
      "The cat sat on the mat",
      "Dogs are loyal companions",
      "Python is a programming language",
      "Machine learning models require training data",
      "The weather is sunny today"
    ];

    // Function to calculate cosine similarity
    function cosineSimilarity(a: number[], b: number[]): number {
      const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
      const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
      const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
      return dotProduct / (magnitudeA * magnitudeB);
    }

    async function semanticSearch(query: string, documents: string[]) {
      // Generate embeddings for all documents and the query
      const response = await openRouter.embeddings.generate({
        model: '{{MODEL}}',
        input: [query, ...documents],
      });

      const queryEmbedding = response.data[0].embedding;
      const docEmbeddings = response.data.slice(1);

      // Calculate similarity scores
      const results = documents.map((doc, i) => ({
        document: doc,
        similarity: cosineSimilarity(
          queryEmbedding as number[],
          docEmbeddings[i].embedding as number[]
        ),
      }));

      // Sort by similarity (highest first)
      results.sort((a, b) => b.similarity - a.similarity);

      return results;
    }

    // Search for documents related to pets
    const results = await semanticSearch("pets and animals", documents);
    console.log("Search results:");
    results.forEach((result, i) => {
      console.log(`${i + 1}. ${result.document} (similarity: ${result.similarity.toFixed(4)})`);
    });
    ```

    ```python title="Python"
    import requests
    import numpy as np

    OPENROUTER_API_KEY = "{{API_KEY_REF}}"

    # Sample documents
    documents = [
      "The cat sat on the mat",
      "Dogs are loyal companions",
      "Python is a programming language",
      "Machine learning models require training data",
      "The weather is sunny today"
    ]

    def cosine_similarity(a, b):
      """Calculate cosine similarity between two vectors"""
      dot_product = np.dot(a, b)
      magnitude_a = np.linalg.norm(a)
      magnitude_b = np.linalg.norm(b)
      return dot_product / (magnitude_a * magnitude_b)

    def semantic_search(query, documents):
      """Perform semantic search using embeddings"""
      # Generate embeddings for query and all documents
      response = requests.post(
        "https://openrouter.ai/api/v1/embeddings",
        headers={
          "Authorization": f"Bearer {OPENROUTER_API_KEY}",
          "Content-Type": "application/json",
        },
        json={
          "model": "{{MODEL}}",
          "input": [query] + documents
        }
      )
      
      data = response.json()
      query_embedding = np.array(data["data"][0]["embedding"])
      doc_embeddings = [np.array(item["embedding"]) for item in data["data"][1:]]
      
      # Calculate similarity scores
      results = []
      for i, doc in enumerate(documents):
        similarity = cosine_similarity(query_embedding, doc_embeddings[i])
        results.append({"document": doc, "similarity": similarity})
      
      # Sort by similarity (highest first)
      results.sort(key=lambda x: x["similarity"], reverse=True)
      
      return results

    # Search for documents related to pets
    results = semantic_search("pets and animals", documents)
    print("Search results:")
    for i, result in enumerate(results):
      print(f"{i + 1}. {result['document']} (similarity: {result['similarity']:.4f})")
    ```
  </CodeGroup>
</Template>

Expected output:

```
Search results:
1. Dogs are loyal companions (similarity: 0.8234)
2. The cat sat on the mat (similarity: 0.7891)
3. The weather is sunny today (similarity: 0.3456)
4. Machine learning models require training data (similarity: 0.2987)
5. Python is a programming language (similarity: 0.2654)
```

## Best Practices

**Choose the Right Model**: Different embedding models have different strengths. Smaller models (like qwen/qwen3-embedding-0.6b or openai/text-embedding-3-small) are faster and cheaper, while larger models (like openai/text-embedding-3-large) provide better quality. Test multiple models to find the best fit for your use case.

**Batch Your Requests**: When processing multiple texts, send them in a single request rather than making individual API calls. This reduces latency and costs.

**Cache Embeddings**: Embeddings for the same text are deterministic (they don't change). Store embeddings in a database or vector store to avoid regenerating them repeatedly.

**Normalize for Comparison**: When comparing embeddings, use cosine similarity rather than Euclidean distance. Cosine similarity is scale-invariant and works better for high-dimensional vectors.

**Consider Context Length**: Each model has a maximum input length (context window). Longer texts may need to be chunked or truncated. Check the model's specifications before processing long documents.

**Use Appropriate Chunking**: For long documents, split them into meaningful chunks (paragraphs, sections) rather than arbitrary character limits. This preserves semantic coherence.

## Provider Routing

You can control which providers serve your embedding requests using the `provider` parameter. This is useful for:

* Ensuring data privacy with specific providers
* Optimizing for cost or latency
* Using provider-specific features

Example with provider preferences:

```typescript
{
  "model": "openai/text-embedding-3-small",
  "input": "Your text here",
  "provider": {
    "order": ["openai", "azure"],
    "allow_fallbacks": true,
    "data_collection": "deny"
  }
}
```

For more information, see [Provider Routing](/docs/features/provider-routing).

## Error Handling

Common errors you may encounter:

**400 Bad Request**: Invalid input format or missing required parameters. Check that your `input` and `model` parameters are correctly formatted.

**401 Unauthorized**: Invalid or missing API key. Verify your API key is correct and included in the Authorization header.

**402 Payment Required**: Insufficient credits. Add credits to your OpenRouter account.

**404 Not Found**: The specified model doesn't exist or isn't available for embeddings. Check the model name and verify it's an embedding model.

**429 Too Many Requests**: Rate limit exceeded. Implement exponential backoff and retry logic.

**529 Provider Overloaded**: The provider is temporarily overloaded. Enable `allow_fallbacks: true` to automatically use backup providers.

## Limitations

* **No Streaming**: Unlike chat completions, embeddings are returned as complete responses. Streaming is not supported.
* **Token Limits**: Each model has a maximum input length. Texts exceeding this limit will be truncated or rejected.
* **Deterministic Output**: Embeddings for the same input text will always be identical (no temperature or randomness).
* **Language Support**: Some models are optimized for specific languages. Check model documentation for language capabilities.

## Related Resources

* [Models Page](https://openrouter.ai/models?fmt=cards\&output_modalities=embeddings) - Browse all available embedding models
* [Provider Routing](/docs/features/provider-routing) - Control which providers serve your requests
* [Authentication](/docs/api/authentication) - Learn about API key authentication
* [Errors](/docs/api/reference/errors-and-debugging) - Detailed error codes and handling
***

title: Parameters
headline: API Parameters | Configure OpenRouter API Requests
canonical-url: '[https://openrouter.ai/docs/api/reference/parameters](https://openrouter.ai/docs/api/reference/parameters)'
'og:site\_name': OpenRouter Documentation
'og:title': API Parameters - Complete Guide to Request Configuration
'og:description': >-
Learn about all available parameters for OpenRouter API requests. Configure
temperature, max tokens, top\_p, and other model-specific settings.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=API%20Parameters\&description=Complete%20guide%20to%20request%20configuration](https://openrouter.ai/dynamic-og?title=API%20Parameters\&description=Complete%20guide%20to%20request%20configuration)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

Sampling parameters shape the token generation process of the model. You may send any parameters from the following list, as well as others, to OpenRouter.

OpenRouter will default to the values listed below if certain parameters are absent from your request (for example, `temperature` to 1.0). We will also transmit some provider-specific parameters, such as `safe_prompt` for Mistral or `raw_mode` for Hyperbolic directly to the respective providers if specified.

Please refer to the model’s provider section to confirm which parameters are supported. For detailed guidance on managing provider-specific parameters, [click here](/docs/features/provider-routing#requiring-providers-to-support-all-parameters-beta).

## Temperature

* Key: `temperature`

* Optional, **float**, 0.0 to 2.0

* Default: 1.0

* Explainer Video: [Watch](https://youtu.be/ezgqHnWvua8)

This setting influences the variety in the model's responses. Lower values lead to more predictable and typical responses, while higher values encourage more diverse and less common responses. At 0, the model always gives the same response for a given input.

## Top P

* Key: `top_p`

* Optional, **float**, 0.0 to 1.0

* Default: 1.0

* Explainer Video: [Watch](https://youtu.be/wQP-im_HInk)

This setting limits the model's choices to a percentage of likely tokens: only the top tokens whose probabilities add up to P. A lower value makes the model's responses more predictable, while the default setting allows for a full range of token choices. Think of it like a dynamic Top-K.

## Top K

* Key: `top_k`

* Optional, **integer**, 0 or above

* Default: 0

* Explainer Video: [Watch](https://youtu.be/EbZv6-N8Xlk)

This limits the model's choice of tokens at each step, making it choose from a smaller set. A value of 1 means the model will always pick the most likely next token, leading to predictable results. By default this setting is disabled, making the model to consider all choices.

## Frequency Penalty

* Key: `frequency_penalty`

* Optional, **float**, -2.0 to 2.0

* Default: 0.0

* Explainer Video: [Watch](https://youtu.be/p4gl6fqI0_w)

This setting aims to control the repetition of tokens based on how often they appear in the input. It tries to use less frequently those tokens that appear more in the input, proportional to how frequently they occur. Token penalty scales with the number of occurrences. Negative values will encourage token reuse.

## Presence Penalty

* Key: `presence_penalty`

* Optional, **float**, -2.0 to 2.0

* Default: 0.0

* Explainer Video: [Watch](https://youtu.be/MwHG5HL-P74)

Adjusts how often the model repeats specific tokens already used in the input. Higher values make such repetition less likely, while negative values do the opposite. Token penalty does not scale with the number of occurrences. Negative values will encourage token reuse.

## Repetition Penalty

* Key: `repetition_penalty`

* Optional, **float**, 0.0 to 2.0

* Default: 1.0

* Explainer Video: [Watch](https://youtu.be/LHjGAnLm3DM)

Helps to reduce the repetition of tokens from the input. A higher value makes the model less likely to repeat tokens, but too high a value can make the output less coherent (often with run-on sentences that lack small words). Token penalty scales based on original token's probability.

## Min P

* Key: `min_p`

* Optional, **float**, 0.0 to 1.0

* Default: 0.0

Represents the minimum probability for a token to be
considered, relative to the probability of the most likely token. (The value changes depending on the confidence level of the most probable token.) If your Min-P is set to 0.1, that means it will only allow for tokens that are at least 1/10th as probable as the best possible option.

## Top A

* Key: `top_a`

* Optional, **float**, 0.0 to 1.0

* Default: 0.0

Consider only the top tokens with "sufficiently high" probabilities based on the probability of the most likely token. Think of it like a dynamic Top-P. A lower Top-A value focuses the choices based on the highest probability token but with a narrower scope. A higher Top-A value does not necessarily affect the creativity of the output, but rather refines the filtering process based on the maximum probability.

## Seed

* Key: `seed`

* Optional, **integer**

If specified, the inferencing will sample deterministically, such that repeated requests with the same seed and parameters should return the same result. Determinism is not guaranteed for some models.

## Max Tokens

* Key: `max_tokens`

* Optional, **integer**, 1 or above

This sets the upper limit for the number of tokens the model can generate in response. It won't produce more than this limit. The maximum value is the context length minus the prompt length.

## Max Completion Tokens

* Key: `max_completion_tokens`

* Optional, **integer**, 1 or above

This sets the upper limit for the number of tokens the model can generate in response. It won't produce more than this limit. The maximum value is the context length minus the prompt length.

## Logit Bias

* Key: `logit_bias`

* Optional, **map**

Accepts a JSON object that maps tokens (specified by their token ID in the tokenizer) to an associated bias value from -100 to 100. Mathematically, the bias is added to the logits generated by the model prior to sampling. The exact effect will vary per model, but values between -1 and 1 should decrease or increase likelihood of selection; values like -100 or 100 should result in a ban or exclusive selection of the relevant token.

## Logprobs

* Key: `logprobs`

* Optional, **boolean**

Whether to return log probabilities of the output tokens or not. If true, returns the log probabilities of each output token returned.

## Top Logprobs

* Key: `top_logprobs`

* Optional, **integer**

An integer between 0 and 20 specifying the number of most likely tokens to return at each token position, each with an associated log probability. logprobs must be set to true if this parameter is used.

## Response Format

* Key: `response_format`

* Optional, **map**

Forces the model to produce specific output format. Setting to `{ "type": "json_object" }` enables JSON mode, which guarantees the message the model generates is valid JSON.

**Note**: when using JSON mode, you should also instruct the model to produce JSON yourself via a system or user message.

## Structured Outputs

* Key: `structured_outputs`

* Optional, **boolean**

If the model can return structured outputs using response\_format json\_schema.

## Stop

* Key: `stop`

* Optional, **array**

Stop generation immediately if the model encounter any token specified in the stop array.

## Tools

* Key: `tools`

* Optional, **array**

Tool calling parameter, following OpenAI's tool calling request shape. For non-OpenAI providers, it will be transformed accordingly. [Click here to learn more about tool calling](/docs/guides/features/tool-calling)

## Tool Choice

* Key: `tool_choice`

* Optional, **string or object**

Controls which (if any) tool is called by the model. 'none' means the model will not call any tool and instead generates a message. 'auto' means the model can pick between generating a message or calling one or more tools. 'required' means the model must call one or more tools. Specifying a particular tool via `{"type": "function", "function": {"name": "my_function"}}` forces the model to call that tool.

## Parallel Tool Calls

* Key: `parallel_tool_calls`

* Optional, **boolean**

* Default: **true**

Whether to enable parallel function calling during tool use. If true, the model can call multiple functions simultaneously. If false, functions will be called sequentially. Only applies when tools are provided.

## Verbosity

* Key: `verbosity`

* Optional, **enum** (low, medium, high, xhigh, max)

* Default: **medium**

Constrains the verbosity of the model's response. Lower values produce more concise responses, while higher values produce more detailed and comprehensive responses. Introduced by OpenAI for the Responses API.

For Anthropic models, this parameter maps to `output_config.effort`. The 'xhigh' level is supported by Anthropic Claude 4.7 Opus and later models. The 'max' level is supported by Anthropic Claude 4.6 Opus and later models.
***

title: API Reference
subtitle: An overview of OpenRouter's API
headline: OpenRouter API Reference | Complete API Documentation
canonical-url: '[https://openrouter.ai/docs/api/reference/overview](https://openrouter.ai/docs/api/reference/overview)'
'og:site\_name': OpenRouter Documentation
'og:title': OpenRouter API Reference - Complete Documentation
'og:description': >-
Comprehensive guide to OpenRouter's API. Learn about request/response schemas,
authentication, parameters, and integration with multiple AI model providers.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=OpenRouter%20API%20Reference\&description=Comprehensive%20guide%20to%20OpenRouter's%20API](https://openrouter.ai/dynamic-og?title=OpenRouter%20API%20Reference\&description=Comprehensive%20guide%20to%20OpenRouter's%20API).
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

OpenRouter's request and response schemas are very similar to the OpenAI Chat API, with a few small differences. At a high level, **OpenRouter normalizes the schema across models and providers** so you only need to learn one.

## OpenAPI Specification

The complete OpenRouter API is documented using the OpenAPI specification. You can access the specification in either YAML or JSON format:

* **YAML**: [https://openrouter.ai/openapi.yaml](https://openrouter.ai/openapi.yaml)
* **JSON**: [https://openrouter.ai/openapi.json](https://openrouter.ai/openapi.json)

These specifications can be used with tools like [Swagger UI](https://swagger.io/tools/swagger-ui/), [Postman](https://www.postman.com/), or any OpenAPI-compatible code generator to explore the API or generate client libraries.

## Requests

### Completions Request Format

Here is the request schema as a TypeScript type. This will be the body of your `POST` request to the `/api/v1/chat/completions` endpoint (see the [quick start](/docs/quickstart) above for an example).

For a complete list of parameters, see the [Parameters](/docs/api-reference/parameters).

<CodeGroup>
  ```typescript title="Request Schema"
  // Definitions of subtypes are below
  type Request = {
    // Either "messages" or "prompt" is required
    messages?: Message[];
    prompt?: string;

    // If "model" is unspecified, uses the user's default
    model?: string; // See "Supported Models" section

    // Allows to force the model to produce specific output format.
    // See "Structured Outputs" section below and models page for which models support it.
    response_format?: ResponseFormat;

    stop?: string | string[];
    stream?: boolean; // Enable streaming

    // Plugins to extend model capabilities (PDF parsing, response healing)
    // See "Plugins" section: openrouter.ai/docs/guides/features/plugins
    plugins?: Plugin[];

    // See LLM Parameters (openrouter.ai/docs/api/reference/parameters)
    max_tokens?: number; // Range: [1, context_length)
    temperature?: number; // Range: [0, 2]

    // Tool calling
    // Will be passed down as-is for providers implementing OpenAI's interface.
    // For providers with custom interfaces, we transform and map the properties.
    // Otherwise, we transform the tools into a YAML template. The model responds with an assistant message.
    // See models supporting tool calling: openrouter.ai/models?supported_parameters=tools
    tools?: Tool[];
    tool_choice?: ToolChoice;

    // Advanced optional parameters
    seed?: number; // Integer only
    top_p?: number; // Range: (0, 1]
    top_k?: number; // Range: [1, Infinity) Not available for OpenAI models
    frequency_penalty?: number; // Range: [-2, 2]
    presence_penalty?: number; // Range: [-2, 2]
    repetition_penalty?: number; // Range: (0, 2]
    logit_bias?: { [key: number]: number };
    top_logprobs: number; // Integer only
    min_p?: number; // Range: [0, 1]
    top_a?: number; // Range: [0, 1]

    // Reduce latency by providing the model with a predicted output
    // https://platform.openai.com/docs/guides/latency-optimization#use-predicted-outputs
    prediction?: { type: 'content'; content: string };

    // OpenRouter-only parameters
    // See "Model Routing" section: openrouter.ai/docs/guides/features/model-routing
    models?: string[];
    route?: 'fallback';
    // See "Provider Routing" section: openrouter.ai/docs/guides/routing/provider-selection
    provider?: ProviderPreferences;
    user?: string; // A stable identifier for your end-users. Used to help detect and prevent abuse.

    // Debug options (streaming only)
    debug?: {
      echo_upstream_body?: boolean; // If true, returns the transformed request body sent to the provider
    };
  };

  // Subtypes:

  type TextContent = {
    type: 'text';
    text: string;
  };

  type ImageContentPart = {
    type: 'image_url';
    image_url: {
      url: string; // URL or base64 encoded image data
      detail?: string; // Optional, defaults to "auto"
    };
  };

  type ContentPart = TextContent | ImageContentPart;

  type Message =
    | {
        role: 'user' | 'assistant' | 'system';
        // ContentParts are only for the "user" role:
        content: string | ContentPart[];
        // If "name" is included, it will be prepended like this
        // for non-OpenAI models: `{name}: {content}`
        name?: string;
      }
    | {
        role: 'tool';
        content: string;
        tool_call_id: string;
        name?: string;
      };

  type FunctionDescription = {
    description?: string;
    name: string;
    parameters: object; // JSON Schema object
  };

  type Tool = {
    type: 'function';
    function: FunctionDescription;
  };

  type ToolChoice =
    | 'none'
    | 'auto'
    | {
        type: 'function';
        function: {
          name: string;
        };
      };

  // Response format for structured outputs
  type ResponseFormat =
    | { type: 'json_object' }
    | {
        type: 'json_schema';
        json_schema: {
          name: string;
          strict?: boolean;
          schema: object; // JSON Schema object
        };
      };

  // Plugin configuration
  type Plugin = {
    id: string; // 'web', 'file-parser', 'response-healing', 'context-compression'
    enabled?: boolean;
    // Additional plugin-specific options
    [key: string]: unknown;
  };
  ```
</CodeGroup>

### Structured Outputs

The `response_format` parameter allows you to enforce structured JSON responses from the model. OpenRouter supports two modes:

* `{ type: 'json_object' }`: Basic JSON mode - the model will return valid JSON
* `{ type: 'json_schema', json_schema: { ... } }`: Strict schema mode - the model will return JSON matching your exact schema

For detailed usage and examples, see [Structured Outputs](/docs/guides/features/structured-outputs). To find models that support structured outputs, check the [models page](https://openrouter.ai/models?supported_parameters=structured_outputs).

### Plugins

OpenRouter plugins extend model capabilities with features like web search, PDF processing, response healing, and context compression. Enable plugins by adding a `plugins` array to your request:

```json
{
  "plugins": [
    { "id": "web" },
    { "id": "response-healing" }
  ]
}
```

Available plugins include `web` (real-time web search), `file-parser` (PDF processing), `response-healing` (automatic JSON repair), and `context-compression` (middle-out prompt compression). For detailed configuration options, see [Plugins](/docs/guides/features/plugins)

### Headers

OpenRouter allows you to specify some optional headers to identify your app and make it discoverable to users on our site.

* `HTTP-Referer`: Identifies your app on openrouter.ai
* `X-OpenRouter-Title`: Sets/modifies your app's title (`X-Title` also accepted)
* `X-OpenRouter-Categories`: Assigns marketplace categories (see [App Attribution](/docs/app-attribution))

<CodeGroup>
  ```typescript title="TypeScript"
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
</CodeGroup>

<Info title="Model routing">
  If the `model` parameter is omitted, the user or payer's default is used.
  Otherwise, remember to select a value for `model` from the [supported
  models](/models) or [API](/api/v1/models), and include the organization
  prefix. OpenRouter will select the least expensive and best GPUs available to
  serve the request, and fall back to other providers or GPUs if it receives a
  5xx response code or if you are rate-limited.
</Info>

<Info title="Streaming">
  [Server-Sent Events
  (SSE)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#event_stream_format)
  are supported as well, to enable streaming *for all models*. Simply send
  `stream: true` in your request body. The SSE stream will occasionally contain
  a "comment" payload, which you should ignore (noted below).
</Info>

<Info title="Non-standard parameters">
  If the chosen model doesn't support a request parameter (such as `logit_bias`
  in non-OpenAI models, or `top_k` for OpenAI), then the parameter is ignored.
  The rest are forwarded to the underlying model API.
</Info>

### Assistant Prefill

OpenRouter supports asking models to complete a partial response. This can be useful for guiding models to respond in a certain way.

To use this features, simply include a message with `role: "assistant"` at the end of your `messages` array.

<CodeGroup>
  ```typescript title="TypeScript"
  fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer <OPENROUTER_API_KEY>',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-5.2',
      messages: [
        { role: 'user', content: 'What is the meaning of life?' },
        { role: 'assistant', content: "I'm not sure, but my best guess is" },
      ],
    }),
  });
  ```
</CodeGroup>

## Responses

### CompletionsResponse Format

OpenRouter normalizes the schema across models and providers to comply with the [OpenAI Chat API](https://platform.openai.com/docs/api-reference/chat).

This means that `choices` is always an array, even if the model only returns one completion. Each choice will contain a `delta` property if a stream was requested and a `message` property otherwise. This makes it easier to use the same code for all models.

Here's the response schema as a TypeScript type:

```typescript TypeScript
// Definitions of subtypes are below
type Response = {
  id: string;
  // Depending on whether you set "stream" to "true" and
  // whether you passed in "messages" or a "prompt", you
  // will get a different output shape
  choices: (NonStreamingChoice | StreamingChoice | NonChatChoice)[];
  created: number; // Unix timestamp
  model: string;
  object: 'chat.completion' | 'chat.completion.chunk';

  system_fingerprint?: string; // Only present if the provider supports it

  // Usage data is always returned for non-streaming.
  // When streaming, usage is returned exactly once in the final chunk
  // before the [DONE] message, with an empty choices array.
  usage?: ResponseUsage;
};
```

```typescript
// OpenRouter always returns detailed usage information.
// Token counts are calculated using the model's native tokenizer.

type ResponseUsage = {
  /** Including images, input audio, and tools if any */
  prompt_tokens: number;
  /** The tokens generated */
  completion_tokens: number;
  /** Sum of the above two fields */
  total_tokens: number;

  /** Breakdown of prompt tokens (optional) */
  prompt_tokens_details?: {
    cached_tokens: number;        // Tokens cached by the endpoint
    cache_write_tokens?: number;  // Tokens written to cache (models with explicit caching)
    audio_tokens?: number;        // Tokens used for input audio
    video_tokens?: number;        // Tokens used for input video
  };

  /** Breakdown of completion tokens (optional) */
  completion_tokens_details?: {
    reasoning_tokens?: number;    // Tokens generated for reasoning
    audio_tokens?: number;        // Tokens generated for audio output
    image_tokens?: number;        // Tokens generated for image output
  };

  /** Cost in credits (optional) */
  cost?: number;
  /** Whether request used Bring Your Own Key */
  is_byok?: boolean;
  /** Detailed cost breakdown (optional) */
  cost_details?: {
    upstream_inference_cost?: number;             // Only shown for BYOK requests
    upstream_inference_prompt_cost: number;
    upstream_inference_completions_cost: number;
  };

  /** Server-side tool usage (optional) */
  server_tool_use?: {
    web_search_requests?: number;
  };
};
```

```typescript
// Subtypes:
type NonChatChoice = {
  finish_reason: string | null;
  text: string;
  error?: ErrorResponse;
};

type NonStreamingChoice = {
  finish_reason: string | null;
  native_finish_reason: string | null;
  message: {
    content: string | null;
    role: string;
    tool_calls?: ToolCall[];
  };
  error?: ErrorResponse;
};

type StreamingChoice = {
  finish_reason: string | null;
  native_finish_reason: string | null;
  delta: {
    content: string | null;
    role?: string;
    tool_calls?: ToolCall[];
  };
  error?: ErrorResponse;
};

type ErrorResponse = {
  code: number; // See "Error Handling" section
  message: string;
  metadata?: Record<string, unknown>; // Contains additional error information such as provider details, the raw error message, etc.
};

type ToolCall = {
  id: string;
  type: 'function';
  function: FunctionCall;
};
```

Here's an example:

```json
{
  "id": "gen-xxxxxxxxxxxxxx",
  "choices": [
    {
      "finish_reason": "stop", // Normalized finish_reason
      "native_finish_reason": "stop", // The raw finish_reason from the provider
      "message": {
        // will be "delta" if streaming
        "role": "assistant",
        "content": "Hello there!"
      }
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 4,
    "total_tokens": 14,
    "prompt_tokens_details": {
      "cached_tokens": 0
    },
    "completion_tokens_details": {
      "reasoning_tokens": 0
    },
    "cost": 0.00014
  },
  "model": "openai/gpt-3.5-turbo" // Could also be "anthropic/claude-2.1", etc, depending on the "model" that ends up being used
}
```

### Finish Reason

OpenRouter normalizes each model's `finish_reason` to one of the following values: `tool_calls`, `stop`, `length`, `content_filter`, `error`.

Some models and providers may have additional finish reasons. The raw finish\_reason string returned by the model is available via the `native_finish_reason` property.

### Querying Cost and Stats

The token counts returned in the completions API response are calculated using the model's native tokenizer. Credit usage and model pricing are based on these native token counts.

You can also use the returned `id` to query for the generation stats (including token counts and cost) after the request is complete via the `/api/v1/generation` endpoint. This is useful for auditing historical usage or when you need to fetch stats asynchronously.

<CodeGroup>
  ```typescript title="Query Generation Stats"
  const generation = await fetch(
    'https://openrouter.ai/api/v1/generation?id=$GENERATION_ID',
    { headers },
  );

  const stats = await generation.json();
  ```
</CodeGroup>

Please see the [Generation](/docs/api-reference/get-a-generation) API reference for the full response shape.

Note that token counts are also available in the `usage` field of the response body for non-streaming completions.
***

title: Authentication
subtitle: API Authentication
headline: API Authentication | OpenRouter OAuth and API Keys
canonical-url: '[https://openrouter.ai/docs/api/reference/authentication](https://openrouter.ai/docs/api/reference/authentication)'
'og:site\_name': OpenRouter Documentation
'og:title': API Authentication - Secure Access to OpenRouter
'og:description': >-
Learn how to authenticate with OpenRouter using API keys and Bearer tokens.
Complete guide to secure authentication methods and best practices.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=API%20Authentication\&description=Secure%20access%20to%20OpenRouter](https://openrouter.ai/dynamic-og?title=API%20Authentication\&description=Secure%20access%20to%20OpenRouter)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

You can cover model costs with OpenRouter API keys.

Our API authenticates requests using Bearer tokens. This allows you to use `curl` or the [OpenAI SDK](https://platform.openai.com/docs/frameworks) directly with OpenRouter.

<Warning>
  API keys on OpenRouter are more powerful than keys used directly for model APIs.

  They allow users to set credit limits for apps, and they can be used in [OAuth](/docs/guides/overview/auth/oauth) flows.
</Warning>

## Using an API key

To use an API key, [first create your key](https://openrouter.ai/keys). Give it a name and you can optionally set a credit limit.

If you're calling the OpenRouter API directly, set the `Authorization` header to a Bearer token with your API key.

If you're using the OpenAI Typescript SDK, set the `api_base` to `https://openrouter.ai/api/v1` and the `apiKey` to your API key.

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
    messages: [{ role: 'user', content: 'Say this is a test' }],
    stream: false,
  });

  console.log(completion.choices[0].message);
  ```

  ```python title="Python (OpenAI SDK)"
  from openai import OpenAI

  client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key="<OPENROUTER_API_KEY>",
  )

  response = client.chat.completions.create(
    extra_headers={
      "HTTP-Referer": "<YOUR_SITE_URL>",  # Optional. Site URL for rankings on openrouter.ai.
      "X-OpenRouter-Title": "<YOUR_SITE_NAME>",     # Optional. Site title for rankings on openrouter.ai.
    },
    model="openai/gpt-5.2",
    messages=[
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ],
  )

  reply = response.choices[0].message
  ```

  ```typescript title="TypeScript (OpenAI SDK)"
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
      messages: [{ role: 'user', content: 'Say this is a test' }],
    });

    console.log(completion.choices[0].message);
  }

  main();
  ```

  ```typescript title="TypeScript (Raw API)"
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

  ```shell title="cURL"
  curl https://openrouter.ai/api/v1/chat/completions \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $OPENROUTER_API_KEY" \
    -d '{
    "model": "openai/gpt-5.2",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ]
  }'
  ```
</CodeGroup>

To stream with Python, [see this example from OpenAI](https://github.com/openai/openai-cookbook/blob/main/examples/How_to_stream_completions.ipynb).

## If your key has been exposed

<Warning>
  You must protect your API keys and never commit them to public repositories.
</Warning>

OpenRouter is a GitHub secret scanning partner, and has other methods to detect exposed keys. If we determine that your key has been compromised, you will receive an email notification.

If you receive such a notification or suspect your key has been exposed, immediately visit [your key settings page](https://openrouter.ai/settings/keys) to delete the compromised key and create a new one.

Using environment variables and keeping keys out of your codebase is strongly recommended.
***

title: Streaming
headline: API Streaming | Real-time Model Responses in OpenRouter
canonical-url: '[https://openrouter.ai/docs/api/reference/streaming](https://openrouter.ai/docs/api/reference/streaming)'
'og:site\_name': OpenRouter Documentation
'og:title': API Streaming - Real-time Model Response Integration
'og:description': >-
Learn how to implement streaming responses with OpenRouter's API. Complete
guide to Server-Sent Events (SSE) and real-time model outputs.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=API%20Streaming\&description=Real-time%20model%20response%20streaming](https://openrouter.ai/dynamic-og?title=API%20Streaming\&description=Real-time%20model%20response%20streaming)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

The OpenRouter API allows streaming responses from *any model*. This is useful for building chat interfaces or other applications where the UI should update as the model generates the response.

To enable streaming, you can set the `stream` parameter to `true` in your request. The model will then stream the response to the client in chunks, rather than returning the entire response at once.

Here is an example of how to stream a response, and process it:

<Template
  data={{
  API_KEY_REF,
  MODEL: Model.GPT_4_Omni
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    import { OpenRouter } from '@openrouter/sdk';

    const openRouter = new OpenRouter({
      apiKey: '{{API_KEY_REF}}',
    });

    const question = 'How would you build the tallest building ever?';

    const stream = await openRouter.chat.send({
      model: '{{MODEL}}',
      messages: [{ role: 'user', content: question }],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) {
        console.log(content);
      }

      // Final chunk includes usage stats
      if (chunk.usage) {
        console.log('Usage:', chunk.usage);
      }
    }
    ```

    ```python Python
    import requests
    import json

    question = "How would you build the tallest building ever?"

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
      "Authorization": f"Bearer {{API_KEY_REF}}",
      "Content-Type": "application/json"
    }

    payload = {
      "model": "{{MODEL}}",
      "messages": [{"role": "user", "content": question}],
      "stream": True
    }

    buffer = ""
    with requests.post(url, headers=headers, json=payload, stream=True) as r:
      for chunk in r.iter_content(chunk_size=1024, decode_unicode=True):
        buffer += chunk
        while True:
          try:
            # Find the next complete SSE line
            line_end = buffer.find('\n')
            if line_end == -1:
              break

            line = buffer[:line_end].strip()
            buffer = buffer[line_end + 1:]

            if line.startswith('data: '):
              data = line[6:]
              if data == '[DONE]':
                break

              try:
                data_obj = json.loads(data)
                content = data_obj["choices"][0]["delta"].get("content")
                if content:
                  print(content, end="", flush=True)
              except json.JSONDecodeError:
                pass
          except Exception:
            break
    ```

    ```typescript title="TypeScript (fetch)"
    const question = 'How would you build the tallest building ever?';
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY_REF}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '{{MODEL}}',
        messages: [{ role: 'user', content: question }],
        stream: true,
      }),
    });

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Append new chunk to buffer
        buffer += decoder.decode(value, { stream: true });

        // Process complete lines from buffer
        while (true) {
          const lineEnd = buffer.indexOf('\n');
          if (lineEnd === -1) break;

          const line = buffer.slice(0, lineEnd).trim();
          buffer = buffer.slice(lineEnd + 1);

          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices[0].delta.content;
              if (content) {
                console.log(content);
              }
            } catch (e) {
              // Ignore invalid JSON
            }
          }
        }
      }
    } finally {
      reader.cancel();
    }
    ```
  </CodeGroup>
</Template>

### Additional Information

For SSE (Server-Sent Events) streams, OpenRouter occasionally sends comments to prevent connection timeouts. These comments look like:

```text
: OPENROUTER PROCESSING
```

Comment payload can be safely ignored per the [SSE specs](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation). However, you can leverage it to improve UX as needed, e.g. by showing a dynamic loading indicator.

The generation ID is returned in the `X-Generation-Id` response header for all endpoints (chat completions, completions, responses, and messages), which can be useful for debugging and correlating requests.

Some SSE client implementations might not parse the payload according to spec, which leads to an uncaught error when you `JSON.stringify` the non-JSON payloads. We recommend the following clients:

* [eventsource-parser](https://github.com/rexxars/eventsource-parser)
* [OpenAI SDK](https://www.npmjs.com/package/openai)
* [Vercel AI SDK](https://www.npmjs.com/package/ai)

### Stream Cancellation

Streaming requests can be cancelled by aborting the connection. For supported providers, this immediately stops model processing and billing.

<Accordion title="Provider Support">
  **Supported**

  * OpenAI, Azure, Anthropic
  * Fireworks, Mancer, Recursal
  * AnyScale, Lepton, OctoAI
  * Novita, DeepInfra, Together
  * Cohere, Hyperbolic, Infermatic
  * Avian, XAI, Cloudflare
  * SFCompute, Nineteen, Liquid
  * Friendli, Chutes, DeepSeek

  **Not Currently Supported**

  * AWS Bedrock, Groq, Modal
  * Google, Google AI Studio, Minimax
  * HuggingFace, Replicate, Perplexity
  * Mistral, AI21, Featherless
  * Lynn, Lambda, Reflection
  * SambaNova, Inflection, ZeroOneAI
  * AionLabs, Alibaba, Nebius
  * Kluster, Targon, InferenceNet
</Accordion>

To implement stream cancellation:

<Template
  data={{
  API_KEY_REF,
  MODEL: Model.GPT_4_Omni
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    import { OpenRouter } from '@openrouter/sdk';

    const openRouter = new OpenRouter({
      apiKey: '{{API_KEY_REF}}',
    });

    const controller = new AbortController();

    try {
      const stream = await openRouter.chat.send({
        model: '{{MODEL}}',
        messages: [{ role: 'user', content: 'Write a story' }],
        stream: true,
      }, {
        signal: controller.signal,
      });

      for await (const chunk of stream) {
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) {
          console.log(content);
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Stream cancelled');
      } else {
        throw error;
      }
    }

    // To cancel the stream:
    controller.abort();
    ```

    ```python Python
    import requests
    from threading import Event, Thread

    def stream_with_cancellation(prompt: str, cancel_event: Event):
        with requests.Session() as session:
            response = session.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {{API_KEY_REF}}"},
                json={"model": "{{MODEL}}", "messages": [{"role": "user", "content": prompt}], "stream": True},
                stream=True
            )

            try:
                for line in response.iter_lines():
                    if cancel_event.is_set():
                        response.close()
                        return
                    if line:
                        print(line.decode(), end="", flush=True)
            finally:
                response.close()

    # Example usage:
    cancel_event = Event()
    stream_thread = Thread(target=lambda: stream_with_cancellation("Write a story", cancel_event))
    stream_thread.start()

    # To cancel the stream:
    cancel_event.set()
    ```

    ```typescript title="TypeScript (fetch)"
    const controller = new AbortController();

    try {
      const response = await fetch(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${{{API_KEY_REF}}}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: '{{MODEL}}',
            messages: [{ role: 'user', content: 'Write a story' }],
            stream: true,
          }),
          signal: controller.signal,
        },
      );

      // Process the stream...
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Stream cancelled');
      } else {
        throw error;
      }
    }

    // To cancel the stream:
    controller.abort();
    ```
  </CodeGroup>
</Template>

<Warning>
  Cancellation only works for streaming requests with supported providers. For
  non-streaming requests or unsupported providers, the model will continue
  processing and you will be billed for the complete response.
</Warning>

### Handling Errors During Streaming

OpenRouter handles errors differently depending on when they occur during the streaming process:

#### Errors Before Any Tokens Are Sent

If an error occurs before any tokens have been streamed to the client, OpenRouter returns a standard JSON error response with the appropriate HTTP status code. This follows the standard error format:

```json
{
  "error": {
    "code": 400,
    "message": "Invalid model specified"
  }
}
```

Common HTTP status codes include:

* **400**: Bad Request (invalid parameters)
* **401**: Unauthorized (invalid API key)
* **402**: Payment Required (insufficient credits)
* **429**: Too Many Requests (rate limited)
* **502**: Bad Gateway (provider error)
* **503**: Service Unavailable (no available providers)

#### Errors After Tokens Have Been Sent (Mid-Stream)

If an error occurs after some tokens have already been streamed to the client, OpenRouter cannot change the HTTP status code (which is already 200 OK). Instead, the error is sent as a Server-Sent Event (SSE) with a unified structure:

```text
data: {"id":"cmpl-abc123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-3.5-turbo","provider":"openai","error":{"code":"server_error","message":"Provider disconnected unexpectedly"},"choices":[{"index":0,"delta":{"content":""},"finish_reason":"error"}]}
```

Key characteristics of mid-stream errors:

* The error appears at the **top level** alongside standard response fields (id, object, created, etc.)
* A `choices` array is included with `finish_reason: "error"` to properly terminate the stream
* The HTTP status remains 200 OK since headers were already sent
* The stream is terminated after this unified error event

#### Code Examples

Here's how to properly handle both types of errors in your streaming implementation:

<Template
  data={{
  API_KEY_REF,
  MODEL: Model.GPT_4_Omni
}}
>
  <CodeGroup>
    ```typescript title="TypeScript SDK"
    import { OpenRouter } from '@openrouter/sdk';

    const openRouter = new OpenRouter({
      apiKey: '{{API_KEY_REF}}',
    });

    async function streamWithErrorHandling(prompt: string) {
      try {
        const stream = await openRouter.chat.send({
          model: '{{MODEL}}',
          messages: [{ role: 'user', content: prompt }],
          stream: true,
        });

        for await (const chunk of stream) {
          // Check for errors in chunk
          if ('error' in chunk) {
            console.error(`Stream error: ${chunk.error.message}`);
            if (chunk.choices?.[0]?.finish_reason === 'error') {
              console.log('Stream terminated due to error');
            }
            return;
          }

          // Process normal content
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) {
            console.log(content);
          }
        }
      } catch (error) {
        // Handle pre-stream errors
        console.error(`Error: ${error.message}`);
      }
    }
    ```

    ```python Python
    import requests
    import json

    async def stream_with_error_handling(prompt):
        response = requests.post(
            'https://openrouter.ai/api/v1/chat/completions',
            headers={'Authorization': f'Bearer {{API_KEY_REF}}'},
            json={
                'model': '{{MODEL}}',
                'messages': [{'role': 'user', 'content': prompt}],
                'stream': True
            },
            stream=True
        )

        # Check initial HTTP status for pre-stream errors
        if response.status_code != 200:
            error_data = response.json()
            print(f"Error: {error_data['error']['message']}")
            return

        # Process stream and handle mid-stream errors
        for line in response.iter_lines():
            if line:
                line_text = line.decode('utf-8')
                if line_text.startswith('data: '):
                    data = line_text[6:]
                    if data == '[DONE]':
                        break

                    try:
                        parsed = json.loads(data)

                        # Check for mid-stream error
                        if 'error' in parsed:
                            print(f"Stream error: {parsed['error']['message']}")
                            # Check finish_reason if needed
                            if parsed.get('choices', [{}])[0].get('finish_reason') == 'error':
                                print("Stream terminated due to error")
                            break

                        # Process normal content
                        content = parsed['choices'][0]['delta'].get('content')
                        if content:
                            print(content, end='', flush=True)

                    except json.JSONDecodeError:
                        pass
    ```

    ```typescript title="TypeScript (fetch)"
    async function streamWithErrorHandling(prompt: string) {
      const response = await fetch(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${{{API_KEY_REF}}}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: '{{MODEL}}',
            messages: [{ role: 'user', content: prompt }],
            stream: true,
          }),
        }
      );

      // Check initial HTTP status for pre-stream errors
      if (!response.ok) {
        const error = await response.json();
        console.error(`Error: ${error.error.message}`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          while (true) {
            const lineEnd = buffer.indexOf('\n');
            if (lineEnd === -1) break;

            const line = buffer.slice(0, lineEnd).trim();
            buffer = buffer.slice(lineEnd + 1);

            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') return;

              try {
                const parsed = JSON.parse(data);

                // Check for mid-stream error
                if (parsed.error) {
                  console.error(`Stream error: ${parsed.error.message}`);
                  // Check finish_reason if needed
                  if (parsed.choices?.[0]?.finish_reason === 'error') {
                    console.log('Stream terminated due to error');
                  }
                  return;
                }

                // Process normal content
                const content = parsed.choices[0].delta.content;
                if (content) {
                  console.log(content);
                }
              } catch (e) {
                // Ignore parsing errors
              }
            }
          }
        }
      } finally {
        reader.cancel();
      }
    }
    ```
  </CodeGroup>
</Template>

#### API-Specific Behavior

Different API endpoints may handle streaming errors slightly differently:

* **OpenAI Chat Completions API**: Returns `ErrorResponse` directly if no chunks were processed, or includes error information in the response if some chunks were processed
* **OpenAI Responses API**: May transform certain error codes (like `context_length_exceeded`) into a successful response with `finish_reason: "length"` instead of treating them as errors
***

title: Responses API Beta
subtitle: OpenAI-compatible Responses API (Beta)
headline: OpenRouter Responses API Beta
canonical-url: '[https://openrouter.ai/docs/api/reference/responses/overview](https://openrouter.ai/docs/api/reference/responses/overview)'
'og:site\_name': OpenRouter Documentation
'og:title': OpenRouter Responses API Beta - OpenAI-Compatible Documentation
'og:description': >-
Beta version of OpenRouter's OpenAI-compatible Responses API. Stateless
transformation layer with support for reasoning, tool calling, and web search.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Responses%20API%20Beta\&description=OpenAI-compatible%20stateless%20API](https://openrouter.ai/dynamic-og?title=Responses%20API%20Beta\&description=OpenAI-compatible%20stateless%20API)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

<Warning title="Beta API">
  This API is in **beta stage** and may have breaking changes. Use with caution in production environments.
</Warning>

<Info title="Stateless Only">
  This API is **stateless** - each request is independent and no conversation state is persisted between requests. You must include the full conversation history in each request.
</Info>

OpenRouter's Responses API Beta provides OpenAI-compatible access to multiple AI models through a unified interface, designed to be a drop-in replacement for OpenAI's Responses API. This stateless API offers enhanced capabilities including reasoning, tool calling, and web search integration, with each request being independent and no server-side state persisted.

## Base URL

```
https://openrouter.ai/api/v1/responses
```

## Authentication

All requests require authentication using your OpenRouter API key:

<CodeGroup>
  ```typescript title="TypeScript"
  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: 'Hello, world!',
    }),
  });
  ```

  ```python title="Python"
  import requests

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': 'Hello, world!',
      }
  )
  ```

  ```bash title="cURL"
  curl -X POST https://openrouter.ai/api/v1/responses \
    -H "Authorization: Bearer YOUR_OPENROUTER_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/o4-mini",
      "input": "Hello, world!"
    }'
  ```
</CodeGroup>

## Core Features

### [Basic Usage](./basic-usage)

Learn the fundamentals of making requests with simple text input and handling responses.

### [Reasoning](./reasoning)

Access advanced reasoning capabilities with configurable effort levels and encrypted reasoning chains.

### [Tool Calling](./tool-calling)

Integrate function calling with support for parallel execution and complex tool interactions.

### [Web Search](./web-search)

Enable web search capabilities with real-time information retrieval and citation annotations.

## Error Handling

The API returns structured error responses:

```json
{
  "error": {
    "code": "invalid_prompt",
    "message": "Missing required parameter: 'model'."
  },
  "metadata": null
}
```

For comprehensive error handling guidance, see [Error Handling](./error-handling).

## Rate Limits

Standard OpenRouter rate limits apply. See [API Limits](/docs/api-reference/limits) for details.
***

title: Basic Usage
subtitle: Getting started with the Responses API Beta
headline: Responses API Beta Basic Usage | Simple Text Requests
canonical-url: '[https://openrouter.ai/docs/api/reference/responses/basic-usage](https://openrouter.ai/docs/api/reference/responses/basic-usage)'
'og:site\_name': OpenRouter Documentation
'og:title': Responses API Beta Basic Usage - Simple Text Requests
'og:description': >-
Learn the basics of OpenRouter's Responses API Beta with simple text input
examples and response handling.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Responses%20API%20Basic%20Usage\&description=Simple%20text%20requests%20and%20responses](https://openrouter.ai/dynamic-og?title=Responses%20API%20Basic%20Usage\&description=Simple%20text%20requests%20and%20responses)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

<Warning title="Beta API">
  This API is in **beta stage** and may have breaking changes.
</Warning>

The Responses API Beta supports both simple string input and structured message arrays, making it easy to get started with basic text generation.

## Simple String Input

The simplest way to use the API is with a string input:

<CodeGroup>
  ```typescript title="TypeScript"
  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: 'What is the meaning of life?',
      max_output_tokens: 9000,
    }),
  });

  const result = await response.json();
  console.log(result);
  ```

  ```python title="Python"
  import requests

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': 'What is the meaning of life?',
          'max_output_tokens': 9000,
      }
  )

  result = response.json()
  print(result)
  ```

  ```bash title="cURL"
  curl -X POST https://openrouter.ai/api/v1/responses \
    -H "Authorization: Bearer YOUR_OPENROUTER_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/o4-mini",
      "input": "What is the meaning of life?",
      "max_output_tokens": 9000
    }'
  ```
</CodeGroup>

## Structured Message Input

For more complex conversations, use the message array format:

<CodeGroup>
  ```typescript title="TypeScript"
  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Tell me a joke about programming',
            },
          ],
        },
      ],
      max_output_tokens: 9000,
    }),
  });

  const result = await response.json();
  ```

  ```python title="Python"
  import requests

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': [
              {
                  'type': 'message',
                  'role': 'user',
                  'content': [
                      {
                          'type': 'input_text',
                          'text': 'Tell me a joke about programming',
                      },
                  ],
              },
          ],
          'max_output_tokens': 9000,
      }
  )

  result = response.json()
  ```

  ```bash title="cURL"
  curl -X POST https://openrouter.ai/api/v1/responses \
    -H "Authorization: Bearer YOUR_OPENROUTER_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/o4-mini",
      "input": [
        {
          "type": "message",
          "role": "user",
          "content": [
            {
              "type": "input_text",
              "text": "Tell me a joke about programming"
            }
          ]
        }
      ],
      "max_output_tokens": 9000
    }'
  ```
</CodeGroup>

## Response Format

The API returns a structured response with the generated content:

```json
{
  "id": "resp_1234567890",
  "object": "response",
  "created_at": 1234567890,
  "model": "openai/o4-mini",
  "output": [
    {
      "type": "message",
      "id": "msg_abc123",
      "status": "completed",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "The meaning of life is a philosophical question that has been pondered for centuries...",
          "annotations": []
        }
      ]
    }
  ],
  "usage": {
    "input_tokens": 12,
    "output_tokens": 45,
    "total_tokens": 57
  },
  "status": "completed"
}
```

## Streaming Responses

Enable streaming for real-time response generation:

<CodeGroup>
  ```typescript title="TypeScript"
  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: 'Write a short story about AI',
      stream: true,
      max_output_tokens: 9000,
    }),
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          console.log(parsed);
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
  }
  ```

  ```python title="Python"
  import requests
  import json

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': 'Write a short story about AI',
          'stream': True,
          'max_output_tokens': 9000,
      },
      stream=True
  )

  for line in response.iter_lines():
      if line:
          line_str = line.decode('utf-8')
          if line_str.startswith('data: '):
              data = line_str[6:]
              if data == '[DONE]':
                  break
              try:
                  parsed = json.loads(data)
                  print(parsed)
              except json.JSONDecodeError:
                  continue
  ```
</CodeGroup>

### Example Streaming Output

The streaming response returns Server-Sent Events (SSE) chunks:

```
data: {"type":"response.created","response":{"id":"resp_1234567890","object":"response","status":"in_progress"}}

data: {"type":"response.output_item.added","response_id":"resp_1234567890","output_index":0,"item":{"type":"message","id":"msg_abc123","role":"assistant","status":"in_progress","content":[]}}

data: {"type":"response.content_part.added","response_id":"resp_1234567890","output_index":0,"content_index":0,"part":{"type":"output_text","text":""}}

data: {"type":"response.content_part.delta","response_id":"resp_1234567890","output_index":0,"content_index":0,"delta":"Once"}

data: {"type":"response.content_part.delta","response_id":"resp_1234567890","output_index":0,"content_index":0,"delta":" upon"}

data: {"type":"response.content_part.delta","response_id":"resp_1234567890","output_index":0,"content_index":0,"delta":" a"}

data: {"type":"response.content_part.delta","response_id":"resp_1234567890","output_index":0,"content_index":0,"delta":" time"}

data: {"type":"response.output_item.done","response_id":"resp_1234567890","output_index":0,"item":{"type":"message","id":"msg_abc123","role":"assistant","status":"completed","content":[{"type":"output_text","text":"Once upon a time, in a world where artificial intelligence had become as common as smartphones..."}]}}

data: {"type":"response.done","response":{"id":"resp_1234567890","object":"response","status":"completed","usage":{"input_tokens":12,"output_tokens":45,"total_tokens":57}}}

data: [DONE]
```

## Common Parameters

| Parameter           | Type            | Description                                         |
| ------------------- | --------------- | --------------------------------------------------- |
| `model`             | string          | **Required.** Model to use (e.g., `openai/o4-mini`) |
| `input`             | string or array | **Required.** Text or message array                 |
| `stream`            | boolean         | Enable streaming responses (default: false)         |
| `max_output_tokens` | integer         | Maximum tokens to generate                          |
| `temperature`       | number          | Sampling temperature (0-2)                          |
| `top_p`             | number          | Nucleus sampling parameter (0-1)                    |

## Error Handling

Handle common errors gracefully:

<CodeGroup>
  ```typescript title="TypeScript"
  try {
    const response = await fetch('https://openrouter.ai/api/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/o4-mini',
        input: 'Hello, world!',
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('API Error:', error.error.message);
      return;
    }

    const result = await response.json();
    console.log(result);
  } catch (error) {
    console.error('Network Error:', error);
  }
  ```

  ```python title="Python"
  import requests

  try:
      response = requests.post(
          'https://openrouter.ai/api/v1/responses',
          headers={
              'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
              'Content-Type': 'application/json',
          },
          json={
              'model': 'openai/o4-mini',
              'input': 'Hello, world!',
          }
      )

      if response.status_code != 200:
          error = response.json()
          print(f"API Error: {error['error']['message']}")
      else:
          result = response.json()
          print(result)

  except requests.RequestException as e:
      print(f"Network Error: {e}")
  ```
</CodeGroup>

## Multiple Turn Conversations

Since the Responses API Beta is stateless, you must include the full conversation history in each request to maintain context:

<CodeGroup>
  ```typescript title="TypeScript"
  // First request
  const firstResponse = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'What is the capital of France?',
            },
          ],
        },
      ],
      max_output_tokens: 9000,
    }),
  });

  const firstResult = await firstResponse.json();

  // Second request - include previous conversation
  const secondResponse = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'What is the capital of France?',
            },
          ],
        },
        {
          type: 'message',
          role: 'assistant',
          id: 'msg_abc123',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              text: 'The capital of France is Paris.',
              annotations: []
            }
          ]
        },
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'What is the population of that city?',
            },
          ],
        },
      ],
      max_output_tokens: 9000,
    }),
  });

  const secondResult = await secondResponse.json();
  ```

  ```python title="Python"
  import requests

  # First request
  first_response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': [
              {
                  'type': 'message',
                  'role': 'user',
                  'content': [
                      {
                          'type': 'input_text',
                          'text': 'What is the capital of France?',
                      },
                  ],
              },
          ],
          'max_output_tokens': 9000,
      }
  )

  first_result = first_response.json()

  # Second request - include previous conversation
  second_response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': [
              {
                  'type': 'message',
                  'role': 'user',
                  'content': [
                      {
                          'type': 'input_text',
                          'text': 'What is the capital of France?',
                      },
                  ],
              },
              {
                  'type': 'message',
                  'role': 'assistant',
                  'id': 'msg_abc123',
                  'status': 'completed',
                  'content': [
                      {
                          'type': 'output_text',
                          'text': 'The capital of France is Paris.',
                          'annotations': []
                      }
                  ]
              },
              {
                  'type': 'message',
                  'role': 'user',
                  'content': [
                      {
                          'type': 'input_text',
                          'text': 'What is the population of that city?',
                      },
                  ],
              },
          ],
          'max_output_tokens': 9000,
      }
  )

  second_result = second_response.json()
  ```
</CodeGroup>

<Info title="Required Fields">
  The `id` and `status` fields are required for any `assistant` role messages included in the conversation history.
</Info>

<Info title="Conversation History">
  Always include the complete conversation history in each request. The API does not store previous messages, so context must be maintained client-side.
</Info>

## Next Steps

* Learn about [Reasoning](./reasoning) capabilities
* Explore [Tool Calling](./tool-calling) functionality
* Try [Web Search](./web-search) integration
***

title: Reasoning
subtitle: Advanced reasoning capabilities with the Responses API Beta
headline: Responses API Beta Reasoning | Advanced AI Reasoning Capabilities
canonical-url: '[https://openrouter.ai/docs/api/reference/responses/reasoning](https://openrouter.ai/docs/api/reference/responses/reasoning)'
'og:site\_name': OpenRouter Documentation
'og:title': Responses API Beta Reasoning - Advanced AI Reasoning
'og:description': >-
Access advanced reasoning capabilities with configurable effort levels and
encrypted reasoning chains using OpenRouter's Responses API Beta.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Responses%20API%20Reasoning\&description=Advanced%20AI%20reasoning%20capabilities](https://openrouter.ai/dynamic-og?title=Responses%20API%20Reasoning\&description=Advanced%20AI%20reasoning%20capabilities)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

<Warning title="Beta API">
  This API is in **beta stage** and may have breaking changes.
</Warning>

The Responses API Beta supports advanced reasoning capabilities, allowing models to show their internal reasoning process with configurable effort levels.

## Reasoning Configuration

Configure reasoning behavior using the `reasoning` parameter:

<CodeGroup>
  ```typescript title="TypeScript"
  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: 'What is the meaning of life?',
      reasoning: {
        effort: 'high'
      },
      max_output_tokens: 9000,
    }),
  });

  const result = await response.json();
  console.log(result);
  ```

  ```python title="Python"
  import requests

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': 'What is the meaning of life?',
          'reasoning': {
              'effort': 'high'
          },
          'max_output_tokens': 9000,
      }
  )

  result = response.json()
  print(result)
  ```

  ```bash title="cURL"
  curl -X POST https://openrouter.ai/api/v1/responses \
    -H "Authorization: Bearer YOUR_OPENROUTER_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/o4-mini",
      "input": "What is the meaning of life?",
      "reasoning": {
        "effort": "high"
      },
      "max_output_tokens": 9000
    }'
  ```
</CodeGroup>

## Reasoning Effort Levels

The `effort` parameter controls how much computational effort the model puts into reasoning:

| Effort Level | Description                                       |
| ------------ | ------------------------------------------------- |
| `minimal`    | Basic reasoning with minimal computational effort |
| `low`        | Light reasoning for simple problems               |
| `medium`     | Balanced reasoning for moderate complexity        |
| `high`       | Deep reasoning for complex problems               |

## Complex Reasoning Example

For complex mathematical or logical problems:

<CodeGroup>
  ```typescript title="TypeScript"
  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Was 1995 30 years ago? Please show your reasoning.',
            },
          ],
        },
      ],
      reasoning: {
        effort: 'high'
      },
      max_output_tokens: 9000,
    }),
  });

  const result = await response.json();
  console.log(result);
  ```

  ```python title="Python"
  import requests

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': [
              {
                  'type': 'message',
                  'role': 'user',
                  'content': [
                      {
                          'type': 'input_text',
                          'text': 'Was 1995 30 years ago? Please show your reasoning.',
                      },
                  ],
              },
          ],
          'reasoning': {
              'effort': 'high'
          },
          'max_output_tokens': 9000,
      }
  )

  result = response.json()
  print(result)
  ```
</CodeGroup>

## Reasoning in Conversation Context

Include reasoning in multi-turn conversations:

<CodeGroup>
  ```typescript title="TypeScript"
  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'What is your favorite color?',
            },
          ],
        },
        {
          type: 'message',
          role: 'assistant',
          id: 'msg_abc123',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              text: "I don't have a favorite color.",
              annotations: []
            }
          ]
        },
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'How many Earths can fit on Mars?',
            },
          ],
        },
      ],
      reasoning: {
        effort: 'high'
      },
      max_output_tokens: 9000,
    }),
  });

  const result = await response.json();
  console.log(result);
  ```

  ```python title="Python"
  import requests

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': [
              {
                  'type': 'message',
                  'role': 'user',
                  'content': [
                      {
                          'type': 'input_text',
                          'text': 'What is your favorite color?',
                      },
                  ],
              },
              {
                  'type': 'message',
                  'role': 'assistant',
                  'id': 'msg_abc123',
                  'status': 'completed',
                  'content': [
                      {
                          'type': 'output_text',
                          'text': "I don't have a favorite color.",
                          'annotations': []
                      }
                  ]
              },
              {
                  'type': 'message',
                  'role': 'user',
                  'content': [
                      {
                          'type': 'input_text',
                          'text': 'How many Earths can fit on Mars?',
                      },
                  ],
              },
          ],
          'reasoning': {
              'effort': 'high'
          },
          'max_output_tokens': 9000,
      }
  )

  result = response.json()
  print(result)
  ```
</CodeGroup>

## Streaming Reasoning

Enable streaming to see reasoning develop in real-time:

<CodeGroup>
  ```typescript title="TypeScript"
  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: 'Solve this step by step: If a train travels 60 mph for 2.5 hours, how far does it go?',
      reasoning: {
        effort: 'medium'
      },
      stream: true,
      max_output_tokens: 9000,
    }),
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'response.reasoning.delta') {
            console.log('Reasoning:', parsed.delta);
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
  }
  ```

  ```python title="Python"
  import requests
  import json

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': 'Solve this step by step: If a train travels 60 mph for 2.5 hours, how far does it go?',
          'reasoning': {
              'effort': 'medium'
          },
          'stream': True,
          'max_output_tokens': 9000,
      },
      stream=True
  )

  for line in response.iter_lines():
      if line:
          line_str = line.decode('utf-8')
          if line_str.startswith('data: '):
              data = line_str[6:]
              if data == '[DONE]':
                  break
              try:
                  parsed = json.loads(data)
                  if parsed.get('type') == 'response.reasoning.delta':
                      print(f"Reasoning: {parsed.get('delta', '')}")
              except json.JSONDecodeError:
                  continue
  ```
</CodeGroup>

## Response with Reasoning

When reasoning is enabled, the response includes reasoning information:

```json
{
  "id": "resp_1234567890",
  "object": "response",
  "created_at": 1234567890,
  "model": "openai/o4-mini",
  "output": [
    {
      "type": "reasoning",
      "id": "rs_abc123",
      "encrypted_content": "gAAAAABotI9-FK1PbhZhaZk4yMrZw3XDI1AWFaKb9T0NQq7LndK6zaRB...",
      "summary": [
        "First, I need to determine the current year",
        "Then calculate the difference from 1995",
        "Finally, compare that to 30 years"
      ]
    },
    {
      "type": "message",
      "id": "msg_xyz789",
      "status": "completed",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "Yes. In 2025, 1995 was 30 years ago. In fact, as of today (Aug 31, 2025), it's exactly 30 years since Aug 31, 1995.",
          "annotations": []
        }
      ]
    }
  ],
  "usage": {
    "input_tokens": 15,
    "output_tokens": 85,
    "output_tokens_details": {
      "reasoning_tokens": 45
    },
    "total_tokens": 100
  },
  "status": "completed"
}
```

## Best Practices

1. **Choose appropriate effort levels**: Use `high` for complex problems, `low` for simple tasks
2. **Consider token usage**: Reasoning increases token consumption
3. **Use streaming**: For long reasoning chains, streaming provides better user experience
4. **Include context**: Provide sufficient context for the model to reason effectively

## Next Steps

* Explore [Tool Calling](./tool-calling) with reasoning
* Learn about [Web Search](./web-search) integration
* Review [Basic Usage](./basic-usage) fundamentals
***

title: Tool Calling
subtitle: Function calling and tool integration with the Responses API Beta
headline: Responses API Beta Tool Calling | Function Calling Integration
canonical-url: '[https://openrouter.ai/docs/api/reference/responses/tool-calling](https://openrouter.ai/docs/api/reference/responses/tool-calling)'
'og:site\_name': OpenRouter Documentation
'og:title': Responses API Beta Tool Calling - Function Calling Integration
'og:description': >-
Integrate function calling with support for parallel execution and complex
tool interactions using OpenRouter's Responses API Beta.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Responses%20API%20Tool%20Calling\&description=Function%20calling%20integration](https://openrouter.ai/dynamic-og?title=Responses%20API%20Tool%20Calling\&description=Function%20calling%20integration)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

<Warning title="Beta API">
  This API is in **beta stage** and may have breaking changes.
</Warning>

The Responses API Beta supports comprehensive tool calling capabilities, allowing models to call functions, execute tools in parallel, and handle complex multi-step workflows.

## Basic Tool Definition

Define tools using the OpenAI function calling format:

<CodeGroup>
  ```typescript title="TypeScript"
  const weatherTool = {
    type: 'function' as const,
    name: 'get_weather',
    description: 'Get the current weather in a location',
    strict: null,
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'The city and state, e.g. San Francisco, CA',
        },
        unit: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
        },
      },
      required: ['location'],
    },
  };

  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'What is the weather in San Francisco?',
            },
          ],
        },
      ],
      tools: [weatherTool],
      tool_choice: 'auto',
      max_output_tokens: 9000,
    }),
  });

  const result = await response.json();
  console.log(result);
  ```

  ```python title="Python"
  import requests

  weather_tool = {
      'type': 'function',
      'name': 'get_weather',
      'description': 'Get the current weather in a location',
      'strict': None,
      'parameters': {
          'type': 'object',
          'properties': {
              'location': {
                  'type': 'string',
                  'description': 'The city and state, e.g. San Francisco, CA',
              },
              'unit': {
                  'type': 'string',
                  'enum': ['celsius', 'fahrenheit'],
              },
          },
          'required': ['location'],
      },
  }

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': [
              {
                  'type': 'message',
                  'role': 'user',
                  'content': [
                      {
                          'type': 'input_text',
                          'text': 'What is the weather in San Francisco?',
                      },
                  ],
              },
          ],
          'tools': [weather_tool],
          'tool_choice': 'auto',
          'max_output_tokens': 9000,
      }
  )

  result = response.json()
  print(result)
  ```

  ```bash title="cURL"
  curl -X POST https://openrouter.ai/api/v1/responses \
    -H "Authorization: Bearer YOUR_OPENROUTER_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/o4-mini",
      "input": [
        {
          "type": "message",
          "role": "user",
          "content": [
            {
              "type": "input_text",
              "text": "What is the weather in San Francisco?"
            }
          ]
        }
      ],
      "tools": [
        {
          "type": "function",
          "name": "get_weather",
          "description": "Get the current weather in a location",
          "strict": null,
          "parameters": {
            "type": "object",
            "properties": {
              "location": {
                "type": "string",
                "description": "The city and state, e.g. San Francisco, CA"
              },
              "unit": {
                "type": "string",
                "enum": ["celsius", "fahrenheit"]
              }
            },
            "required": ["location"]
          }
        }
      ],
      "tool_choice": "auto",
      "max_output_tokens": 9000
    }'
  ```
</CodeGroup>

## Tool Choice Options

Control when and how tools are called:

| Tool Choice                             | Description                         |
| --------------------------------------- | ----------------------------------- |
| `auto`                                  | Model decides whether to call tools |
| `none`                                  | Model will not call any tools       |
| `{type: 'function', name: 'tool_name'}` | Force specific tool call            |

### Force Specific Tool

<CodeGroup>
  ```typescript title="TypeScript"
  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Hello, how are you?',
            },
          ],
        },
      ],
      tools: [weatherTool],
      tool_choice: { type: 'function', name: 'get_weather' },
      max_output_tokens: 9000,
    }),
  });
  ```

  ```python title="Python"
  import requests

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': [
              {
                  'type': 'message',
                  'role': 'user',
                  'content': [
                      {
                          'type': 'input_text',
                          'text': 'Hello, how are you?',
                      },
                  ],
              },
          ],
          'tools': [weather_tool],
          'tool_choice': {'type': 'function', 'name': 'get_weather'},
          'max_output_tokens': 9000,
      }
  )
  ```
</CodeGroup>

### Disable Tool Calling

<CodeGroup>
  ```typescript title="TypeScript"
  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'What is the weather in Paris?',
            },
          ],
        },
      ],
      tools: [weatherTool],
      tool_choice: 'none',
      max_output_tokens: 9000,
    }),
  });
  ```

  ```python title="Python"
  import requests

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': [
              {
                  'type': 'message',
                  'role': 'user',
                  'content': [
                      {
                          'type': 'input_text',
                          'text': 'What is the weather in Paris?',
                      },
                  ],
              },
          ],
          'tools': [weather_tool],
          'tool_choice': 'none',
          'max_output_tokens': 9000,
      }
  )
  ```
</CodeGroup>

## Multiple Tools

Define multiple tools for complex workflows:

<CodeGroup>
  ```typescript title="TypeScript"
  const calculatorTool = {
    type: 'function' as const,
    name: 'calculate',
    description: 'Perform mathematical calculations',
    strict: null,
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'The mathematical expression to evaluate',
        },
      },
      required: ['expression'],
    },
  };

  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'What is 25 * 4?',
            },
          ],
        },
      ],
      tools: [weatherTool, calculatorTool],
      tool_choice: 'auto',
      max_output_tokens: 9000,
    }),
  });
  ```

  ```python title="Python"
  calculator_tool = {
      'type': 'function',
      'name': 'calculate',
      'description': 'Perform mathematical calculations',
      'strict': None,
      'parameters': {
          'type': 'object',
          'properties': {
              'expression': {
                  'type': 'string',
                  'description': 'The mathematical expression to evaluate',
              },
          },
          'required': ['expression'],
      },
  }

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': [
              {
                  'type': 'message',
                  'role': 'user',
                  'content': [
                      {
                          'type': 'input_text',
                          'text': 'What is 25 * 4?',
                      },
                  ],
              },
          ],
          'tools': [weather_tool, calculator_tool],
          'tool_choice': 'auto',
          'max_output_tokens': 9000,
      }
  )
  ```
</CodeGroup>

## Parallel Tool Calls

The API supports parallel execution of multiple tools:

<CodeGroup>
  ```typescript title="TypeScript"
  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Calculate 10*5 and also tell me the weather in Miami',
            },
          ],
        },
      ],
      tools: [weatherTool, calculatorTool],
      tool_choice: 'auto',
      max_output_tokens: 9000,
    }),
  });

  const result = await response.json();
  console.log(result);
  ```

  ```python title="Python"
  import requests

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': [
              {
                  'type': 'message',
                  'role': 'user',
                  'content': [
                      {
                          'type': 'input_text',
                          'text': 'Calculate 10*5 and also tell me the weather in Miami',
                      },
                  ],
              },
          ],
          'tools': [weather_tool, calculator_tool],
          'tool_choice': 'auto',
          'max_output_tokens': 9000,
      }
  )

  result = response.json()
  print(result)
  ```
</CodeGroup>

## Tool Call Response

When tools are called, the response includes function call information:

```json
{
  "id": "resp_1234567890",
  "object": "response",
  "created_at": 1234567890,
  "model": "openai/o4-mini",
  "output": [
    {
      "type": "function_call",
      "id": "fc_abc123",
      "call_id": "call_xyz789",
      "name": "get_weather",
      "arguments": "{\"location\":\"San Francisco, CA\"}"
    }
  ],
  "usage": {
    "input_tokens": 45,
    "output_tokens": 25,
    "total_tokens": 70
  },
  "status": "completed"
}
```

## Tool Responses in Conversation

Include tool responses in follow-up requests:

<CodeGroup>
  ```typescript title="TypeScript"
  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'What is the weather in Boston?',
            },
          ],
        },
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_123',
          name: 'get_weather',
          arguments: JSON.stringify({ location: 'Boston, MA' }),
        },
        {
          type: 'function_call_output',
          id: 'fc_output_1',
          call_id: 'call_123',
          output: JSON.stringify({ temperature: '72°F', condition: 'Sunny' }),
        },
        {
          type: 'message',
          role: 'assistant',
          id: 'msg_abc123',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              text: 'The weather in Boston is currently 72°F and sunny. This looks like perfect weather for a picnic!',
              annotations: []
            }
          ]
        },
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Is that good weather for a picnic?',
            },
          ],
        },
      ],
      max_output_tokens: 9000,
    }),
  });
  ```

  ```python title="Python"
  import requests

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': [
              {
                  'type': 'message',
                  'role': 'user',
                  'content': [
                      {
                          'type': 'input_text',
                          'text': 'What is the weather in Boston?',
                      },
                  ],
              },
              {
                  'type': 'function_call',
                  'id': 'fc_1',
                  'call_id': 'call_123',
                  'name': 'get_weather',
                  'arguments': '{"location": "Boston, MA"}',
              },
              {
                  'type': 'function_call_output',
                  'id': 'fc_output_1',
                  'call_id': 'call_123',
                  'output': '{"temperature": "72°F", "condition": "Sunny"}',
              },
              {
                  'type': 'message',
                  'role': 'assistant',
                  'id': 'msg_abc123',
                  'status': 'completed',
                  'content': [
                      {
                          'type': 'output_text',
                          'text': 'The weather in Boston is currently 72°F and sunny. This looks like perfect weather for a picnic!',
                          'annotations': []
                      }
                  ]
              },
              {
                  'type': 'message',
                  'role': 'user',
                  'content': [
                      {
                          'type': 'input_text',
                          'text': 'Is that good weather for a picnic?',
                      },
                  ],
              },
          ],
          'max_output_tokens': 9000,
      }
  )
  ```
</CodeGroup>

<Info title="Required Field">
  The `id` field is required for `function_call_output` objects when including tool responses in conversation history.
</Info>

## Streaming Tool Calls

Monitor tool calls in real-time with streaming:

<CodeGroup>
  ```typescript title="TypeScript"
  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'What is the weather like in Tokyo, Japan? Please check the weather.',
            },
          ],
        },
      ],
      tools: [weatherTool],
      tool_choice: 'auto',
      stream: true,
      max_output_tokens: 9000,
    }),
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'response.output_item.added' &&
              parsed.item?.type === 'function_call') {
            console.log('Function call:', parsed.item.name);
          }
          if (parsed.type === 'response.function_call_arguments.done') {
            console.log('Arguments:', parsed.arguments);
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
  }
  ```

  ```python title="Python"
  import requests
  import json

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': [
              {
                  'type': 'message',
                  'role': 'user',
                  'content': [
                      {
                          'type': 'input_text',
                          'text': 'What is the weather like in Tokyo, Japan? Please check the weather.',
                      },
                  ],
              },
          ],
          'tools': [weather_tool],
          'tool_choice': 'auto',
          'stream': True,
          'max_output_tokens': 9000,
      },
      stream=True
  )

  for line in response.iter_lines():
      if line:
          line_str = line.decode('utf-8')
          if line_str.startswith('data: '):
              data = line_str[6:]
              if data == '[DONE]':
                  break
              try:
                  parsed = json.loads(data)
                  if (parsed.get('type') == 'response.output_item.added' and
                      parsed.get('item', {}).get('type') == 'function_call'):
                      print(f"Function call: {parsed['item']['name']}")
                  if parsed.get('type') == 'response.function_call_arguments.done':
                      print(f"Arguments: {parsed.get('arguments', '')}")
              except json.JSONDecodeError:
                  continue
  ```
</CodeGroup>

## Tool Validation

Ensure tool calls have proper structure:

```json
{
  "type": "function_call",
  "id": "fc_abc123",
  "call_id": "call_xyz789",
  "name": "get_weather",
  "arguments": "{\"location\":\"Seattle, WA\"}"
}
```

Required fields:

* `type`: Always "function\_call"
* `id`: Unique identifier for the function call object
* `name`: Function name matching tool definition
* `arguments`: Valid JSON string with function parameters
* `call_id`: Unique identifier for the call

## Best Practices

1. **Clear descriptions**: Provide detailed function descriptions and parameter explanations
2. **Proper schemas**: Use valid JSON Schema for parameters
3. **Error handling**: Handle cases where tools might not be called
4. **Parallel execution**: Design tools to work independently when possible
5. **Conversation flow**: Include tool responses in follow-up requests for context

## Next Steps

* Learn about [Web Search](./web-search) integration
* Explore [Reasoning](./reasoning) with tools
* Review [Basic Usage](./basic-usage) fundamentals
***

title: Web Search
subtitle: Real-time web search integration with the Responses API Beta
headline: Responses API Beta Web Search | Real-time Information Retrieval
canonical-url: '[https://openrouter.ai/docs/api/reference/responses/web-search](https://openrouter.ai/docs/api/reference/responses/web-search)'
'og:site\_name': OpenRouter Documentation
'og:title': Responses API Beta Web Search - Real-time Information Retrieval
'og:description': >-
Enable web search capabilities with real-time information retrieval and
citation annotations using OpenRouter's Responses API Beta.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Responses%20API%20Web%20Search\&description=Real-time%20information%20retrieval](https://openrouter.ai/dynamic-og?title=Responses%20API%20Web%20Search\&description=Real-time%20information%20retrieval)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

<Warning title="Beta API">
  This API is in **beta stage** and may have breaking changes.
</Warning>

The Responses API Beta supports web search integration, allowing models to access real-time information from the internet and provide responses with proper citations and annotations.

<Warning title="Deprecated Plugin Approach">
  The web search plugin (`plugins: [{ id: "web" }]`) shown below is deprecated. Use the [`openrouter:web_search` server tool](/docs/guides/features/server-tools/web-search) instead, which works with both the Chat Completions and Responses APIs via the `tools` array.
</Warning>

## Web Search Plugin

Enable web search using the `plugins` parameter:

<CodeGroup>
  ```typescript title="TypeScript"
  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: 'What is OpenRouter?',
      plugins: [{ id: 'web', max_results: 3 }],
      max_output_tokens: 9000,
    }),
  });

  const result = await response.json();
  console.log(result);
  ```

  ```python title="Python"
  import requests

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': 'What is OpenRouter?',
          'plugins': [{'id': 'web', 'max_results': 3}],
          'max_output_tokens': 9000,
      }
  )

  result = response.json()
  print(result)
  ```

  ```bash title="cURL"
  curl -X POST https://openrouter.ai/api/v1/responses \
    -H "Authorization: Bearer YOUR_OPENROUTER_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/o4-mini",
      "input": "What is OpenRouter?",
      "plugins": [{"id": "web", "max_results": 3}],
      "max_output_tokens": 9000
    }'
  ```
</CodeGroup>

## Plugin Configuration

Configure web search behavior:

| Parameter         | Type      | Description                                                                       |
| ----------------- | --------- | --------------------------------------------------------------------------------- |
| `id`              | string    | **Required.** Must be "web"                                                       |
| `engine`          | string    | Search engine: `"native"`, `"exa"`, `"firecrawl"`, `"parallel"`, or omit for auto |
| `max_results`     | integer   | Maximum search results to retrieve (1-25, default 5)                              |
| `include_domains` | string\[] | Restrict results to these domains (supports wildcards like `*.substack.com`)      |
| `exclude_domains` | string\[] | Exclude results from these domains                                                |

See the [Web Search plugin docs](/docs/guides/features/plugins/web-search) for full details on engine selection, domain filter compatibility, and pricing.

## X Search Filters (xAI only)

When using xAI models (e.g. `x-ai/grok-4.1-fast`),
you can pass `x_search_filter` as a top-level
request parameter to filter X/Twitter search
results:

```json
{
  "model": "x-ai/grok-4.1-fast",
  "input": "What are people saying about AI?",
  "plugins": [{ "id": "web" }],
  "x_search_filter": {
    "allowed_x_handles": ["OpenRouterAI"],
    "from_date": "2025-01-01",
    "enable_image_understanding": true
  }
}
```

| Parameter                    | Type      | Description                                    |
| ---------------------------- | --------- | ---------------------------------------------- |
| `allowed_x_handles`          | string\[] | Only include posts from these handles (max 10) |
| `excluded_x_handles`         | string\[] | Exclude posts from these handles (max 10)      |
| `from_date`                  | string    | Start date (ISO 8601, e.g. `"2025-01-01"`)     |
| `to_date`                    | string    | End date (ISO 8601, e.g. `"2025-12-31"`)       |
| `enable_image_understanding` | boolean   | Analyze images in posts                        |
| `enable_video_understanding` | boolean   | Analyze videos in posts                        |

<Warning>
  `allowed_x_handles` and `excluded_x_handles` are
  mutually exclusive. See the
  [Web Search plugin docs](/docs/guides/features/plugins/web-search#x-search-filters-xai-only)
  for full details.
</Warning>

## Structured Message with Web Search

Use structured messages for more complex queries:

<CodeGroup>
  ```typescript title="TypeScript"
  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'What was a positive news story from today?',
            },
          ],
        },
      ],
      plugins: [{ id: 'web', max_results: 2 }],
      max_output_tokens: 9000,
    }),
  });

  const result = await response.json();
  console.log(result);
  ```

  ```python title="Python"
  import requests

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': [
              {
                  'type': 'message',
                  'role': 'user',
                  'content': [
                      {
                          'type': 'input_text',
                          'text': 'What was a positive news story from today?',
                      },
                  ],
              },
          ],
          'plugins': [{'id': 'web', 'max_results': 2}],
          'max_output_tokens': 9000,
      }
  )

  result = response.json()
  print(result)
  ```
</CodeGroup>

## Online Model Variants

<Warning title="Deprecated">
  The `:online` variant is deprecated. Use the [`openrouter:web_search` server tool](/docs/guides/features/server-tools/web-search) instead.
</Warning>

Some models have built-in web search capabilities using the `:online` variant:

<CodeGroup>
  ```typescript title="TypeScript"
  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini:online',
      input: 'What was a positive news story from today?',
      max_output_tokens: 9000,
    }),
  });

  const result = await response.json();
  console.log(result);
  ```

  ```python title="Python"
  import requests

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini:online',
          'input': 'What was a positive news story from today?',
          'max_output_tokens': 9000,
      }
  )

  result = response.json()
  print(result)
  ```
</CodeGroup>

## Response with Annotations

Web search responses include citation annotations:

```json
{
  "id": "resp_1234567890",
  "object": "response",
  "created_at": 1234567890,
  "model": "openai/o4-mini",
  "output": [
    {
      "type": "message",
      "id": "msg_abc123",
      "status": "completed",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "OpenRouter is a unified API for accessing multiple Large Language Model providers through a single interface. It allows developers to access 100+ AI models from providers like OpenAI, Anthropic, Google, and others with intelligent routing and automatic failover.",
          "annotations": [
            {
              "type": "url_citation",
              "url": "https://openrouter.ai/docs",
              "start_index": 0,
              "end_index": 85
            },
            {
              "type": "url_citation",
              "url": "https://openrouter.ai/models",
              "start_index": 120,
              "end_index": 180
            }
          ]
        }
      ]
    }
  ],
  "usage": {
    "input_tokens": 15,
    "output_tokens": 95,
    "total_tokens": 110
  },
  "status": "completed"
}
```

## Annotation Types

Web search responses can include different annotation types:

### URL Citation

```json
{
  "type": "url_citation",
  "url": "https://example.com/article",
  "start_index": 0,
  "end_index": 50
}
```

## Complex Search Queries

Handle multi-part search queries:

<CodeGroup>
  ```typescript title="TypeScript"
  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Compare OpenAI and Anthropic latest models',
            },
          ],
        },
      ],
      plugins: [{ id: 'web', max_results: 5 }],
      max_output_tokens: 9000,
    }),
  });

  const result = await response.json();
  console.log(result);
  ```

  ```python title="Python"
  import requests

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': [
              {
                  'type': 'message',
                  'role': 'user',
                  'content': [
                      {
                          'type': 'input_text',
                          'text': 'Compare OpenAI and Anthropic latest models',
                      },
                  ],
              },
          ],
          'plugins': [{'id': 'web', 'max_results': 5}],
          'max_output_tokens': 9000,
      }
  )

  result = response.json()
  print(result)
  ```
</CodeGroup>

## Web Search in Conversation

Include web search in multi-turn conversations:

<CodeGroup>
  ```typescript title="TypeScript"
  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'What is the latest version of React?',
            },
          ],
        },
        {
          type: 'message',
          id: 'msg_1',
          status: 'in_progress',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: 'Let me search for the latest React version.',
              annotations: [],
            },
          ],
        },
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Yes, please find the most recent information',
            },
          ],
        },
      ],
      plugins: [{ id: 'web', max_results: 2 }],
      max_output_tokens: 9000,
    }),
  });

  const result = await response.json();
  console.log(result);
  ```

  ```python title="Python"
  import requests

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': [
              {
                  'type': 'message',
                  'role': 'user',
                  'content': [
                      {
                          'type': 'input_text',
                          'text': 'What is the latest version of React?',
                      },
                  ],
              },
              {
                  'type': 'message',
                  'id': 'msg_1',
                  'status': 'in_progress',
                  'role': 'assistant',
                  'content': [
                      {
                          'type': 'output_text',
                          'text': 'Let me search for the latest React version.',
                          'annotations': [],
                      },
                  ],
              },
              {
                  'type': 'message',
                  'role': 'user',
                  'content': [
                      {
                          'type': 'input_text',
                          'text': 'Yes, please find the most recent information',
                      },
                  ],
              },
          ],
          'plugins': [{'id': 'web', 'max_results': 2}],
          'max_output_tokens': 9000,
      }
  )

  result = response.json()
  print(result)
  ```
</CodeGroup>

## Streaming Web Search

Monitor web search progress with streaming:

<CodeGroup>
  ```typescript title="TypeScript"
  const response = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/o4-mini',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'What is the latest news about AI?',
            },
          ],
        },
      ],
      plugins: [{ id: 'web', max_results: 2 }],
      stream: true,
      max_output_tokens: 9000,
    }),
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'response.output_item.added' &&
              parsed.item?.type === 'message') {
            console.log('Message added');
          }
          if (parsed.type === 'response.completed') {
            const annotations = parsed.response?.output
              ?.find(o => o.type === 'message')
              ?.content?.find(c => c.type === 'output_text')
              ?.annotations || [];
            console.log('Citations:', annotations.length);
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
  }
  ```

  ```python title="Python"
  import requests
  import json

  response = requests.post(
      'https://openrouter.ai/api/v1/responses',
      headers={
          'Authorization': 'Bearer YOUR_OPENROUTER_API_KEY',
          'Content-Type': 'application/json',
      },
      json={
          'model': 'openai/o4-mini',
          'input': [
              {
                  'type': 'message',
                  'role': 'user',
                  'content': [
                      {
                          'type': 'input_text',
                          'text': 'What is the latest news about AI?',
                      },
                  ],
              },
          ],
          'plugins': [{'id': 'web', 'max_results': 2}],
          'stream': True,
          'max_output_tokens': 9000,
      },
      stream=True
  )

  for line in response.iter_lines():
      if line:
          line_str = line.decode('utf-8')
          if line_str.startswith('data: '):
              data = line_str[6:]
              if data == '[DONE]':
                  break
              try:
                  parsed = json.loads(data)
                  if (parsed.get('type') == 'response.output_item.added' and
                      parsed.get('item', {}).get('type') == 'message'):
                      print('Message added')
                  if parsed.get('type') == 'response.completed':
                      output = parsed.get('response', {}).get('output', [])
                      message = next((o for o in output if o.get('type') == 'message'), {})
                      content = message.get('content', [])
                      text_content = next((c for c in content if c.get('type') == 'output_text'), {})
                      annotations = text_content.get('annotations', [])
                      print(f'Citations: {len(annotations)}')
              except json.JSONDecodeError:
                  continue
  ```
</CodeGroup>

## Annotation Processing

Extract and process citation information:

<CodeGroup>
  ```typescript title="TypeScript"
  function extractCitations(response: any) {
    const messageOutput = response.output?.find((o: any) => o.type === 'message');
    const textContent = messageOutput?.content?.find((c: any) => c.type === 'output_text');
    const annotations = textContent?.annotations || [];

    return annotations
      .filter((annotation: any) => annotation.type === 'url_citation')
      .map((annotation: any) => ({
        url: annotation.url,
        text: textContent.text.slice(annotation.start_index, annotation.end_index),
        startIndex: annotation.start_index,
        endIndex: annotation.end_index,
      }));
  }

  const result = await response.json();
  const citations = extractCitations(result);
  console.log('Found citations:', citations);
  ```

  ```python title="Python"
  def extract_citations(response_data):
      output = response_data.get('output', [])
      message_output = next((o for o in output if o.get('type') == 'message'), {})
      content = message_output.get('content', [])
      text_content = next((c for c in content if c.get('type') == 'output_text'), {})
      annotations = text_content.get('annotations', [])
      text = text_content.get('text', '')

      citations = []
      for annotation in annotations:
          if annotation.get('type') == 'url_citation':
              citations.append({
                  'url': annotation.get('url'),
                  'text': text[annotation.get('start_index', 0):annotation.get('end_index', 0)],
                  'start_index': annotation.get('start_index'),
                  'end_index': annotation.get('end_index'),
              })

      return citations

  result = response.json()
  citations = extract_citations(result)
  print(f'Found citations: {citations}')
  ```
</CodeGroup>

## Best Practices

1. **Limit results**: Use appropriate `max_results` to balance quality and speed
2. **Handle annotations**: Process citation annotations for proper attribution
3. **Query specificity**: Make search queries specific for better results
4. **Error handling**: Handle cases where web search might fail
5. **Rate limits**: Be mindful of search rate limits

## Next Steps

* Learn about [Tool Calling](./tool-calling) integration
* Explore [Reasoning](./reasoning) capabilities
* Review [Basic Usage](./basic-usage) fundamentals
***

title: Error Handling
subtitle: Understanding and handling errors in the Responses API Beta
headline: Responses API Beta Error Handling | Basic Error Guide
canonical-url: '[https://openrouter.ai/docs/api/reference/responses/error-handling](https://openrouter.ai/docs/api/reference/responses/error-handling)'
'og:site\_name': OpenRouter Documentation
'og:title': Responses API Beta Error Handling - Basic Error Guide
'og:description': >-
Learn how to handle errors in OpenRouter's Responses API Beta with the basic
error response format.
'og:image':
type: url
value: >-
[https://openrouter.ai/dynamic-og?title=Responses%20API%20Error%20Handling\&description=Basic%20error%20handling%20guide](https://openrouter.ai/dynamic-og?title=Responses%20API%20Error%20Handling\&description=Basic%20error%20handling%20guide)
'og:image:width': 1200
'og:image:height': 630
'twitter:card': summary\_large\_image
'twitter:site': '@OpenRouter'
noindex: false
nofollow: false
---------------

<Warning title="Beta API">
  This API is in **beta stage** and may have breaking changes. Use with caution in production environments.
</Warning>

<Info title="Stateless Only">
  This API is **stateless** - each request is independent and no conversation state is persisted between requests. You must include the full conversation history in each request.
</Info>

The Responses API Beta returns structured error responses that follow a consistent format.

## Error Response Format

All errors follow this structure:

```json
{
  "error": {
    "code": "invalid_prompt",
    "message": "Detailed error description"
  },
  "metadata": null
}
```

### Error Codes

The API uses the following error codes:

| Code                  | Description               | Equivalent HTTP Status |
| --------------------- | ------------------------- | ---------------------- |
| `invalid_prompt`      | Request validation failed | 400                    |
| `rate_limit_exceeded` | Too many requests         | 429                    |
| `server_error`        | Internal server error     | 500+                   |
# Create a response

POST https://openrouter.ai/api/v1/responses
Content-Type: application/json

Creates a streaming or non-streaming response using OpenResponses API format

Reference: https://openrouter.ai/docs/api/api-reference/responses/create-responses

## OpenAPI Specification

```yaml
openapi: 3.1.0
info:
  title: OpenRouter API
  version: 1.0.0
paths:
  /responses:
    post:
      operationId: create-responses
      summary: Create a response
      description: >-
        Creates a streaming or non-streaming response using OpenResponses API
        format
      tags:
        - subpackage_betaResponses
      parameters:
        - name: Authorization
          in: header
          description: API key as bearer token in Authorization header
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Successful response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/OpenResponsesResult'
        '400':
          description: Bad Request - Invalid request parameters or malformed input
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BadRequestResponse'
        '401':
          description: Unauthorized - Authentication required or invalid credentials
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UnauthorizedResponse'
        '402':
          description: Payment Required - Insufficient credits or quota to complete request
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PaymentRequiredResponse'
        '404':
          description: Not Found - Resource does not exist
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/NotFoundResponse'
        '408':
          description: Request Timeout - Operation exceeded time limit
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestTimeoutResponse'
        '413':
          description: Payload Too Large - Request payload exceeds size limits
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PayloadTooLargeResponse'
        '422':
          description: Unprocessable Entity - Semantic validation failure
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UnprocessableEntityResponse'
        '429':
          description: Too Many Requests - Rate limit exceeded
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TooManyRequestsResponse'
        '500':
          description: Internal Server Error - Unexpected server error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/InternalServerResponse'
        '502':
          description: Bad Gateway - Provider/upstream API failure
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BadGatewayResponse'
        '503':
          description: Service Unavailable - Service temporarily unavailable
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ServiceUnavailableResponse'
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ResponsesRequest'
servers:
  - url: https://openrouter.ai/api/v1
components:
  schemas:
    ImageConfig:
      oneOf:
        - type: string
        - type: number
          format: double
        - type: array
          items:
            description: Any type
      title: ImageConfig
    ResponseIncludesEnum:
      type: string
      enum:
        - file_search_call.results
        - message.input_image.image_url
        - computer_call_output.output.image_url
        - reasoning.encrypted_content
        - code_interpreter_call.outputs
      title: ResponseIncludesEnum
    ReasoningTextContentType:
      type: string
      enum:
        - reasoning_text
      title: ReasoningTextContentType
    ReasoningTextContent:
      type: object
      properties:
        text:
          type: string
        type:
          $ref: '#/components/schemas/ReasoningTextContentType'
      required:
        - text
        - type
      title: ReasoningTextContent
    OutputItemReasoningStatus0:
      type: string
      enum:
        - completed
      title: OutputItemReasoningStatus0
    OutputItemReasoningStatus1:
      type: string
      enum:
        - incomplete
      title: OutputItemReasoningStatus1
    OutputItemReasoningStatus2:
      type: string
      enum:
        - in_progress
      title: OutputItemReasoningStatus2
    OutputItemReasoningStatus:
      oneOf:
        - $ref: '#/components/schemas/OutputItemReasoningStatus0'
        - $ref: '#/components/schemas/OutputItemReasoningStatus1'
        - $ref: '#/components/schemas/OutputItemReasoningStatus2'
      title: OutputItemReasoningStatus
    ReasoningSummaryTextType:
      type: string
      enum:
        - summary_text
      title: ReasoningSummaryTextType
    ReasoningSummaryText:
      type: object
      properties:
        text:
          type: string
        type:
          $ref: '#/components/schemas/ReasoningSummaryTextType'
      required:
        - text
        - type
      title: ReasoningSummaryText
    OutputItemReasoningType:
      type: string
      enum:
        - reasoning
      title: OutputItemReasoningType
    ReasoningFormat:
      type: string
      enum:
        - unknown
        - openai-responses-v1
        - azure-openai-responses-v1
        - xai-responses-v1
        - anthropic-claude-v1
        - google-gemini-v1
      title: ReasoningFormat
    ReasoningItem:
      type: object
      properties:
        content:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/ReasoningTextContent'
        encrypted_content:
          type:
            - string
            - 'null'
        id:
          type: string
        status:
          $ref: '#/components/schemas/OutputItemReasoningStatus'
        summary:
          type: array
          items:
            $ref: '#/components/schemas/ReasoningSummaryText'
        type:
          $ref: '#/components/schemas/OutputItemReasoningType'
        format:
          $ref: '#/components/schemas/ReasoningFormat'
        signature:
          type:
            - string
            - 'null'
      required:
        - id
        - summary
        - type
      description: Reasoning output item with signature and format extensions
      title: ReasoningItem
    InputTextType:
      type: string
      enum:
        - input_text
      title: InputTextType
    InputText:
      type: object
      properties:
        text:
          type: string
        type:
          $ref: '#/components/schemas/InputTextType'
      required:
        - text
        - type
      description: Text input content item
      title: InputText
    InputImageDetail:
      type: string
      enum:
        - auto
        - high
        - low
      title: InputImageDetail
    InputImageType:
      type: string
      enum:
        - input_image
      title: InputImageType
    EasyInputMessageContentOneOf0Items1:
      type: object
      properties:
        detail:
          $ref: '#/components/schemas/InputImageDetail'
        image_url:
          type:
            - string
            - 'null'
        type:
          $ref: '#/components/schemas/InputImageType'
      required:
        - detail
        - type
      description: Image input content item
      title: EasyInputMessageContentOneOf0Items1
    InputFileType:
      type: string
      enum:
        - input_file
      title: InputFileType
    InputFile:
      type: object
      properties:
        file_data:
          type: string
        file_id:
          type:
            - string
            - 'null'
        file_url:
          type: string
        filename:
          type: string
        type:
          $ref: '#/components/schemas/InputFileType'
      required:
        - type
      description: File input content item
      title: InputFile
    InputAudioInputAudioFormat:
      type: string
      enum:
        - mp3
        - wav
      title: InputAudioInputAudioFormat
    InputAudioInputAudio:
      type: object
      properties:
        data:
          type: string
        format:
          $ref: '#/components/schemas/InputAudioInputAudioFormat'
      required:
        - data
        - format
      title: InputAudioInputAudio
    InputAudioType:
      type: string
      enum:
        - input_audio
      title: InputAudioType
    InputAudio:
      type: object
      properties:
        input_audio:
          $ref: '#/components/schemas/InputAudioInputAudio'
        type:
          $ref: '#/components/schemas/InputAudioType'
      required:
        - input_audio
        - type
      description: Audio input content item
      title: InputAudio
    InputVideoType:
      type: string
      enum:
        - input_video
      title: InputVideoType
    InputVideo:
      type: object
      properties:
        type:
          $ref: '#/components/schemas/InputVideoType'
        video_url:
          type: string
          description: A base64 data URL or remote URL that resolves to a video file
      required:
        - type
        - video_url
      description: Video input content item
      title: InputVideo
    EasyInputMessageContentOneOf0Items:
      oneOf:
        - $ref: '#/components/schemas/InputText'
        - $ref: '#/components/schemas/EasyInputMessageContentOneOf0Items1'
        - $ref: '#/components/schemas/InputFile'
        - $ref: '#/components/schemas/InputAudio'
        - $ref: '#/components/schemas/InputVideo'
      title: EasyInputMessageContentOneOf0Items
    EasyInputMessageContent0:
      type: array
      items:
        $ref: '#/components/schemas/EasyInputMessageContentOneOf0Items'
      title: EasyInputMessageContent0
    EasyInputMessageContent:
      oneOf:
        - $ref: '#/components/schemas/EasyInputMessageContent0'
        - type: string
        - description: Any type
      title: EasyInputMessageContent
    EasyInputMessagePhase0:
      type: string
      enum:
        - commentary
      title: EasyInputMessagePhase0
    EasyInputMessagePhase1:
      type: string
      enum:
        - final_answer
      title: EasyInputMessagePhase1
    EasyInputMessagePhase:
      oneOf:
        - $ref: '#/components/schemas/EasyInputMessagePhase0'
        - $ref: '#/components/schemas/EasyInputMessagePhase1'
        - description: Any type
      description: >-
        The phase of an assistant message. Use `commentary` for an intermediate
        assistant message and `final_answer` for the final assistant message.
        For follow-up requests with models like `gpt-5.3-codex` and later,
        preserve and resend phase on all assistant messages. Omitting it can
        degrade performance. Not used for user messages.
      title: EasyInputMessagePhase
    EasyInputMessageRole0:
      type: string
      enum:
        - user
      title: EasyInputMessageRole0
    EasyInputMessageRole1:
      type: string
      enum:
        - system
      title: EasyInputMessageRole1
    EasyInputMessageRole2:
      type: string
      enum:
        - assistant
      title: EasyInputMessageRole2
    EasyInputMessageRole3:
      type: string
      enum:
        - developer
      title: EasyInputMessageRole3
    EasyInputMessageRole:
      oneOf:
        - $ref: '#/components/schemas/EasyInputMessageRole0'
        - $ref: '#/components/schemas/EasyInputMessageRole1'
        - $ref: '#/components/schemas/EasyInputMessageRole2'
        - $ref: '#/components/schemas/EasyInputMessageRole3'
      title: EasyInputMessageRole
    EasyInputMessageType:
      type: string
      enum:
        - message
      title: EasyInputMessageType
    EasyInputMessage:
      type: object
      properties:
        content:
          $ref: '#/components/schemas/EasyInputMessageContent'
        phase:
          $ref: '#/components/schemas/EasyInputMessagePhase'
          description: >-
            The phase of an assistant message. Use `commentary` for an
            intermediate assistant message and `final_answer` for the final
            assistant message. For follow-up requests with models like
            `gpt-5.3-codex` and later, preserve and resend phase on all
            assistant messages. Omitting it can degrade performance. Not used
            for user messages.
        role:
          $ref: '#/components/schemas/EasyInputMessageRole'
        type:
          $ref: '#/components/schemas/EasyInputMessageType'
      required:
        - role
      title: EasyInputMessage
    InputMessageItemContentItems1:
      type: object
      properties:
        detail:
          $ref: '#/components/schemas/InputImageDetail'
        image_url:
          type:
            - string
            - 'null'
        type:
          $ref: '#/components/schemas/InputImageType'
      required:
        - detail
        - type
      description: Image input content item
      title: InputMessageItemContentItems1
    InputMessageItemContentItems:
      oneOf:
        - $ref: '#/components/schemas/InputText'
        - $ref: '#/components/schemas/InputMessageItemContentItems1'
        - $ref: '#/components/schemas/InputFile'
        - $ref: '#/components/schemas/InputAudio'
        - $ref: '#/components/schemas/InputVideo'
      title: InputMessageItemContentItems
    InputMessageItemRole0:
      type: string
      enum:
        - user
      title: InputMessageItemRole0
    InputMessageItemRole1:
      type: string
      enum:
        - system
      title: InputMessageItemRole1
    InputMessageItemRole2:
      type: string
      enum:
        - developer
      title: InputMessageItemRole2
    InputMessageItemRole:
      oneOf:
        - $ref: '#/components/schemas/InputMessageItemRole0'
        - $ref: '#/components/schemas/InputMessageItemRole1'
        - $ref: '#/components/schemas/InputMessageItemRole2'
      title: InputMessageItemRole
    InputMessageItemType:
      type: string
      enum:
        - message
      title: InputMessageItemType
    InputMessageItem:
      type: object
      properties:
        content:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/InputMessageItemContentItems'
        id:
          type: string
        role:
          $ref: '#/components/schemas/InputMessageItemRole'
        type:
          $ref: '#/components/schemas/InputMessageItemType'
      required:
        - role
      title: InputMessageItem
    ToolCallStatus:
      type: string
      enum:
        - in_progress
        - completed
        - incomplete
      title: ToolCallStatus
    OpenAiResponseFunctionToolCallType:
      type: string
      enum:
        - function_call
      title: OpenAiResponseFunctionToolCallType
    FunctionCallItem:
      type: object
      properties:
        arguments:
          type: string
        call_id:
          type: string
        id:
          type: string
        name:
          type: string
        status:
          $ref: '#/components/schemas/ToolCallStatus'
        type:
          $ref: '#/components/schemas/OpenAiResponseFunctionToolCallType'
      required:
        - arguments
        - call_id
        - name
        - type
      description: A function call initiated by the model
      title: FunctionCallItem
    InputImage:
      type: object
      properties:
        detail:
          $ref: '#/components/schemas/InputImageDetail'
        image_url:
          type:
            - string
            - 'null'
        type:
          $ref: '#/components/schemas/InputImageType'
      required:
        - detail
        - type
      description: Image input content item
      title: InputImage
    OpenAiResponseFunctionToolCallOutputOutputOneOf1Items:
      oneOf:
        - $ref: '#/components/schemas/InputText'
        - $ref: '#/components/schemas/InputImage'
        - $ref: '#/components/schemas/InputFile'
      title: OpenAiResponseFunctionToolCallOutputOutputOneOf1Items
    OpenAiResponseFunctionToolCallOutputOutput1:
      type: array
      items:
        $ref: >-
          #/components/schemas/OpenAiResponseFunctionToolCallOutputOutputOneOf1Items
      title: OpenAiResponseFunctionToolCallOutputOutput1
    OpenAiResponseFunctionToolCallOutputOutput:
      oneOf:
        - type: string
        - $ref: '#/components/schemas/OpenAiResponseFunctionToolCallOutputOutput1'
      title: OpenAiResponseFunctionToolCallOutputOutput
    OpenAiResponseFunctionToolCallOutputStatus:
      type: object
      properties: {}
      title: OpenAiResponseFunctionToolCallOutputStatus
    OpenAiResponseFunctionToolCallOutputType:
      type: string
      enum:
        - function_call_output
      title: OpenAiResponseFunctionToolCallOutputType
    FunctionCallOutputItemOutputOneOf1Items1:
      type: object
      properties:
        detail:
          $ref: '#/components/schemas/InputImageDetail'
        image_url:
          type:
            - string
            - 'null'
        type:
          $ref: '#/components/schemas/InputImageType'
      required:
        - detail
        - type
      description: Image input content item
      title: FunctionCallOutputItemOutputOneOf1Items1
    FunctionCallOutputItemOutputOneOf1Items:
      oneOf:
        - $ref: '#/components/schemas/InputText'
        - $ref: '#/components/schemas/FunctionCallOutputItemOutputOneOf1Items1'
        - $ref: '#/components/schemas/InputFile'
      title: FunctionCallOutputItemOutputOneOf1Items
    FunctionCallOutputItemOutput1:
      type: array
      items:
        $ref: '#/components/schemas/FunctionCallOutputItemOutputOneOf1Items'
      title: FunctionCallOutputItemOutput1
    FunctionCallOutputItemOutput:
      oneOf:
        - type: string
        - $ref: '#/components/schemas/FunctionCallOutputItemOutput1'
      title: FunctionCallOutputItemOutput
    FunctionCallOutputItem:
      type: object
      properties:
        call_id:
          type: string
        id:
          type:
            - string
            - 'null'
        output:
          $ref: '#/components/schemas/FunctionCallOutputItemOutput'
        status:
          $ref: '#/components/schemas/OpenAiResponseFunctionToolCallOutputStatus'
        type:
          $ref: '#/components/schemas/OpenAiResponseFunctionToolCallOutputType'
      required:
        - call_id
        - output
        - type
      description: The output from a function call execution
      title: FunctionCallOutputItem
    FileCitationType:
      type: string
      enum:
        - file_citation
      title: FileCitationType
    FileCitation:
      type: object
      properties:
        file_id:
          type: string
        filename:
          type: string
        index:
          type: integer
        type:
          $ref: '#/components/schemas/FileCitationType'
      required:
        - file_id
        - filename
        - index
        - type
      title: FileCitation
    UrlCitationType:
      type: string
      enum:
        - url_citation
      title: UrlCitationType
    URLCitation:
      type: object
      properties:
        end_index:
          type: integer
        start_index:
          type: integer
        title:
          type: string
        type:
          $ref: '#/components/schemas/UrlCitationType'
        url:
          type: string
      required:
        - end_index
        - start_index
        - title
        - type
        - url
      title: URLCitation
    FilePathType:
      type: string
      enum:
        - file_path
      title: FilePathType
    FilePath:
      type: object
      properties:
        file_id:
          type: string
        index:
          type: integer
        type:
          $ref: '#/components/schemas/FilePathType'
      required:
        - file_id
        - index
        - type
      title: FilePath
    OpenAIResponsesAnnotation:
      oneOf:
        - $ref: '#/components/schemas/FileCitation'
        - $ref: '#/components/schemas/URLCitation'
        - $ref: '#/components/schemas/FilePath'
      title: OpenAIResponsesAnnotation
    ResponseOutputTextLogprobsItemsTopLogprobsItems:
      type: object
      properties:
        bytes:
          type: array
          items:
            type: integer
        logprob:
          type: number
          format: double
        token:
          type: string
      required:
        - bytes
        - logprob
        - token
      title: ResponseOutputTextLogprobsItemsTopLogprobsItems
    ResponseOutputTextLogprobsItems:
      type: object
      properties:
        bytes:
          type: array
          items:
            type: integer
        logprob:
          type: number
          format: double
        token:
          type: string
        top_logprobs:
          type: array
          items:
            $ref: >-
              #/components/schemas/ResponseOutputTextLogprobsItemsTopLogprobsItems
      required:
        - bytes
        - logprob
        - token
        - top_logprobs
      title: ResponseOutputTextLogprobsItems
    ResponseOutputTextType:
      type: string
      enum:
        - output_text
      title: ResponseOutputTextType
    ResponseOutputText:
      type: object
      properties:
        annotations:
          type: array
          items:
            $ref: '#/components/schemas/OpenAIResponsesAnnotation'
        logprobs:
          type: array
          items:
            $ref: '#/components/schemas/ResponseOutputTextLogprobsItems'
        text:
          type: string
        type:
          $ref: '#/components/schemas/ResponseOutputTextType'
      required:
        - text
        - type
      title: ResponseOutputText
    OpenAiResponsesRefusalContentType:
      type: string
      enum:
        - refusal
      title: OpenAiResponsesRefusalContentType
    OpenAIResponsesRefusalContent:
      type: object
      properties:
        refusal:
          type: string
        type:
          $ref: '#/components/schemas/OpenAiResponsesRefusalContentType'
      required:
        - refusal
        - type
      title: OpenAIResponsesRefusalContent
    OutputMessageContentItems:
      oneOf:
        - $ref: '#/components/schemas/ResponseOutputText'
        - $ref: '#/components/schemas/OpenAIResponsesRefusalContent'
      title: OutputMessageContentItems
    OutputMessagePhase0:
      type: string
      enum:
        - commentary
      title: OutputMessagePhase0
    OutputMessagePhase1:
      type: string
      enum:
        - final_answer
      title: OutputMessagePhase1
    OutputMessagePhase:
      oneOf:
        - $ref: '#/components/schemas/OutputMessagePhase0'
        - $ref: '#/components/schemas/OutputMessagePhase1'
        - description: Any type
      description: >-
        The phase of an assistant message. Use `commentary` for an intermediate
        assistant message and `final_answer` for the final assistant message.
        For follow-up requests with models like `gpt-5.3-codex` and later,
        preserve and resend phase on all assistant messages. Omitting it can
        degrade performance. Not used for user messages.
      title: OutputMessagePhase
    OutputMessageRole:
      type: string
      enum:
        - assistant
      title: OutputMessageRole
    OutputMessageStatus0:
      type: string
      enum:
        - completed
      title: OutputMessageStatus0
    OutputMessageStatus1:
      type: string
      enum:
        - incomplete
      title: OutputMessageStatus1
    OutputMessageStatus2:
      type: string
      enum:
        - in_progress
      title: OutputMessageStatus2
    OutputMessageStatus:
      oneOf:
        - $ref: '#/components/schemas/OutputMessageStatus0'
        - $ref: '#/components/schemas/OutputMessageStatus1'
        - $ref: '#/components/schemas/OutputMessageStatus2'
      title: OutputMessageStatus
    OutputMessageType:
      type: string
      enum:
        - message
      title: OutputMessageType
    InputsOneOf1ItemsOneOf5ContentOneOf0Items:
      oneOf:
        - $ref: '#/components/schemas/ResponseOutputText'
        - $ref: '#/components/schemas/OpenAIResponsesRefusalContent'
      title: InputsOneOf1ItemsOneOf5ContentOneOf0Items
    InputsOneOf1ItemsOneOf5Content0:
      type: array
      items:
        $ref: '#/components/schemas/InputsOneOf1ItemsOneOf5ContentOneOf0Items'
      title: InputsOneOf1ItemsOneOf5Content0
    InputsOneOf1ItemsOneOf5Content:
      oneOf:
        - $ref: '#/components/schemas/InputsOneOf1ItemsOneOf5Content0'
        - type: string
        - description: Any type
      title: InputsOneOf1ItemsOneOf5Content
    InputsOneOf1Items5:
      type: object
      properties:
        content:
          $ref: '#/components/schemas/InputsOneOf1ItemsOneOf5Content'
        id:
          type: string
        phase:
          $ref: '#/components/schemas/OutputMessagePhase'
          description: >-
            The phase of an assistant message. Use `commentary` for an
            intermediate assistant message and `final_answer` for the final
            assistant message. For follow-up requests with models like
            `gpt-5.3-codex` and later, preserve and resend phase on all
            assistant messages. Omitting it can degrade performance. Not used
            for user messages.
        role:
          $ref: '#/components/schemas/OutputMessageRole'
        status:
          $ref: '#/components/schemas/OutputMessageStatus'
        type:
          $ref: '#/components/schemas/OutputMessageType'
      required:
        - content
        - id
        - role
        - type
      description: An output message item
      title: InputsOneOf1Items5
    InputsOneOf1Items6:
      type: object
      properties:
        content:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/ReasoningTextContent'
        encrypted_content:
          type:
            - string
            - 'null'
        id:
          type: string
        status:
          $ref: '#/components/schemas/OutputItemReasoningStatus'
        summary:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/ReasoningSummaryText'
        type:
          $ref: '#/components/schemas/OutputItemReasoningType'
        format:
          $ref: '#/components/schemas/ReasoningFormat'
        signature:
          type:
            - string
            - 'null'
          description: A signature for the reasoning content, used for verification
      required:
        - id
        - summary
        - type
      description: An output item containing reasoning
      title: InputsOneOf1Items6
    OutputItemFunctionCallStatus0:
      type: string
      enum:
        - completed
      title: OutputItemFunctionCallStatus0
    OutputItemFunctionCallStatus1:
      type: string
      enum:
        - incomplete
      title: OutputItemFunctionCallStatus1
    OutputItemFunctionCallStatus2:
      type: string
      enum:
        - in_progress
      title: OutputItemFunctionCallStatus2
    OutputItemFunctionCallStatus:
      oneOf:
        - $ref: '#/components/schemas/OutputItemFunctionCallStatus0'
        - $ref: '#/components/schemas/OutputItemFunctionCallStatus1'
        - $ref: '#/components/schemas/OutputItemFunctionCallStatus2'
      title: OutputItemFunctionCallStatus
    OutputItemFunctionCallType:
      type: string
      enum:
        - function_call
      title: OutputItemFunctionCallType
    OutputFunctionCallItem:
      type: object
      properties:
        arguments:
          type: string
        call_id:
          type: string
        id:
          type: string
        name:
          type: string
        status:
          $ref: '#/components/schemas/OutputItemFunctionCallStatus'
        type:
          $ref: '#/components/schemas/OutputItemFunctionCallType'
      required:
        - arguments
        - call_id
        - name
        - type
      title: OutputFunctionCallItem
    WebSearchSourceType:
      type: string
      enum:
        - url
      title: WebSearchSourceType
    WebSearchSource:
      type: object
      properties:
        type:
          $ref: '#/components/schemas/WebSearchSourceType'
        url:
          type: string
      required:
        - type
        - url
      title: WebSearchSource
    OutputItemWebSearchCallActionOneOf0Type:
      type: string
      enum:
        - search
      title: OutputItemWebSearchCallActionOneOf0Type
    OutputItemWebSearchCallAction0:
      type: object
      properties:
        queries:
          type: array
          items:
            type: string
        query:
          type: string
        sources:
          type: array
          items:
            $ref: '#/components/schemas/WebSearchSource'
        type:
          $ref: '#/components/schemas/OutputItemWebSearchCallActionOneOf0Type'
      required:
        - query
        - type
      title: OutputItemWebSearchCallAction0
    OutputItemWebSearchCallActionOneOf1Type:
      type: string
      enum:
        - open_page
      title: OutputItemWebSearchCallActionOneOf1Type
    OutputItemWebSearchCallAction1:
      type: object
      properties:
        type:
          $ref: '#/components/schemas/OutputItemWebSearchCallActionOneOf1Type'
        url:
          type:
            - string
            - 'null'
      required:
        - type
      title: OutputItemWebSearchCallAction1
    OutputItemWebSearchCallActionOneOf2Type:
      type: string
      enum:
        - find_in_page
      title: OutputItemWebSearchCallActionOneOf2Type
    OutputItemWebSearchCallAction2:
      type: object
      properties:
        pattern:
          type: string
        type:
          $ref: '#/components/schemas/OutputItemWebSearchCallActionOneOf2Type'
        url:
          type: string
      required:
        - pattern
        - type
        - url
      title: OutputItemWebSearchCallAction2
    OutputItemWebSearchCallAction:
      oneOf:
        - $ref: '#/components/schemas/OutputItemWebSearchCallAction0'
        - $ref: '#/components/schemas/OutputItemWebSearchCallAction1'
        - $ref: '#/components/schemas/OutputItemWebSearchCallAction2'
      title: OutputItemWebSearchCallAction
    WebSearchStatus:
      type: string
      enum:
        - completed
        - searching
        - in_progress
        - failed
      title: WebSearchStatus
    OutputItemWebSearchCallType:
      type: string
      enum:
        - web_search_call
      title: OutputItemWebSearchCallType
    OutputWebSearchCallItem:
      type: object
      properties:
        action:
          $ref: '#/components/schemas/OutputItemWebSearchCallAction'
        id:
          type: string
        status:
          $ref: '#/components/schemas/WebSearchStatus'
        type:
          $ref: '#/components/schemas/OutputItemWebSearchCallType'
      required:
        - action
        - id
        - status
        - type
      title: OutputWebSearchCallItem
    OutputItemFileSearchCallType:
      type: string
      enum:
        - file_search_call
      title: OutputItemFileSearchCallType
    OutputFileSearchCallItem:
      type: object
      properties:
        id:
          type: string
        queries:
          type: array
          items:
            type: string
        status:
          $ref: '#/components/schemas/WebSearchStatus'
        type:
          $ref: '#/components/schemas/OutputItemFileSearchCallType'
      required:
        - id
        - queries
        - status
        - type
      title: OutputFileSearchCallItem
    ImageGenerationStatus:
      type: string
      enum:
        - in_progress
        - completed
        - generating
        - failed
      title: ImageGenerationStatus
    OutputItemImageGenerationCallType:
      type: string
      enum:
        - image_generation_call
      title: OutputItemImageGenerationCallType
    OutputImageGenerationCallItem:
      type: object
      properties:
        id:
          type: string
        result:
          type:
            - string
            - 'null'
        status:
          $ref: '#/components/schemas/ImageGenerationStatus'
        type:
          $ref: '#/components/schemas/OutputItemImageGenerationCallType'
      required:
        - id
        - status
        - type
      title: OutputImageGenerationCallItem
    OutputDatetimeItemType:
      type: string
      enum:
        - openrouter:datetime
      title: OutputDatetimeItemType
    OutputDatetimeItem:
      type: object
      properties:
        datetime:
          type: string
          description: ISO 8601 datetime string
        id:
          type: string
        status:
          $ref: '#/components/schemas/ToolCallStatus'
        timezone:
          type: string
          description: IANA timezone name
        type:
          $ref: '#/components/schemas/OutputDatetimeItemType'
      required:
        - datetime
        - status
        - timezone
        - type
      description: An openrouter:datetime server tool output item
      title: OutputDatetimeItem
    OutputWebSearchServerToolItemType:
      type: string
      enum:
        - openrouter:web_search
      title: OutputWebSearchServerToolItemType
    OutputWebSearchServerToolItem:
      type: object
      properties:
        id:
          type: string
        status:
          $ref: '#/components/schemas/ToolCallStatus'
        type:
          $ref: '#/components/schemas/OutputWebSearchServerToolItemType'
      required:
        - status
        - type
      description: An openrouter:web_search server tool output item
      title: OutputWebSearchServerToolItem
    InputsOneOf1Items:
      oneOf:
        - $ref: '#/components/schemas/ReasoningItem'
        - $ref: '#/components/schemas/EasyInputMessage'
        - $ref: '#/components/schemas/InputMessageItem'
        - $ref: '#/components/schemas/FunctionCallItem'
        - $ref: '#/components/schemas/FunctionCallOutputItem'
        - $ref: '#/components/schemas/InputsOneOf1Items5'
        - $ref: '#/components/schemas/InputsOneOf1Items6'
        - $ref: '#/components/schemas/OutputFunctionCallItem'
        - $ref: '#/components/schemas/OutputWebSearchCallItem'
        - $ref: '#/components/schemas/OutputFileSearchCallItem'
        - $ref: '#/components/schemas/OutputImageGenerationCallItem'
        - $ref: '#/components/schemas/OutputDatetimeItem'
        - $ref: '#/components/schemas/OutputWebSearchServerToolItem'
      title: InputsOneOf1Items
    Inputs1:
      type: array
      items:
        $ref: '#/components/schemas/InputsOneOf1Items'
      title: Inputs1
    Inputs:
      oneOf:
        - type: string
        - $ref: '#/components/schemas/Inputs1'
      description: Input for a response request - can be a string or array of items
      title: Inputs
    RequestMetadata:
      type: object
      additionalProperties:
        type: string
      description: >-
        Metadata key-value pairs for the request. Keys must be ≤64 characters
        and cannot contain brackets. Values must be ≤512 characters. Maximum 16
        pairs allowed.
      title: RequestMetadata
    OutputModalityEnum:
      type: string
      enum:
        - text
        - image
      title: OutputModalityEnum
    AutoRouterPluginId:
      type: string
      enum:
        - auto-router
      title: AutoRouterPluginId
    AutoRouterPlugin:
      type: object
      properties:
        allowed_models:
          type: array
          items:
            type: string
          description: >-
            List of model patterns to filter which models the auto-router can
            route between. Supports wildcards (e.g., "anthropic/*" matches all
            Anthropic models). When not specified, uses the default supported
            models list.
        enabled:
          type: boolean
          description: >-
            Set to false to disable the auto-router plugin for this request.
            Defaults to true.
        id:
          $ref: '#/components/schemas/AutoRouterPluginId'
      required:
        - id
      title: AutoRouterPlugin
    ModerationPluginId:
      type: string
      enum:
        - moderation
      title: ModerationPluginId
    ModerationPlugin:
      type: object
      properties:
        id:
          $ref: '#/components/schemas/ModerationPluginId'
      required:
        - id
      title: ModerationPlugin
    WebSearchEngine:
      type: string
      enum:
        - native
        - exa
        - firecrawl
        - parallel
      description: The search engine to use for web search.
      title: WebSearchEngine
    WebSearchPluginId:
      type: string
      enum:
        - web
      title: WebSearchPluginId
    WebSearchPlugin:
      type: object
      properties:
        enabled:
          type: boolean
          description: >-
            Set to false to disable the web-search plugin for this request.
            Defaults to true.
        engine:
          $ref: '#/components/schemas/WebSearchEngine'
        exclude_domains:
          type: array
          items:
            type: string
          description: >-
            A list of domains to exclude from web search results. Supports
            wildcards (e.g. "*.substack.com") and path filtering (e.g.
            "openai.com/blog").
        id:
          $ref: '#/components/schemas/WebSearchPluginId'
        include_domains:
          type: array
          items:
            type: string
          description: >-
            A list of domains to restrict web search results to. Supports
            wildcards (e.g. "*.substack.com") and path filtering (e.g.
            "openai.com/blog").
        max_results:
          type: integer
        search_prompt:
          type: string
      required:
        - id
      title: WebSearchPlugin
    FileParserPluginId:
      type: string
      enum:
        - file-parser
      title: FileParserPluginId
    PdfParserEngine0:
      type: string
      enum:
        - mistral-ocr
        - native
        - cloudflare-ai
      title: PdfParserEngine0
    PdfParserEngine1:
      type: string
      enum:
        - pdf-text
      title: PdfParserEngine1
    PDFParserEngine:
      oneOf:
        - $ref: '#/components/schemas/PdfParserEngine0'
        - $ref: '#/components/schemas/PdfParserEngine1'
      description: >-
        The engine to use for parsing PDF files. "pdf-text" is deprecated and
        automatically redirected to "cloudflare-ai".
      title: PDFParserEngine
    PDFParserOptions:
      type: object
      properties:
        engine:
          $ref: '#/components/schemas/PDFParserEngine'
      description: Options for PDF parsing.
      title: PDFParserOptions
    FileParserPlugin:
      type: object
      properties:
        enabled:
          type: boolean
          description: >-
            Set to false to disable the file-parser plugin for this request.
            Defaults to true.
        id:
          $ref: '#/components/schemas/FileParserPluginId'
        pdf:
          $ref: '#/components/schemas/PDFParserOptions'
      required:
        - id
      title: FileParserPlugin
    ResponseHealingPluginId:
      type: string
      enum:
        - response-healing
      title: ResponseHealingPluginId
    ResponseHealingPlugin:
      type: object
      properties:
        enabled:
          type: boolean
          description: >-
            Set to false to disable the response-healing plugin for this
            request. Defaults to true.
        id:
          $ref: '#/components/schemas/ResponseHealingPluginId'
      required:
        - id
      title: ResponseHealingPlugin
    ContextCompressionEngine:
      type: string
      enum:
        - middle-out
      description: The compression engine to use. Defaults to "middle-out".
      title: ContextCompressionEngine
    ContextCompressionPluginId:
      type: string
      enum:
        - context-compression
      title: ContextCompressionPluginId
    ContextCompressionPlugin:
      type: object
      properties:
        enabled:
          type: boolean
          description: >-
            Set to false to disable the context-compression plugin for this
            request. Defaults to true.
        engine:
          $ref: '#/components/schemas/ContextCompressionEngine'
        id:
          $ref: '#/components/schemas/ContextCompressionPluginId'
      required:
        - id
      title: ContextCompressionPlugin
    ResponsesRequestPluginsItems:
      oneOf:
        - $ref: '#/components/schemas/AutoRouterPlugin'
        - $ref: '#/components/schemas/ModerationPlugin'
        - $ref: '#/components/schemas/WebSearchPlugin'
        - $ref: '#/components/schemas/FileParserPlugin'
        - $ref: '#/components/schemas/ResponseHealingPlugin'
        - $ref: '#/components/schemas/ContextCompressionPlugin'
      title: ResponsesRequestPluginsItems
    StoredPromptTemplateVariables:
      oneOf:
        - type: string
        - $ref: '#/components/schemas/InputText'
        - $ref: '#/components/schemas/InputImage'
        - $ref: '#/components/schemas/InputFile'
      title: StoredPromptTemplateVariables
    StoredPromptTemplate:
      type: object
      properties:
        id:
          type: string
        variables:
          type:
            - object
            - 'null'
          additionalProperties:
            $ref: '#/components/schemas/StoredPromptTemplateVariables'
      required:
        - id
      title: StoredPromptTemplate
    ProviderPreferencesDataCollection:
      type: string
      enum:
        - deny
        - allow
      description: >-
        Data collection setting. If no available model provider meets the
        requirement, your request will return an error.

        - allow: (default) allow providers which store user data non-transiently
        and may train on it


        - deny: use only providers which do not collect user data.
      title: ProviderPreferencesDataCollection
    ProviderName:
      type: string
      enum:
        - AkashML
        - AI21
        - AionLabs
        - Alibaba
        - Ambient
        - Baidu
        - Amazon Bedrock
        - Amazon Nova
        - Anthropic
        - Arcee AI
        - AtlasCloud
        - Avian
        - Azure
        - BaseTen
        - BytePlus
        - Black Forest Labs
        - Cerebras
        - Chutes
        - Cirrascale
        - Clarifai
        - Cloudflare
        - Cohere
        - Crusoe
        - DeepInfra
        - DeepSeek
        - DekaLLM
        - Featherless
        - Fireworks
        - Friendli
        - GMICloud
        - Google
        - Google AI Studio
        - Groq
        - Hyperbolic
        - Inception
        - Inceptron
        - InferenceNet
        - Ionstream
        - Infermatic
        - Io Net
        - Inflection
        - Liquid
        - Mara
        - Mancer 2
        - Minimax
        - ModelRun
        - Mistral
        - Modular
        - Moonshot AI
        - Morph
        - NCompass
        - Nebius
        - NextBit
        - Novita
        - Nvidia
        - OpenAI
        - OpenInference
        - Parasail
        - Perplexity
        - Phala
        - Recraft
        - Reka
        - Relace
        - SambaNova
        - Seed
        - SiliconFlow
        - Sourceful
        - StepFun
        - Stealth
        - StreamLake
        - Switchpoint
        - Together
        - Upstage
        - Venice
        - WandB
        - Xiaomi
        - xAI
        - Z.AI
        - FakeProvider
      title: ProviderName
    ProviderPreferencesIgnoreItems:
      oneOf:
        - $ref: '#/components/schemas/ProviderName'
        - type: string
      title: ProviderPreferencesIgnoreItems
    ProviderPreferencesMaxPriceAudio:
      type: object
      properties: {}
      title: ProviderPreferencesMaxPriceAudio
    ProviderPreferencesMaxPriceCompletion:
      type: object
      properties: {}
      title: ProviderPreferencesMaxPriceCompletion
    ProviderPreferencesMaxPriceImage:
      type: object
      properties: {}
      title: ProviderPreferencesMaxPriceImage
    BigNumberUnion:
      type: string
      description: Price per million prompt tokens
      title: BigNumberUnion
    ProviderPreferencesMaxPriceRequest:
      type: object
      properties: {}
      title: ProviderPreferencesMaxPriceRequest
    ProviderPreferencesMaxPrice:
      type: object
      properties:
        audio:
          $ref: '#/components/schemas/ProviderPreferencesMaxPriceAudio'
        completion:
          $ref: '#/components/schemas/ProviderPreferencesMaxPriceCompletion'
        image:
          $ref: '#/components/schemas/ProviderPreferencesMaxPriceImage'
        prompt:
          $ref: '#/components/schemas/BigNumberUnion'
        request:
          $ref: '#/components/schemas/ProviderPreferencesMaxPriceRequest'
      description: >-
        The object specifying the maximum price you want to pay for this
        request. USD price per million tokens, for prompt and completion.
      title: ProviderPreferencesMaxPrice
    ProviderPreferencesOnlyItems:
      oneOf:
        - $ref: '#/components/schemas/ProviderName'
        - type: string
      title: ProviderPreferencesOnlyItems
    ProviderPreferencesOrderItems:
      oneOf:
        - $ref: '#/components/schemas/ProviderName'
        - type: string
      title: ProviderPreferencesOrderItems
    PercentileLatencyCutoffs:
      type: object
      properties:
        p50:
          type:
            - number
            - 'null'
          format: double
          description: Maximum p50 latency (seconds)
        p75:
          type:
            - number
            - 'null'
          format: double
          description: Maximum p75 latency (seconds)
        p90:
          type:
            - number
            - 'null'
          format: double
          description: Maximum p90 latency (seconds)
        p99:
          type:
            - number
            - 'null'
          format: double
          description: Maximum p99 latency (seconds)
      description: >-
        Percentile-based latency cutoffs. All specified cutoffs must be met for
        an endpoint to be preferred.
      title: PercentileLatencyCutoffs
    PreferredMaxLatency:
      oneOf:
        - type: number
          format: double
        - $ref: '#/components/schemas/PercentileLatencyCutoffs'
        - description: Any type
      description: >-
        Preferred maximum latency (in seconds). Can be a number (applies to p50)
        or an object with percentile-specific cutoffs. Endpoints above the
        threshold(s) may still be used, but are deprioritized in routing. When
        using fallback models, this may cause a fallback model to be used
        instead of the primary model if it meets the threshold.
      title: PreferredMaxLatency
    PercentileThroughputCutoffs:
      type: object
      properties:
        p50:
          type:
            - number
            - 'null'
          format: double
          description: Minimum p50 throughput (tokens/sec)
        p75:
          type:
            - number
            - 'null'
          format: double
          description: Minimum p75 throughput (tokens/sec)
        p90:
          type:
            - number
            - 'null'
          format: double
          description: Minimum p90 throughput (tokens/sec)
        p99:
          type:
            - number
            - 'null'
          format: double
          description: Minimum p99 throughput (tokens/sec)
      description: >-
        Percentile-based throughput cutoffs. All specified cutoffs must be met
        for an endpoint to be preferred.
      title: PercentileThroughputCutoffs
    PreferredMinThroughput:
      oneOf:
        - type: number
          format: double
        - $ref: '#/components/schemas/PercentileThroughputCutoffs'
        - description: Any type
      description: >-
        Preferred minimum throughput (in tokens per second). Can be a number
        (applies to p50) or an object with percentile-specific cutoffs.
        Endpoints below the threshold(s) may still be used, but are
        deprioritized in routing. When using fallback models, this may cause a
        fallback model to be used instead of the primary model if it meets the
        threshold.
      title: PreferredMinThroughput
    Quantization:
      type: string
      enum:
        - int4
        - int8
        - fp4
        - fp6
        - fp8
        - fp16
        - bf16
        - fp32
        - unknown
      title: Quantization
    ProviderSort:
      type: string
      enum:
        - price
        - throughput
        - latency
        - exacto
      description: The provider sorting strategy (price, throughput, latency)
      title: ProviderSort
    ProviderSortConfigBy:
      type: string
      enum:
        - price
        - throughput
        - latency
        - exacto
      description: The provider sorting strategy (price, throughput, latency)
      title: ProviderSortConfigBy
    ProviderSortConfigPartition:
      type: string
      enum:
        - model
        - none
      description: >-
        Partitioning strategy for sorting: "model" (default) groups endpoints by
        model before sorting (fallback models remain fallbacks), "none" sorts
        all endpoints together regardless of model.
      title: ProviderSortConfigPartition
    ProviderSortConfig:
      type: object
      properties:
        by:
          oneOf:
            - $ref: '#/components/schemas/ProviderSortConfigBy'
            - type: 'null'
          description: The provider sorting strategy (price, throughput, latency)
        partition:
          oneOf:
            - $ref: '#/components/schemas/ProviderSortConfigPartition'
            - type: 'null'
          description: >-
            Partitioning strategy for sorting: "model" (default) groups
            endpoints by model before sorting (fallback models remain
            fallbacks), "none" sorts all endpoints together regardless of model.
      description: The provider sorting strategy (price, throughput, latency)
      title: ProviderSortConfig
    ProviderPreferencesSort:
      oneOf:
        - $ref: '#/components/schemas/ProviderSort'
        - $ref: '#/components/schemas/ProviderSortConfig'
        - description: Any type
      description: >-
        The sorting strategy to use for this request, if "order" is not
        specified. When set, no load balancing is performed.
      title: ProviderPreferencesSort
    ProviderPreferences:
      type: object
      properties:
        allow_fallbacks:
          type:
            - boolean
            - 'null'
          description: >
            Whether to allow backup providers to serve requests

            - true: (default) when the primary provider (or your custom
            providers in "order") is unavailable, use the next best provider.

            - false: use only the primary/custom provider, and return the
            upstream error if it's unavailable.
        data_collection:
          oneOf:
            - $ref: '#/components/schemas/ProviderPreferencesDataCollection'
            - type: 'null'
          description: >-
            Data collection setting. If no available model provider meets the
            requirement, your request will return an error.

            - allow: (default) allow providers which store user data
            non-transiently and may train on it


            - deny: use only providers which do not collect user data.
        enforce_distillable_text:
          type:
            - boolean
            - 'null'
          description: >-
            Whether to restrict routing to only models that allow text
            distillation. When true, only models where the author has allowed
            distillation will be used.
        ignore:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/ProviderPreferencesIgnoreItems'
          description: >-
            List of provider slugs to ignore. If provided, this list is merged
            with your account-wide ignored provider settings for this request.
        max_price:
          $ref: '#/components/schemas/ProviderPreferencesMaxPrice'
          description: >-
            The object specifying the maximum price you want to pay for this
            request. USD price per million tokens, for prompt and completion.
        only:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/ProviderPreferencesOnlyItems'
          description: >-
            List of provider slugs to allow. If provided, this list is merged
            with your account-wide allowed provider settings for this request.
        order:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/ProviderPreferencesOrderItems'
          description: >-
            An ordered list of provider slugs. The router will attempt to use
            the first provider in the subset of this list that supports your
            requested model, and fall back to the next if it is unavailable. If
            no providers are available, the request will fail with an error
            message.
        preferred_max_latency:
          $ref: '#/components/schemas/PreferredMaxLatency'
        preferred_min_throughput:
          $ref: '#/components/schemas/PreferredMinThroughput'
        quantizations:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/Quantization'
          description: A list of quantization levels to filter the provider by.
        require_parameters:
          type:
            - boolean
            - 'null'
          description: >-
            Whether to filter providers to only those that support the
            parameters you've provided. If this setting is omitted or set to
            false, then providers will receive only the parameters they support,
            and ignore the rest.
        sort:
          $ref: '#/components/schemas/ProviderPreferencesSort'
          description: >-
            The sorting strategy to use for this request, if "order" is not
            specified. When set, no load balancing is performed.
        zdr:
          type:
            - boolean
            - 'null'
          description: >-
            Whether to restrict routing to only ZDR (Zero Data Retention)
            endpoints. When true, only endpoints that do not retain prompts will
            be used.
      description: >-
        When multiple model providers are available, optionally indicate your
        routing preference.
      title: ProviderPreferences
    ReasoningEffort:
      type: string
      enum:
        - xhigh
        - high
        - medium
        - low
        - minimal
        - none
      title: ReasoningEffort
    ReasoningSummaryVerbosity:
      type: string
      enum:
        - auto
        - concise
        - detailed
      title: ReasoningSummaryVerbosity
    ReasoningConfig:
      type: object
      properties:
        effort:
          $ref: '#/components/schemas/ReasoningEffort'
        summary:
          $ref: '#/components/schemas/ReasoningSummaryVerbosity'
        enabled:
          type:
            - boolean
            - 'null'
        max_tokens:
          type:
            - integer
            - 'null'
      description: Configuration for reasoning mode in the response
      title: ReasoningConfig
    ResponsesRequestServiceTier:
      type: string
      enum:
        - auto
        - default
        - flex
        - priority
        - scale
      default: auto
      title: ResponsesRequestServiceTier
    FormatTextConfigType:
      type: string
      enum:
        - text
      title: FormatTextConfigType
    FormatTextConfig:
      type: object
      properties:
        type:
          $ref: '#/components/schemas/FormatTextConfigType'
      required:
        - type
      description: Plain text response format
      title: FormatTextConfig
    FormatJsonObjectConfigType:
      type: string
      enum:
        - json_object
      title: FormatJsonObjectConfigType
    FormatJsonObjectConfig:
      type: object
      properties:
        type:
          $ref: '#/components/schemas/FormatJsonObjectConfigType'
      required:
        - type
      description: JSON object response format
      title: FormatJsonObjectConfig
    FormatJsonSchemaConfigType:
      type: string
      enum:
        - json_schema
      title: FormatJsonSchemaConfigType
    FormatJsonSchemaConfig:
      type: object
      properties:
        description:
          type: string
        name:
          type: string
        schema:
          type: object
          additionalProperties:
            description: Any type
        strict:
          type:
            - boolean
            - 'null'
        type:
          $ref: '#/components/schemas/FormatJsonSchemaConfigType'
      required:
        - name
        - schema
        - type
      description: JSON schema constrained response format
      title: FormatJsonSchemaConfig
    Formats:
      oneOf:
        - $ref: '#/components/schemas/FormatTextConfig'
        - $ref: '#/components/schemas/FormatJsonObjectConfig'
        - $ref: '#/components/schemas/FormatJsonSchemaConfig'
      description: Text response format configuration
      title: Formats
    TextConfigVerbosity:
      type: string
      enum:
        - high
        - low
        - medium
      title: TextConfigVerbosity
    TextExtendedConfigVerbosity:
      type: string
      enum:
        - low
        - medium
        - high
        - xhigh
        - max
      title: TextExtendedConfigVerbosity
    TextExtendedConfig:
      type: object
      properties:
        format:
          $ref: '#/components/schemas/Formats'
        verbosity:
          oneOf:
            - $ref: '#/components/schemas/TextExtendedConfigVerbosity'
            - type: 'null'
      description: Text output configuration including format and verbosity
      title: TextExtendedConfig
    OpenAiResponsesToolChoice0:
      type: string
      enum:
        - auto
      title: OpenAiResponsesToolChoice0
    OpenAiResponsesToolChoice1:
      type: string
      enum:
        - none
      title: OpenAiResponsesToolChoice1
    OpenAiResponsesToolChoice2:
      type: string
      enum:
        - required
      title: OpenAiResponsesToolChoice2
    OpenAiResponsesToolChoiceOneOf3Type:
      type: string
      enum:
        - function
      title: OpenAiResponsesToolChoiceOneOf3Type
    OpenAiResponsesToolChoice3:
      type: object
      properties:
        name:
          type: string
        type:
          $ref: '#/components/schemas/OpenAiResponsesToolChoiceOneOf3Type'
      required:
        - name
        - type
      title: OpenAiResponsesToolChoice3
    OpenAiResponsesToolChoiceOneOf4Type0:
      type: string
      enum:
        - web_search_preview_2025_03_11
      title: OpenAiResponsesToolChoiceOneOf4Type0
    OpenAiResponsesToolChoiceOneOf4Type1:
      type: string
      enum:
        - web_search_preview
      title: OpenAiResponsesToolChoiceOneOf4Type1
    OpenAiResponsesToolChoiceOneOf4Type:
      oneOf:
        - $ref: '#/components/schemas/OpenAiResponsesToolChoiceOneOf4Type0'
        - $ref: '#/components/schemas/OpenAiResponsesToolChoiceOneOf4Type1'
      title: OpenAiResponsesToolChoiceOneOf4Type
    OpenAiResponsesToolChoice4:
      type: object
      properties:
        type:
          $ref: '#/components/schemas/OpenAiResponsesToolChoiceOneOf4Type'
      required:
        - type
      title: OpenAiResponsesToolChoice4
    ToolChoiceAllowedMode0:
      type: string
      enum:
        - auto
      title: ToolChoiceAllowedMode0
    ToolChoiceAllowedMode1:
      type: string
      enum:
        - required
      title: ToolChoiceAllowedMode1
    ToolChoiceAllowedMode:
      oneOf:
        - $ref: '#/components/schemas/ToolChoiceAllowedMode0'
        - $ref: '#/components/schemas/ToolChoiceAllowedMode1'
      title: ToolChoiceAllowedMode
    ToolChoiceAllowedType:
      type: string
      enum:
        - allowed_tools
      title: ToolChoiceAllowedType
    ToolChoiceAllowed:
      type: object
      properties:
        mode:
          $ref: '#/components/schemas/ToolChoiceAllowedMode'
        tools:
          type: array
          items:
            type: object
            additionalProperties:
              description: Any type
        type:
          $ref: '#/components/schemas/ToolChoiceAllowedType'
      required:
        - mode
        - tools
        - type
      description: Constrains the model to a pre-defined set of allowed tools
      title: ToolChoiceAllowed
    OpenAIResponsesToolChoice:
      oneOf:
        - $ref: '#/components/schemas/OpenAiResponsesToolChoice0'
        - $ref: '#/components/schemas/OpenAiResponsesToolChoice1'
        - $ref: '#/components/schemas/OpenAiResponsesToolChoice2'
        - $ref: '#/components/schemas/OpenAiResponsesToolChoice3'
        - $ref: '#/components/schemas/OpenAiResponsesToolChoice4'
        - $ref: '#/components/schemas/ToolChoiceAllowed'
      title: OpenAIResponsesToolChoice
    FunctionToolType:
      type: string
      enum:
        - function
      title: FunctionToolType
    ResponsesRequestToolsItems0:
      type: object
      properties:
        description:
          type:
            - string
            - 'null'
        name:
          type: string
        parameters:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
        strict:
          type:
            - boolean
            - 'null'
        type:
          $ref: '#/components/schemas/FunctionToolType'
      required:
        - name
        - parameters
        - type
      description: Function tool definition
      title: ResponsesRequestToolsItems0
    WebSearchEngineEnum:
      type: string
      enum:
        - auto
        - native
        - exa
        - firecrawl
        - parallel
      description: >-
        Which search engine to use. "auto" (default) uses native if the provider
        supports it, otherwise Exa. "native" forces the provider's built-in
        search. "exa" forces the Exa search API. "firecrawl" uses Firecrawl
        (requires BYOK). "parallel" uses the Parallel search API.
      title: WebSearchEngineEnum
    WebSearchDomainFilter:
      type: object
      properties:
        allowed_domains:
          type:
            - array
            - 'null'
          items:
            type: string
        excluded_domains:
          type:
            - array
            - 'null'
          items:
            type: string
      title: WebSearchDomainFilter
    SearchContextSizeEnum:
      type: string
      enum:
        - low
        - medium
        - high
      description: Size of the search context for web search tools
      title: SearchContextSizeEnum
    PreviewWebSearchServerToolType:
      type: string
      enum:
        - web_search_preview
      title: PreviewWebSearchServerToolType
    PreviewWebSearchUserLocationType:
      type: string
      enum:
        - approximate
      title: PreviewWebSearchUserLocationType
    Preview_WebSearchUserLocation:
      type: object
      properties:
        city:
          type:
            - string
            - 'null'
        country:
          type:
            - string
            - 'null'
        region:
          type:
            - string
            - 'null'
        timezone:
          type:
            - string
            - 'null'
        type:
          $ref: '#/components/schemas/PreviewWebSearchUserLocationType'
      required:
        - type
      title: Preview_WebSearchUserLocation
    Preview_WebSearchServerTool:
      type: object
      properties:
        engine:
          $ref: '#/components/schemas/WebSearchEngineEnum'
        filters:
          $ref: '#/components/schemas/WebSearchDomainFilter'
        max_results:
          type: integer
          description: >-
            Maximum number of search results to return per search call. Defaults
            to 5. Applies to Exa, Firecrawl, and Parallel engines; ignored with
            native provider search.
        search_context_size:
          $ref: '#/components/schemas/SearchContextSizeEnum'
        type:
          $ref: '#/components/schemas/PreviewWebSearchServerToolType'
        user_location:
          $ref: '#/components/schemas/Preview_WebSearchUserLocation'
      required:
        - type
      description: Web search preview tool configuration
      title: Preview_WebSearchServerTool
    Preview20250311WebSearchServerToolType:
      type: string
      enum:
        - web_search_preview_2025_03_11
      title: Preview20250311WebSearchServerToolType
    Preview_20250311_WebSearchServerTool:
      type: object
      properties:
        engine:
          $ref: '#/components/schemas/WebSearchEngineEnum'
        filters:
          $ref: '#/components/schemas/WebSearchDomainFilter'
        max_results:
          type: integer
          description: >-
            Maximum number of search results to return per search call. Defaults
            to 5. Applies to Exa, Firecrawl, and Parallel engines; ignored with
            native provider search.
        search_context_size:
          $ref: '#/components/schemas/SearchContextSizeEnum'
        type:
          $ref: '#/components/schemas/Preview20250311WebSearchServerToolType'
        user_location:
          $ref: '#/components/schemas/Preview_WebSearchUserLocation'
      required:
        - type
      description: Web search preview tool configuration (2025-03-11 version)
      title: Preview_20250311_WebSearchServerTool
    LegacyWebSearchServerToolType:
      type: string
      enum:
        - web_search
      title: LegacyWebSearchServerToolType
    WebSearchUserLocationType:
      type: string
      enum:
        - approximate
      title: WebSearchUserLocationType
    WebSearchUserLocation:
      type: object
      properties:
        city:
          type:
            - string
            - 'null'
        country:
          type:
            - string
            - 'null'
        region:
          type:
            - string
            - 'null'
        timezone:
          type:
            - string
            - 'null'
        type:
          $ref: '#/components/schemas/WebSearchUserLocationType'
      description: User location information for web search
      title: WebSearchUserLocation
    Legacy_WebSearchServerTool:
      type: object
      properties:
        engine:
          $ref: '#/components/schemas/WebSearchEngineEnum'
        filters:
          $ref: '#/components/schemas/WebSearchDomainFilter'
        max_results:
          type: integer
          description: >-
            Maximum number of search results to return per search call. Defaults
            to 5. Applies to Exa, Firecrawl, and Parallel engines; ignored with
            native provider search.
        search_context_size:
          $ref: '#/components/schemas/SearchContextSizeEnum'
        type:
          $ref: '#/components/schemas/LegacyWebSearchServerToolType'
        user_location:
          $ref: '#/components/schemas/WebSearchUserLocation'
      required:
        - type
      description: Web search tool configuration
      title: Legacy_WebSearchServerTool
    WebSearchServerToolType:
      type: string
      enum:
        - web_search_2025_08_26
      title: WebSearchServerToolType
    WebSearchServerTool:
      type: object
      properties:
        engine:
          $ref: '#/components/schemas/WebSearchEngineEnum'
        filters:
          $ref: '#/components/schemas/WebSearchDomainFilter'
        max_results:
          type: integer
          description: >-
            Maximum number of search results to return per search call. Defaults
            to 5. Applies to Exa, Firecrawl, and Parallel engines; ignored with
            native provider search.
        search_context_size:
          $ref: '#/components/schemas/SearchContextSizeEnum'
        type:
          $ref: '#/components/schemas/WebSearchServerToolType'
        user_location:
          $ref: '#/components/schemas/WebSearchUserLocation'
      required:
        - type
      description: Web search tool configuration (2025-08-26 version)
      title: WebSearchServerTool
    FileSearchServerToolFiltersOneOf0Type:
      type: string
      enum:
        - eq
        - ne
        - gt
        - gte
        - lt
        - lte
      title: FileSearchServerToolFiltersOneOf0Type
    FileSearchServerToolFiltersOneOf0ValueOneOf3Items:
      oneOf:
        - type: string
        - type: number
          format: double
      title: FileSearchServerToolFiltersOneOf0ValueOneOf3Items
    FileSearchServerToolFiltersOneOf0Value3:
      type: array
      items:
        $ref: '#/components/schemas/FileSearchServerToolFiltersOneOf0ValueOneOf3Items'
      title: FileSearchServerToolFiltersOneOf0Value3
    FileSearchServerToolFiltersOneOf0Value:
      oneOf:
        - type: string
        - type: number
          format: double
        - type: boolean
        - $ref: '#/components/schemas/FileSearchServerToolFiltersOneOf0Value3'
      title: FileSearchServerToolFiltersOneOf0Value
    FileSearchServerToolFilters0:
      type: object
      properties:
        key:
          type: string
        type:
          $ref: '#/components/schemas/FileSearchServerToolFiltersOneOf0Type'
        value:
          $ref: '#/components/schemas/FileSearchServerToolFiltersOneOf0Value'
      required:
        - key
        - type
        - value
      title: FileSearchServerToolFilters0
    CompoundFilterType:
      type: string
      enum:
        - and
        - or
      title: CompoundFilterType
    CompoundFilter:
      type: object
      properties:
        filters:
          type: array
          items:
            type: object
            additionalProperties:
              description: Any type
        type:
          $ref: '#/components/schemas/CompoundFilterType'
      required:
        - filters
        - type
      description: A compound filter that combines multiple comparison or compound filters
      title: CompoundFilter
    FileSearchServerToolFilters:
      oneOf:
        - $ref: '#/components/schemas/FileSearchServerToolFilters0'
        - $ref: '#/components/schemas/CompoundFilter'
        - description: Any type
      title: FileSearchServerToolFilters
    FileSearchServerToolRankingOptionsRanker:
      type: string
      enum:
        - auto
        - default-2024-11-15
      title: FileSearchServerToolRankingOptionsRanker
    FileSearchServerToolRankingOptions:
      type: object
      properties:
        ranker:
          $ref: '#/components/schemas/FileSearchServerToolRankingOptionsRanker'
        score_threshold:
          type: number
          format: double
      title: FileSearchServerToolRankingOptions
    FileSearchServerToolType:
      type: string
      enum:
        - file_search
      title: FileSearchServerToolType
    FileSearchServerTool:
      type: object
      properties:
        filters:
          $ref: '#/components/schemas/FileSearchServerToolFilters'
        max_num_results:
          type: integer
        ranking_options:
          $ref: '#/components/schemas/FileSearchServerToolRankingOptions'
        type:
          $ref: '#/components/schemas/FileSearchServerToolType'
        vector_store_ids:
          type: array
          items:
            type: string
      required:
        - type
        - vector_store_ids
      description: File search tool configuration
      title: FileSearchServerTool
    ComputerUseServerToolEnvironment:
      type: string
      enum:
        - windows
        - mac
        - linux
        - ubuntu
        - browser
      title: ComputerUseServerToolEnvironment
    ComputerUseServerToolType:
      type: string
      enum:
        - computer_use_preview
      title: ComputerUseServerToolType
    ComputerUseServerTool:
      type: object
      properties:
        display_height:
          type: integer
        display_width:
          type: integer
        environment:
          $ref: '#/components/schemas/ComputerUseServerToolEnvironment'
        type:
          $ref: '#/components/schemas/ComputerUseServerToolType'
      required:
        - display_height
        - display_width
        - environment
        - type
      description: Computer use preview tool configuration
      title: ComputerUseServerTool
    CodeInterpreterServerToolContainerOneOf1MemoryLimit:
      type: string
      enum:
        - 1g
        - 4g
        - 16g
        - 64g
      title: CodeInterpreterServerToolContainerOneOf1MemoryLimit
    CodeInterpreterServerToolContainerOneOf1Type:
      type: string
      enum:
        - auto
      title: CodeInterpreterServerToolContainerOneOf1Type
    CodeInterpreterServerToolContainer1:
      type: object
      properties:
        file_ids:
          type: array
          items:
            type: string
        memory_limit:
          oneOf:
            - $ref: >-
                #/components/schemas/CodeInterpreterServerToolContainerOneOf1MemoryLimit
            - type: 'null'
        type:
          $ref: '#/components/schemas/CodeInterpreterServerToolContainerOneOf1Type'
      required:
        - type
      title: CodeInterpreterServerToolContainer1
    CodeInterpreterServerToolContainer:
      oneOf:
        - type: string
        - $ref: '#/components/schemas/CodeInterpreterServerToolContainer1'
      title: CodeInterpreterServerToolContainer
    CodeInterpreterServerToolType:
      type: string
      enum:
        - code_interpreter
      title: CodeInterpreterServerToolType
    CodeInterpreterServerTool:
      type: object
      properties:
        container:
          $ref: '#/components/schemas/CodeInterpreterServerToolContainer'
        type:
          $ref: '#/components/schemas/CodeInterpreterServerToolType'
      required:
        - container
        - type
      description: Code interpreter tool configuration
      title: CodeInterpreterServerTool
    McpServerToolAllowedTools1:
      type: object
      properties:
        read_only:
          type: boolean
        tool_names:
          type: array
          items:
            type: string
      title: McpServerToolAllowedTools1
    McpServerToolAllowedTools:
      oneOf:
        - type: array
          items:
            type: string
        - $ref: '#/components/schemas/McpServerToolAllowedTools1'
        - description: Any type
      title: McpServerToolAllowedTools
    McpServerToolConnectorId:
      type: string
      enum:
        - connector_dropbox
        - connector_gmail
        - connector_googlecalendar
        - connector_googledrive
        - connector_microsoftteams
        - connector_outlookcalendar
        - connector_outlookemail
        - connector_sharepoint
      title: McpServerToolConnectorId
    McpServerToolRequireApprovalOneOf0Always:
      type: object
      properties:
        tool_names:
          type: array
          items:
            type: string
      title: McpServerToolRequireApprovalOneOf0Always
    McpServerToolRequireApprovalOneOf0Never:
      type: object
      properties:
        tool_names:
          type: array
          items:
            type: string
      title: McpServerToolRequireApprovalOneOf0Never
    McpServerToolRequireApproval0:
      type: object
      properties:
        always:
          $ref: '#/components/schemas/McpServerToolRequireApprovalOneOf0Always'
        never:
          $ref: '#/components/schemas/McpServerToolRequireApprovalOneOf0Never'
      title: McpServerToolRequireApproval0
    McpServerToolRequireApproval1:
      type: string
      enum:
        - always
      title: McpServerToolRequireApproval1
    McpServerToolRequireApproval2:
      type: string
      enum:
        - never
      title: McpServerToolRequireApproval2
    McpServerToolRequireApproval:
      oneOf:
        - $ref: '#/components/schemas/McpServerToolRequireApproval0'
        - $ref: '#/components/schemas/McpServerToolRequireApproval1'
        - $ref: '#/components/schemas/McpServerToolRequireApproval2'
        - description: Any type
      title: McpServerToolRequireApproval
    McpServerToolType:
      type: string
      enum:
        - mcp
      title: McpServerToolType
    McpServerTool:
      type: object
      properties:
        allowed_tools:
          $ref: '#/components/schemas/McpServerToolAllowedTools'
        authorization:
          type: string
        connector_id:
          $ref: '#/components/schemas/McpServerToolConnectorId'
        headers:
          type:
            - object
            - 'null'
          additionalProperties:
            type: string
        require_approval:
          $ref: '#/components/schemas/McpServerToolRequireApproval'
        server_description:
          type: string
        server_label:
          type: string
        server_url:
          type: string
        type:
          $ref: '#/components/schemas/McpServerToolType'
      required:
        - server_label
        - type
      description: MCP (Model Context Protocol) tool configuration
      title: McpServerTool
    ImageGenerationServerToolBackground:
      type: string
      enum:
        - transparent
        - opaque
        - auto
      title: ImageGenerationServerToolBackground
    ImageGenerationServerToolInputFidelity:
      type: string
      enum:
        - high
        - low
      title: ImageGenerationServerToolInputFidelity
    ImageGenerationServerToolInputImageMask:
      type: object
      properties:
        file_id:
          type: string
        image_url:
          type: string
      title: ImageGenerationServerToolInputImageMask
    ImageGenerationServerToolModel:
      type: string
      enum:
        - gpt-image-1
        - gpt-image-1-mini
      title: ImageGenerationServerToolModel
    ImageGenerationServerToolModeration:
      type: string
      enum:
        - auto
        - low
      title: ImageGenerationServerToolModeration
    ImageGenerationServerToolOutputFormat:
      type: string
      enum:
        - png
        - webp
        - jpeg
      title: ImageGenerationServerToolOutputFormat
    ImageGenerationServerToolQuality:
      type: string
      enum:
        - low
        - medium
        - high
        - auto
      title: ImageGenerationServerToolQuality
    ImageGenerationServerToolSize:
      type: string
      enum:
        - 1024x1024
        - 1024x1536
        - 1536x1024
        - auto
      title: ImageGenerationServerToolSize
    ImageGenerationServerToolType:
      type: string
      enum:
        - image_generation
      title: ImageGenerationServerToolType
    ImageGenerationServerTool:
      type: object
      properties:
        background:
          $ref: '#/components/schemas/ImageGenerationServerToolBackground'
        input_fidelity:
          oneOf:
            - $ref: '#/components/schemas/ImageGenerationServerToolInputFidelity'
            - type: 'null'
        input_image_mask:
          $ref: '#/components/schemas/ImageGenerationServerToolInputImageMask'
        model:
          $ref: '#/components/schemas/ImageGenerationServerToolModel'
        moderation:
          $ref: '#/components/schemas/ImageGenerationServerToolModeration'
        output_compression:
          type: integer
        output_format:
          $ref: '#/components/schemas/ImageGenerationServerToolOutputFormat'
        partial_images:
          type: integer
        quality:
          $ref: '#/components/schemas/ImageGenerationServerToolQuality'
        size:
          $ref: '#/components/schemas/ImageGenerationServerToolSize'
        type:
          $ref: '#/components/schemas/ImageGenerationServerToolType'
      required:
        - type
      description: Image generation tool configuration
      title: ImageGenerationServerTool
    CodexLocalShellToolType:
      type: string
      enum:
        - local_shell
      title: CodexLocalShellToolType
    CodexLocalShellTool:
      type: object
      properties:
        type:
          $ref: '#/components/schemas/CodexLocalShellToolType'
      required:
        - type
      description: Local shell tool configuration
      title: CodexLocalShellTool
    ShellServerToolType:
      type: string
      enum:
        - shell
      title: ShellServerToolType
    ShellServerTool:
      type: object
      properties:
        type:
          $ref: '#/components/schemas/ShellServerToolType'
      required:
        - type
      description: Shell tool configuration
      title: ShellServerTool
    ApplyPatchServerToolType:
      type: string
      enum:
        - apply_patch
      title: ApplyPatchServerToolType
    ApplyPatchServerTool:
      type: object
      properties:
        type:
          $ref: '#/components/schemas/ApplyPatchServerToolType'
      required:
        - type
      description: Apply patch tool configuration
      title: ApplyPatchServerTool
    CustomToolFormatOneOf0Type:
      type: string
      enum:
        - text
      title: CustomToolFormatOneOf0Type
    CustomToolFormat0:
      type: object
      properties:
        type:
          $ref: '#/components/schemas/CustomToolFormatOneOf0Type'
      required:
        - type
      title: CustomToolFormat0
    CustomToolFormatOneOf1Syntax:
      type: string
      enum:
        - lark
        - regex
      title: CustomToolFormatOneOf1Syntax
    CustomToolFormatOneOf1Type:
      type: string
      enum:
        - grammar
      title: CustomToolFormatOneOf1Type
    CustomToolFormat1:
      type: object
      properties:
        definition:
          type: string
        syntax:
          $ref: '#/components/schemas/CustomToolFormatOneOf1Syntax'
        type:
          $ref: '#/components/schemas/CustomToolFormatOneOf1Type'
      required:
        - definition
        - syntax
        - type
      title: CustomToolFormat1
    CustomToolFormat:
      oneOf:
        - $ref: '#/components/schemas/CustomToolFormat0'
        - $ref: '#/components/schemas/CustomToolFormat1'
      title: CustomToolFormat
    CustomToolType:
      type: string
      enum:
        - custom
      title: CustomToolType
    CustomTool:
      type: object
      properties:
        description:
          type: string
        format:
          $ref: '#/components/schemas/CustomToolFormat'
        name:
          type: string
        type:
          $ref: '#/components/schemas/CustomToolType'
      required:
        - name
        - type
      description: Custom tool configuration
      title: CustomTool
    DatetimeServerToolConfig:
      type: object
      properties:
        timezone:
          type: string
          description: IANA timezone name (e.g. "America/New_York"). Defaults to UTC.
      description: Configuration for the openrouter:datetime server tool
      title: DatetimeServerToolConfig
    DatetimeServerToolType:
      type: string
      enum:
        - openrouter:datetime
      title: DatetimeServerToolType
    DatetimeServerTool:
      type: object
      properties:
        parameters:
          $ref: '#/components/schemas/DatetimeServerToolConfig'
        type:
          $ref: '#/components/schemas/DatetimeServerToolType'
      required:
        - type
      description: 'OpenRouter built-in server tool: returns the current date and time'
      title: DatetimeServerTool
    ImageGenerationServerToolConfig:
      type: object
      properties:
        model:
          type: string
          description: >-
            Which image generation model to use (e.g. "openai/gpt-5-image").
            Defaults to "openai/gpt-5-image".
      description: >-
        Configuration for the openrouter:image_generation server tool. Accepts
        all image_config params (aspect_ratio, quality, size, background,
        output_format, output_compression, moderation, etc.) plus a model field.
      title: ImageGenerationServerToolConfig
    ImageGenerationServerToolOpenRouterType:
      type: string
      enum:
        - openrouter:image_generation
      title: ImageGenerationServerToolOpenRouterType
    ImageGenerationServerTool_OpenRouter:
      type: object
      properties:
        parameters:
          $ref: '#/components/schemas/ImageGenerationServerToolConfig'
        type:
          $ref: '#/components/schemas/ImageGenerationServerToolOpenRouterType'
      required:
        - type
      description: >-
        OpenRouter built-in server tool: generates images from text prompts
        using an image generation model
      title: ImageGenerationServerTool_OpenRouter
    SearchModelsServerToolConfig:
      type: object
      properties:
        max_results:
          type: integer
          description: Maximum number of models to return. Defaults to 5, max 20.
      description: Configuration for the openrouter:experimental__search_models server tool
      title: SearchModelsServerToolConfig
    ChatSearchModelsServerToolType:
      type: string
      enum:
        - openrouter:experimental__search_models
      title: ChatSearchModelsServerToolType
    ChatSearchModelsServerTool:
      type: object
      properties:
        parameters:
          $ref: '#/components/schemas/SearchModelsServerToolConfig'
        type:
          $ref: '#/components/schemas/ChatSearchModelsServerToolType'
      required:
        - type
      description: >-
        OpenRouter built-in server tool: searches and filters AI models
        available on OpenRouter
      title: ChatSearchModelsServerTool
    WebSearchServerToolOpenRouterParameters:
      type: object
      properties:
        max_results:
          type: integer
          description: >-
            Maximum number of search results to return per search call. Defaults
            to 5.
        max_total_results:
          type: integer
          description: >-
            Maximum total number of search results across all search calls in a
            single request. Once this limit is reached, the tool will stop
            returning new results.
      title: WebSearchServerToolOpenRouterParameters
    WebSearchServerToolOpenRouterType:
      type: string
      enum:
        - openrouter:web_search
      title: WebSearchServerToolOpenRouterType
    WebSearchServerTool_OpenRouter:
      type: object
      properties:
        parameters:
          $ref: '#/components/schemas/WebSearchServerToolOpenRouterParameters'
        type:
          $ref: '#/components/schemas/WebSearchServerToolOpenRouterType'
      required:
        - type
      description: >-
        OpenRouter built-in server tool: searches the web for current
        information
      title: WebSearchServerTool_OpenRouter
    ResponsesRequestToolsItems:
      oneOf:
        - $ref: '#/components/schemas/ResponsesRequestToolsItems0'
        - $ref: '#/components/schemas/Preview_WebSearchServerTool'
        - $ref: '#/components/schemas/Preview_20250311_WebSearchServerTool'
        - $ref: '#/components/schemas/Legacy_WebSearchServerTool'
        - $ref: '#/components/schemas/WebSearchServerTool'
        - $ref: '#/components/schemas/FileSearchServerTool'
        - $ref: '#/components/schemas/ComputerUseServerTool'
        - $ref: '#/components/schemas/CodeInterpreterServerTool'
        - $ref: '#/components/schemas/McpServerTool'
        - $ref: '#/components/schemas/ImageGenerationServerTool'
        - $ref: '#/components/schemas/CodexLocalShellTool'
        - $ref: '#/components/schemas/ShellServerTool'
        - $ref: '#/components/schemas/ApplyPatchServerTool'
        - $ref: '#/components/schemas/CustomTool'
        - $ref: '#/components/schemas/DatetimeServerTool'
        - $ref: '#/components/schemas/ImageGenerationServerTool_OpenRouter'
        - $ref: '#/components/schemas/ChatSearchModelsServerTool'
        - $ref: '#/components/schemas/WebSearchServerTool_OpenRouter'
      title: ResponsesRequestToolsItems
    TraceConfig:
      type: object
      properties:
        generation_name:
          type: string
        parent_span_id:
          type: string
        span_name:
          type: string
        trace_id:
          type: string
        trace_name:
          type: string
      description: >-
        Metadata for observability and tracing. Known keys (trace_id,
        trace_name, span_name, generation_name, parent_span_id) have special
        handling. Additional keys are passed through as custom metadata to
        configured broadcast destinations.
      title: TraceConfig
    OpenAIResponsesTruncation:
      type: string
      enum:
        - auto
        - disabled
      title: OpenAIResponsesTruncation
    ResponsesRequest:
      type: object
      properties:
        background:
          type:
            - boolean
            - 'null'
        frequency_penalty:
          type:
            - number
            - 'null'
          format: double
        image_config:
          $ref: '#/components/schemas/ImageConfig'
        include:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/ResponseIncludesEnum'
        input:
          $ref: '#/components/schemas/Inputs'
        instructions:
          type:
            - string
            - 'null'
        max_output_tokens:
          type:
            - integer
            - 'null'
        max_tool_calls:
          type:
            - integer
            - 'null'
        metadata:
          $ref: '#/components/schemas/RequestMetadata'
        modalities:
          type: array
          items:
            $ref: '#/components/schemas/OutputModalityEnum'
          description: >-
            Output modalities for the response. Supported values are "text" and
            "image".
        model:
          type: string
        models:
          type: array
          items:
            type: string
        parallel_tool_calls:
          type:
            - boolean
            - 'null'
        plugins:
          type: array
          items:
            $ref: '#/components/schemas/ResponsesRequestPluginsItems'
          description: >-
            Plugins you want to enable for this request, including their
            settings.
        presence_penalty:
          type:
            - number
            - 'null'
          format: double
        previous_response_id:
          type:
            - string
            - 'null'
        prompt:
          $ref: '#/components/schemas/StoredPromptTemplate'
        prompt_cache_key:
          type:
            - string
            - 'null'
        provider:
          $ref: '#/components/schemas/ProviderPreferences'
        reasoning:
          $ref: '#/components/schemas/ReasoningConfig'
        route:
          description: Any type
        safety_identifier:
          type:
            - string
            - 'null'
        service_tier:
          oneOf:
            - $ref: '#/components/schemas/ResponsesRequestServiceTier'
            - type: 'null'
        session_id:
          type: string
          description: >-
            A unique identifier for grouping related requests (e.g., a
            conversation or agent workflow) for observability. If provided in
            both the request body and the x-session-id header, the body value
            takes precedence. Maximum of 256 characters.
        store:
          type: boolean
          enum:
            - false
        stream:
          type: boolean
          default: false
        temperature:
          type:
            - number
            - 'null'
          format: double
        text:
          $ref: '#/components/schemas/TextExtendedConfig'
        tool_choice:
          $ref: '#/components/schemas/OpenAIResponsesToolChoice'
        tools:
          type: array
          items:
            $ref: '#/components/schemas/ResponsesRequestToolsItems'
        top_k:
          type: integer
        top_logprobs:
          type:
            - integer
            - 'null'
        top_p:
          type:
            - number
            - 'null'
          format: double
        trace:
          $ref: '#/components/schemas/TraceConfig'
        truncation:
          $ref: '#/components/schemas/OpenAIResponsesTruncation'
        user:
          type: string
          description: >-
            A unique identifier representing your end-user, which helps
            distinguish between different users of your app. This allows your
            app to identify specific users in case of abuse reports, preventing
            your entire app from being affected by the actions of individual
            users. Maximum of 256 characters.
      description: Request schema for Responses endpoint
      title: ResponsesRequest
    ResponsesErrorFieldCode:
      type: string
      enum:
        - server_error
        - rate_limit_exceeded
        - invalid_prompt
        - vector_store_timeout
        - invalid_image
        - invalid_image_format
        - invalid_base64_image
        - invalid_image_url
        - image_too_large
        - image_too_small
        - image_parse_error
        - image_content_policy_violation
        - invalid_image_mode
        - image_file_too_large
        - unsupported_image_media_type
        - empty_image_file
        - failed_to_download_image
        - image_file_not_found
      title: ResponsesErrorFieldCode
    ResponsesErrorField:
      type: object
      properties:
        code:
          $ref: '#/components/schemas/ResponsesErrorFieldCode'
        message:
          type: string
      required:
        - code
        - message
      description: Error information returned from the API
      title: ResponsesErrorField
    IncompleteDetailsReason:
      type: string
      enum:
        - max_output_tokens
        - content_filter
      title: IncompleteDetailsReason
    IncompleteDetails:
      type: object
      properties:
        reason:
          $ref: '#/components/schemas/IncompleteDetailsReason'
      title: IncompleteDetails
    BaseInputsOneOf1ItemsOneOf0ContentOneOf0Items:
      oneOf:
        - $ref: '#/components/schemas/InputText'
        - $ref: '#/components/schemas/InputImage'
        - $ref: '#/components/schemas/InputFile'
        - $ref: '#/components/schemas/InputAudio'
      title: BaseInputsOneOf1ItemsOneOf0ContentOneOf0Items
    BaseInputsOneOf1ItemsOneOf0Content0:
      type: array
      items:
        $ref: '#/components/schemas/BaseInputsOneOf1ItemsOneOf0ContentOneOf0Items'
      title: BaseInputsOneOf1ItemsOneOf0Content0
    BaseInputsOneOf1ItemsOneOf0Content:
      oneOf:
        - $ref: '#/components/schemas/BaseInputsOneOf1ItemsOneOf0Content0'
        - type: string
      title: BaseInputsOneOf1ItemsOneOf0Content
    BaseInputsOneOf1ItemsOneOf0Phase0:
      type: string
      enum:
        - commentary
      title: BaseInputsOneOf1ItemsOneOf0Phase0
    BaseInputsOneOf1ItemsOneOf0Phase1:
      type: string
      enum:
        - final_answer
      title: BaseInputsOneOf1ItemsOneOf0Phase1
    BaseInputsOneOf1ItemsOneOf0Phase:
      oneOf:
        - $ref: '#/components/schemas/BaseInputsOneOf1ItemsOneOf0Phase0'
        - $ref: '#/components/schemas/BaseInputsOneOf1ItemsOneOf0Phase1'
        - description: Any type
      title: BaseInputsOneOf1ItemsOneOf0Phase
    BaseInputsOneOf1ItemsOneOf0Role0:
      type: string
      enum:
        - user
      title: BaseInputsOneOf1ItemsOneOf0Role0
    BaseInputsOneOf1ItemsOneOf0Role1:
      type: string
      enum:
        - system
      title: BaseInputsOneOf1ItemsOneOf0Role1
    BaseInputsOneOf1ItemsOneOf0Role2:
      type: string
      enum:
        - assistant
      title: BaseInputsOneOf1ItemsOneOf0Role2
    BaseInputsOneOf1ItemsOneOf0Role3:
      type: string
      enum:
        - developer
      title: BaseInputsOneOf1ItemsOneOf0Role3
    BaseInputsOneOf1ItemsOneOf0Role:
      oneOf:
        - $ref: '#/components/schemas/BaseInputsOneOf1ItemsOneOf0Role0'
        - $ref: '#/components/schemas/BaseInputsOneOf1ItemsOneOf0Role1'
        - $ref: '#/components/schemas/BaseInputsOneOf1ItemsOneOf0Role2'
        - $ref: '#/components/schemas/BaseInputsOneOf1ItemsOneOf0Role3'
      title: BaseInputsOneOf1ItemsOneOf0Role
    BaseInputsOneOf1ItemsOneOf0Type:
      type: string
      enum:
        - message
      title: BaseInputsOneOf1ItemsOneOf0Type
    BaseInputsOneOf1Items0:
      type: object
      properties:
        content:
          $ref: '#/components/schemas/BaseInputsOneOf1ItemsOneOf0Content'
        phase:
          $ref: '#/components/schemas/BaseInputsOneOf1ItemsOneOf0Phase'
        role:
          $ref: '#/components/schemas/BaseInputsOneOf1ItemsOneOf0Role'
        type:
          $ref: '#/components/schemas/BaseInputsOneOf1ItemsOneOf0Type'
      required:
        - content
        - role
      title: BaseInputsOneOf1Items0
    OpenAiResponseInputMessageItemContentItems:
      oneOf:
        - $ref: '#/components/schemas/InputText'
        - $ref: '#/components/schemas/InputImage'
        - $ref: '#/components/schemas/InputFile'
        - $ref: '#/components/schemas/InputAudio'
      title: OpenAiResponseInputMessageItemContentItems
    OpenAiResponseInputMessageItemRole0:
      type: string
      enum:
        - user
      title: OpenAiResponseInputMessageItemRole0
    OpenAiResponseInputMessageItemRole1:
      type: string
      enum:
        - system
      title: OpenAiResponseInputMessageItemRole1
    OpenAiResponseInputMessageItemRole2:
      type: string
      enum:
        - developer
      title: OpenAiResponseInputMessageItemRole2
    OpenAiResponseInputMessageItemRole:
      oneOf:
        - $ref: '#/components/schemas/OpenAiResponseInputMessageItemRole0'
        - $ref: '#/components/schemas/OpenAiResponseInputMessageItemRole1'
        - $ref: '#/components/schemas/OpenAiResponseInputMessageItemRole2'
      title: OpenAiResponseInputMessageItemRole
    OpenAiResponseInputMessageItemType:
      type: string
      enum:
        - message
      title: OpenAiResponseInputMessageItemType
    OpenAIResponseInputMessageItem:
      type: object
      properties:
        content:
          type: array
          items:
            $ref: '#/components/schemas/OpenAiResponseInputMessageItemContentItems'
        id:
          type: string
        role:
          $ref: '#/components/schemas/OpenAiResponseInputMessageItemRole'
        type:
          $ref: '#/components/schemas/OpenAiResponseInputMessageItemType'
      required:
        - content
        - id
        - role
      title: OpenAIResponseInputMessageItem
    OpenAIResponseFunctionToolCallOutput:
      type: object
      properties:
        call_id:
          type: string
        id:
          type:
            - string
            - 'null'
        output:
          $ref: '#/components/schemas/OpenAiResponseFunctionToolCallOutputOutput'
        status:
          $ref: '#/components/schemas/OpenAiResponseFunctionToolCallOutputStatus'
        type:
          $ref: '#/components/schemas/OpenAiResponseFunctionToolCallOutputType'
      required:
        - call_id
        - output
        - type
      title: OpenAIResponseFunctionToolCallOutput
    OpenAIResponseFunctionToolCall:
      type: object
      properties:
        arguments:
          type: string
        call_id:
          type: string
        id:
          type: string
        name:
          type: string
        status:
          $ref: '#/components/schemas/ToolCallStatus'
        type:
          $ref: '#/components/schemas/OpenAiResponseFunctionToolCallType'
      required:
        - arguments
        - call_id
        - name
        - type
      title: OpenAIResponseFunctionToolCall
    OutputItemImageGenerationCall:
      type: object
      properties:
        id:
          type: string
        result:
          type:
            - string
            - 'null'
        status:
          $ref: '#/components/schemas/ImageGenerationStatus'
        type:
          $ref: '#/components/schemas/OutputItemImageGenerationCallType'
      required:
        - id
        - status
        - type
      title: OutputItemImageGenerationCall
    OutputMessage:
      type: object
      properties:
        content:
          type: array
          items:
            $ref: '#/components/schemas/OutputMessageContentItems'
        id:
          type: string
        phase:
          $ref: '#/components/schemas/OutputMessagePhase'
          description: >-
            The phase of an assistant message. Use `commentary` for an
            intermediate assistant message and `final_answer` for the final
            assistant message. For follow-up requests with models like
            `gpt-5.3-codex` and later, preserve and resend phase on all
            assistant messages. Omitting it can degrade performance. Not used
            for user messages.
        role:
          $ref: '#/components/schemas/OutputMessageRole'
        status:
          $ref: '#/components/schemas/OutputMessageStatus'
        type:
          $ref: '#/components/schemas/OutputMessageType'
      required:
        - content
        - id
        - role
        - type
      title: OutputMessage
    BaseInputsOneOf1Items:
      oneOf:
        - $ref: '#/components/schemas/BaseInputsOneOf1Items0'
        - $ref: '#/components/schemas/OpenAIResponseInputMessageItem'
        - $ref: '#/components/schemas/OpenAIResponseFunctionToolCallOutput'
        - $ref: '#/components/schemas/OpenAIResponseFunctionToolCall'
        - $ref: '#/components/schemas/OutputItemImageGenerationCall'
        - $ref: '#/components/schemas/OutputMessage'
      title: BaseInputsOneOf1Items
    BaseInputs1:
      type: array
      items:
        $ref: '#/components/schemas/BaseInputsOneOf1Items'
      title: BaseInputs1
    BaseInputs:
      oneOf:
        - type: string
        - $ref: '#/components/schemas/BaseInputs1'
        - description: Any type
      title: BaseInputs
    BaseResponsesResultObject:
      type: string
      enum:
        - response
      title: BaseResponsesResultObject
    OutputItemReasoning:
      type: object
      properties:
        content:
          type: array
          items:
            $ref: '#/components/schemas/ReasoningTextContent'
        encrypted_content:
          type:
            - string
            - 'null'
        id:
          type: string
        status:
          $ref: '#/components/schemas/OutputItemReasoningStatus'
        summary:
          type: array
          items:
            $ref: '#/components/schemas/ReasoningSummaryText'
        type:
          $ref: '#/components/schemas/OutputItemReasoningType'
      required:
        - id
        - summary
        - type
      title: OutputItemReasoning
    OutputItemFunctionCall:
      type: object
      properties:
        arguments:
          type: string
        call_id:
          type: string
        id:
          type: string
        name:
          type: string
        status:
          $ref: '#/components/schemas/OutputItemFunctionCallStatus'
        type:
          $ref: '#/components/schemas/OutputItemFunctionCallType'
      required:
        - arguments
        - call_id
        - name
        - type
      title: OutputItemFunctionCall
    OutputItemWebSearchCall:
      type: object
      properties:
        action:
          $ref: '#/components/schemas/OutputItemWebSearchCallAction'
        id:
          type: string
        status:
          $ref: '#/components/schemas/WebSearchStatus'
        type:
          $ref: '#/components/schemas/OutputItemWebSearchCallType'
      required:
        - action
        - id
        - status
        - type
      title: OutputItemWebSearchCall
    OutputItemFileSearchCall:
      type: object
      properties:
        id:
          type: string
        queries:
          type: array
          items:
            type: string
        status:
          $ref: '#/components/schemas/WebSearchStatus'
        type:
          $ref: '#/components/schemas/OutputItemFileSearchCallType'
      required:
        - id
        - queries
        - status
        - type
      title: OutputItemFileSearchCall
    BaseResponsesResultOutputItems:
      oneOf:
        - $ref: '#/components/schemas/OutputMessage'
        - $ref: '#/components/schemas/OutputItemReasoning'
        - $ref: '#/components/schemas/OutputItemFunctionCall'
        - $ref: '#/components/schemas/OutputItemWebSearchCall'
        - $ref: '#/components/schemas/OutputItemFileSearchCall'
        - $ref: '#/components/schemas/OutputItemImageGenerationCall'
      title: BaseResponsesResultOutputItems
    BaseReasoningConfig:
      type: object
      properties:
        effort:
          $ref: '#/components/schemas/ReasoningEffort'
        summary:
          $ref: '#/components/schemas/ReasoningSummaryVerbosity'
      title: BaseReasoningConfig
    ServiceTier:
      type: string
      enum:
        - auto
        - default
        - flex
        - priority
        - scale
      title: ServiceTier
    OpenAIResponsesResponseStatus:
      type: string
      enum:
        - completed
        - incomplete
        - in_progress
        - failed
        - cancelled
        - queued
      title: OpenAIResponsesResponseStatus
    TextConfig:
      type: object
      properties:
        format:
          $ref: '#/components/schemas/Formats'
        verbosity:
          oneOf:
            - $ref: '#/components/schemas/TextConfigVerbosity'
            - type: 'null'
      description: Text output configuration including format and verbosity
      title: TextConfig
    BaseResponsesResultToolsItems0:
      type: object
      properties:
        description:
          type:
            - string
            - 'null'
        name:
          type: string
        parameters:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
        strict:
          type:
            - boolean
            - 'null'
        type:
          $ref: '#/components/schemas/FunctionToolType'
      required:
        - name
        - parameters
        - type
      description: Function tool definition
      title: BaseResponsesResultToolsItems0
    BaseResponsesResultToolsItems:
      oneOf:
        - $ref: '#/components/schemas/BaseResponsesResultToolsItems0'
        - $ref: '#/components/schemas/Preview_WebSearchServerTool'
        - $ref: '#/components/schemas/Preview_20250311_WebSearchServerTool'
        - $ref: '#/components/schemas/Legacy_WebSearchServerTool'
        - $ref: '#/components/schemas/WebSearchServerTool'
        - $ref: '#/components/schemas/FileSearchServerTool'
        - $ref: '#/components/schemas/ComputerUseServerTool'
        - $ref: '#/components/schemas/CodeInterpreterServerTool'
        - $ref: '#/components/schemas/McpServerTool'
        - $ref: '#/components/schemas/ImageGenerationServerTool'
        - $ref: '#/components/schemas/CodexLocalShellTool'
        - $ref: '#/components/schemas/ShellServerTool'
        - $ref: '#/components/schemas/ApplyPatchServerTool'
        - $ref: '#/components/schemas/CustomTool'
      title: BaseResponsesResultToolsItems
    Truncation:
      type: string
      enum:
        - auto
        - disabled
      title: Truncation
    OpenAiResponsesUsageInputTokensDetails:
      type: object
      properties:
        cached_tokens:
          type: integer
      required:
        - cached_tokens
      title: OpenAiResponsesUsageInputTokensDetails
    OpenAiResponsesUsageOutputTokensDetails:
      type: object
      properties:
        reasoning_tokens:
          type: integer
      required:
        - reasoning_tokens
      title: OpenAiResponsesUsageOutputTokensDetails
    OpenAIResponsesUsage:
      type: object
      properties:
        input_tokens:
          type: integer
        input_tokens_details:
          $ref: '#/components/schemas/OpenAiResponsesUsageInputTokensDetails'
        output_tokens:
          type: integer
        output_tokens_details:
          $ref: '#/components/schemas/OpenAiResponsesUsageOutputTokensDetails'
        total_tokens:
          type: integer
      required:
        - input_tokens
        - input_tokens_details
        - output_tokens
        - output_tokens_details
        - total_tokens
      title: OpenAIResponsesUsage
    CodeInterpreterCallItemOutputsItemsOneOf0Type:
      type: string
      enum:
        - image
      title: CodeInterpreterCallItemOutputsItemsOneOf0Type
    CodeInterpreterCallItemOutputsItems0:
      type: object
      properties:
        type:
          $ref: '#/components/schemas/CodeInterpreterCallItemOutputsItemsOneOf0Type'
        url:
          type: string
      required:
        - type
        - url
      title: CodeInterpreterCallItemOutputsItems0
    CodeInterpreterCallItemOutputsItemsOneOf1Type:
      type: string
      enum:
        - logs
      title: CodeInterpreterCallItemOutputsItemsOneOf1Type
    CodeInterpreterCallItemOutputsItems1:
      type: object
      properties:
        logs:
          type: string
        type:
          $ref: '#/components/schemas/CodeInterpreterCallItemOutputsItemsOneOf1Type'
      required:
        - logs
        - type
      title: CodeInterpreterCallItemOutputsItems1
    CodeInterpreterCallItemOutputsItems:
      oneOf:
        - $ref: '#/components/schemas/CodeInterpreterCallItemOutputsItems0'
        - $ref: '#/components/schemas/CodeInterpreterCallItemOutputsItems1'
      title: CodeInterpreterCallItemOutputsItems
    CodeInterpreterCallItemType:
      type: string
      enum:
        - code_interpreter_call
      title: CodeInterpreterCallItemType
    OutputComputerCallItemPendingSafetyChecksItems:
      type: object
      properties:
        code:
          type: string
        id:
          type: string
        message:
          type: string
      required:
        - code
        - id
        - message
      title: OutputComputerCallItemPendingSafetyChecksItems
    OutputComputerCallItemStatus:
      type: string
      enum:
        - completed
        - incomplete
        - in_progress
      title: OutputComputerCallItemStatus
    OutputComputerCallItemType:
      type: string
      enum:
        - computer_call
      title: OutputComputerCallItemType
    OutputApplyPatchServerToolItemType:
      type: string
      enum:
        - openrouter:apply_patch
      title: OutputApplyPatchServerToolItemType
    OutputBashServerToolItemType:
      type: string
      enum:
        - openrouter:bash
      title: OutputBashServerToolItemType
    OutputBrowserUseServerToolItemType:
      type: string
      enum:
        - openrouter:browser_use
      title: OutputBrowserUseServerToolItemType
    OutputCodeInterpreterServerToolItemType:
      type: string
      enum:
        - openrouter:code_interpreter
      title: OutputCodeInterpreterServerToolItemType
    OutputSearchModelsServerToolItemType:
      type: string
      enum:
        - openrouter:experimental__search_models
      title: OutputSearchModelsServerToolItemType
    OutputFileSearchServerToolItemType:
      type: string
      enum:
        - openrouter:file_search
      title: OutputFileSearchServerToolItemType
    OutputImageGenerationServerToolItemType:
      type: string
      enum:
        - openrouter:image_generation
      title: OutputImageGenerationServerToolItemType
    OutputMcpServerToolItemType:
      type: string
      enum:
        - openrouter:mcp
      title: OutputMcpServerToolItemType
    OutputMemoryServerToolItemAction:
      type: string
      enum:
        - read
        - write
        - delete
      title: OutputMemoryServerToolItemAction
    OutputMemoryServerToolItemType:
      type: string
      enum:
        - openrouter:memory
      title: OutputMemoryServerToolItemType
    OutputTextEditorServerToolItemCommand:
      type: string
      enum:
        - view
        - create
        - str_replace
        - insert
      title: OutputTextEditorServerToolItemCommand
    OutputTextEditorServerToolItemType:
      type: string
      enum:
        - openrouter:text_editor
      title: OutputTextEditorServerToolItemType
    OutputToolSearchServerToolItemType:
      type: string
      enum:
        - openrouter:tool_search
      title: OutputToolSearchServerToolItemType
    OutputWebFetchServerToolItemType:
      type: string
      enum:
        - openrouter:web_fetch
      title: OutputWebFetchServerToolItemType
    OutputItems:
      oneOf:
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/CodeInterpreterCallItemType'
            code:
              type:
                - string
                - 'null'
            container_id:
              type: string
            id:
              type: string
            outputs:
              type:
                - array
                - 'null'
              items:
                $ref: '#/components/schemas/CodeInterpreterCallItemOutputsItems'
            status:
              $ref: '#/components/schemas/ToolCallStatus'
          required:
            - type
            - code
            - container_id
            - id
            - outputs
            - status
          description: code_interpreter_call variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputComputerCallItemType'
            action:
              oneOf:
                - description: Any type
                - type: 'null'
            call_id:
              type: string
            id:
              type: string
            pending_safety_checks:
              type: array
              items:
                $ref: >-
                  #/components/schemas/OutputComputerCallItemPendingSafetyChecksItems
            status:
              $ref: '#/components/schemas/OutputComputerCallItemStatus'
          required:
            - type
            - call_id
            - pending_safety_checks
            - status
          description: computer_call variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputItemFileSearchCallType'
            id:
              type: string
            queries:
              type: array
              items:
                type: string
            status:
              $ref: '#/components/schemas/WebSearchStatus'
          required:
            - type
            - id
            - queries
            - status
          description: file_search_call variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputItemFunctionCallType'
            arguments:
              type: string
            call_id:
              type: string
            id:
              type: string
            name:
              type: string
            status:
              $ref: '#/components/schemas/OutputItemFunctionCallStatus'
          required:
            - type
            - arguments
            - call_id
            - name
          description: function_call variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputItemImageGenerationCallType'
            id:
              type: string
            result:
              type:
                - string
                - 'null'
            status:
              $ref: '#/components/schemas/ImageGenerationStatus'
          required:
            - type
            - id
            - status
          description: image_generation_call variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputMessageType'
            content:
              type: array
              items:
                $ref: '#/components/schemas/OutputMessageContentItems'
            id:
              type: string
            phase:
              $ref: '#/components/schemas/OutputMessagePhase'
              description: >-
                The phase of an assistant message. Use `commentary` for an
                intermediate assistant message and `final_answer` for the final
                assistant message. For follow-up requests with models like
                `gpt-5.3-codex` and later, preserve and resend phase on all
                assistant messages. Omitting it can degrade performance. Not
                used for user messages.
            role:
              $ref: '#/components/schemas/OutputMessageRole'
            status:
              $ref: '#/components/schemas/OutputMessageStatus'
          required:
            - type
            - content
            - id
            - role
          description: message variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputApplyPatchServerToolItemType'
            filePath:
              type: string
            id:
              type: string
            patch:
              type: string
            status:
              $ref: '#/components/schemas/ToolCallStatus'
          required:
            - type
            - status
          description: openrouter:apply_patch variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputBashServerToolItemType'
            command:
              type: string
            exitCode:
              type: integer
            id:
              type: string
            status:
              $ref: '#/components/schemas/ToolCallStatus'
            stderr:
              type: string
            stdout:
              type: string
          required:
            - type
            - status
          description: openrouter:bash variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputBrowserUseServerToolItemType'
            action:
              type: string
            id:
              type: string
            screenshotB64:
              type: string
            status:
              $ref: '#/components/schemas/ToolCallStatus'
          required:
            - type
            - status
          description: openrouter:browser_use variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputCodeInterpreterServerToolItemType'
            code:
              type: string
            exitCode:
              type: integer
            id:
              type: string
            language:
              type: string
            status:
              $ref: '#/components/schemas/ToolCallStatus'
            stderr:
              type: string
            stdout:
              type: string
          required:
            - type
            - status
          description: openrouter:code_interpreter variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputDatetimeItemType'
            datetime:
              type: string
              description: ISO 8601 datetime string
            id:
              type: string
            status:
              $ref: '#/components/schemas/ToolCallStatus'
            timezone:
              type: string
              description: IANA timezone name
          required:
            - type
            - datetime
            - status
            - timezone
          description: openrouter:datetime variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputSearchModelsServerToolItemType'
            arguments:
              type: string
              description: >-
                The JSON arguments submitted to the search tool (e.g.
                {"query":"Claude"})
            id:
              type: string
            query:
              type: string
            status:
              $ref: '#/components/schemas/ToolCallStatus'
          required:
            - type
            - status
          description: openrouter:experimental__search_models variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputFileSearchServerToolItemType'
            id:
              type: string
            queries:
              type: array
              items:
                type: string
            status:
              $ref: '#/components/schemas/ToolCallStatus'
          required:
            - type
            - status
          description: openrouter:file_search variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputImageGenerationServerToolItemType'
            id:
              type: string
            imageB64:
              type: string
            imageUrl:
              type: string
            result:
              type:
                - string
                - 'null'
              description: >-
                The generated image as a base64-encoded string or URL, matching
                OpenAI image_generation_call format
            revisedPrompt:
              type: string
            status:
              $ref: '#/components/schemas/ToolCallStatus'
          required:
            - type
            - status
          description: openrouter:image_generation variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputMcpServerToolItemType'
            id:
              type: string
            serverLabel:
              type: string
            status:
              $ref: '#/components/schemas/ToolCallStatus'
            toolName:
              type: string
          required:
            - type
            - status
          description: openrouter:mcp variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputMemoryServerToolItemType'
            action:
              $ref: '#/components/schemas/OutputMemoryServerToolItemAction'
            id:
              type: string
            key:
              type: string
            status:
              $ref: '#/components/schemas/ToolCallStatus'
            value:
              oneOf:
                - description: Any type
                - type: 'null'
          required:
            - type
            - status
          description: openrouter:memory variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputTextEditorServerToolItemType'
            command:
              $ref: '#/components/schemas/OutputTextEditorServerToolItemCommand'
            filePath:
              type: string
            id:
              type: string
            status:
              $ref: '#/components/schemas/ToolCallStatus'
          required:
            - type
            - status
          description: openrouter:text_editor variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputToolSearchServerToolItemType'
            id:
              type: string
            query:
              type: string
            status:
              $ref: '#/components/schemas/ToolCallStatus'
          required:
            - type
            - status
          description: openrouter:tool_search variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputWebFetchServerToolItemType'
            content:
              type: string
            id:
              type: string
            status:
              $ref: '#/components/schemas/ToolCallStatus'
            title:
              type: string
            url:
              type: string
          required:
            - type
            - status
          description: openrouter:web_fetch variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputWebSearchServerToolItemType'
            id:
              type: string
            status:
              $ref: '#/components/schemas/ToolCallStatus'
          required:
            - type
            - status
          description: openrouter:web_search variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputItemReasoningType'
            content:
              type:
                - array
                - 'null'
              items:
                $ref: '#/components/schemas/ReasoningTextContent'
            encrypted_content:
              type:
                - string
                - 'null'
            id:
              type: string
            status:
              $ref: '#/components/schemas/OutputItemReasoningStatus'
            summary:
              type: array
              items:
                $ref: '#/components/schemas/ReasoningSummaryText'
            format:
              $ref: '#/components/schemas/ReasoningFormat'
            signature:
              type:
                - string
                - 'null'
              description: A signature for the reasoning content, used for verification
          required:
            - type
            - id
            - summary
          description: reasoning variant
        - type: object
          properties:
            type:
              $ref: '#/components/schemas/OutputItemWebSearchCallType'
            action:
              $ref: '#/components/schemas/OutputItemWebSearchCallAction'
            id:
              type: string
            status:
              $ref: '#/components/schemas/WebSearchStatus'
          required:
            - type
            - action
            - id
            - status
          description: web_search_call variant
      discriminator:
        propertyName: type
      description: An output item from the response
      title: OutputItems
    UsageCostDetails:
      type: object
      properties:
        upstream_inference_cost:
          type:
            - number
            - 'null'
          format: double
        upstream_inference_input_cost:
          type: number
          format: double
        upstream_inference_output_cost:
          type: number
          format: double
      required:
        - upstream_inference_input_cost
        - upstream_inference_output_cost
      title: UsageCostDetails
    Usage:
      type: object
      properties:
        input_tokens:
          type: integer
        input_tokens_details:
          $ref: '#/components/schemas/OpenAiResponsesUsageInputTokensDetails'
        output_tokens:
          type: integer
        output_tokens_details:
          $ref: '#/components/schemas/OpenAiResponsesUsageOutputTokensDetails'
        total_tokens:
          type: integer
        cost:
          type:
            - number
            - 'null'
          format: double
          description: Cost of the completion
        cost_details:
          $ref: '#/components/schemas/UsageCostDetails'
        is_byok:
          type: boolean
          description: Whether a request was made using a Bring Your Own Key configuration
      required:
        - input_tokens
        - input_tokens_details
        - output_tokens
        - output_tokens_details
        - total_tokens
      description: Token usage information for the response
      title: Usage
    OpenResponsesResult:
      type: object
      properties:
        background:
          type:
            - boolean
            - 'null'
        completed_at:
          type:
            - integer
            - 'null'
        created_at:
          type: integer
        error:
          $ref: '#/components/schemas/ResponsesErrorField'
        frequency_penalty:
          type:
            - number
            - 'null'
          format: double
        id:
          type: string
        incomplete_details:
          $ref: '#/components/schemas/IncompleteDetails'
        instructions:
          $ref: '#/components/schemas/BaseInputs'
        max_output_tokens:
          type:
            - integer
            - 'null'
        max_tool_calls:
          type:
            - integer
            - 'null'
        metadata:
          $ref: '#/components/schemas/RequestMetadata'
        model:
          type: string
        object:
          $ref: '#/components/schemas/BaseResponsesResultObject'
        output:
          type: array
          items:
            $ref: '#/components/schemas/OutputItems'
        output_text:
          type: string
        parallel_tool_calls:
          type: boolean
        presence_penalty:
          type:
            - number
            - 'null'
          format: double
        previous_response_id:
          type:
            - string
            - 'null'
        prompt:
          $ref: '#/components/schemas/StoredPromptTemplate'
        prompt_cache_key:
          type:
            - string
            - 'null'
        reasoning:
          $ref: '#/components/schemas/BaseReasoningConfig'
        safety_identifier:
          type:
            - string
            - 'null'
        service_tier:
          type:
            - string
            - 'null'
        status:
          $ref: '#/components/schemas/OpenAIResponsesResponseStatus'
        store:
          type: boolean
        temperature:
          type:
            - number
            - 'null'
          format: double
        text:
          $ref: '#/components/schemas/TextExtendedConfig'
        tool_choice:
          $ref: '#/components/schemas/OpenAIResponsesToolChoice'
        tools:
          type: array
          items:
            $ref: '#/components/schemas/BaseResponsesResultToolsItems'
        top_logprobs:
          type: integer
        top_p:
          type:
            - number
            - 'null'
          format: double
        truncation:
          $ref: '#/components/schemas/Truncation'
        usage:
          $ref: '#/components/schemas/Usage'
        user:
          type:
            - string
            - 'null'
      required:
        - completed_at
        - created_at
        - error
        - frequency_penalty
        - id
        - incomplete_details
        - instructions
        - metadata
        - model
        - object
        - output
        - parallel_tool_calls
        - presence_penalty
        - status
        - temperature
        - tool_choice
        - tools
        - top_p
      description: Complete non-streaming response from the Responses API
      title: OpenResponsesResult
    BadRequestResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for BadRequestResponse
      title: BadRequestResponseErrorData
    BadRequestResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/BadRequestResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Bad Request - Invalid request parameters or malformed input
      title: BadRequestResponse
    UnauthorizedResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for UnauthorizedResponse
      title: UnauthorizedResponseErrorData
    UnauthorizedResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/UnauthorizedResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Unauthorized - Authentication required or invalid credentials
      title: UnauthorizedResponse
    PaymentRequiredResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for PaymentRequiredResponse
      title: PaymentRequiredResponseErrorData
    PaymentRequiredResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/PaymentRequiredResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Payment Required - Insufficient credits or quota to complete request
      title: PaymentRequiredResponse
    NotFoundResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for NotFoundResponse
      title: NotFoundResponseErrorData
    NotFoundResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/NotFoundResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Not Found - Resource does not exist
      title: NotFoundResponse
    RequestTimeoutResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for RequestTimeoutResponse
      title: RequestTimeoutResponseErrorData
    RequestTimeoutResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/RequestTimeoutResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Request Timeout - Operation exceeded time limit
      title: RequestTimeoutResponse
    PayloadTooLargeResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for PayloadTooLargeResponse
      title: PayloadTooLargeResponseErrorData
    PayloadTooLargeResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/PayloadTooLargeResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Payload Too Large - Request payload exceeds size limits
      title: PayloadTooLargeResponse
    UnprocessableEntityResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for UnprocessableEntityResponse
      title: UnprocessableEntityResponseErrorData
    UnprocessableEntityResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/UnprocessableEntityResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Unprocessable Entity - Semantic validation failure
      title: UnprocessableEntityResponse
    TooManyRequestsResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for TooManyRequestsResponse
      title: TooManyRequestsResponseErrorData
    TooManyRequestsResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/TooManyRequestsResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Too Many Requests - Rate limit exceeded
      title: TooManyRequestsResponse
    InternalServerResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for InternalServerResponse
      title: InternalServerResponseErrorData
    InternalServerResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/InternalServerResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Internal Server Error - Unexpected server error
      title: InternalServerResponse
    BadGatewayResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for BadGatewayResponse
      title: BadGatewayResponseErrorData
    BadGatewayResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/BadGatewayResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Bad Gateway - Provider/upstream API failure
      title: BadGatewayResponse
    ServiceUnavailableResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for ServiceUnavailableResponse
      title: ServiceUnavailableResponseErrorData
    ServiceUnavailableResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/ServiceUnavailableResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Service Unavailable - Service temporarily unavailable
      title: ServiceUnavailableResponse
  securitySchemes:
    apiKey:
      type: http
      scheme: bearer
      description: API key as bearer token in Authorization header

```

## SDK Code Examples

```python
import requests

url = "https://openrouter.ai/api/v1/responses"

payload = {
    "input": "Tell me a joke about computers",
    "model": "openai/gpt-4o"
}
headers = {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
}

response = requests.post(url, json=payload, headers=headers)

print(response.json())
```

```javascript
const url = 'https://openrouter.ai/api/v1/responses';
const options = {
  method: 'POST',
  headers: {Authorization: 'Bearer <token>', 'Content-Type': 'application/json'},
  body: '{"input":"Tell me a joke about computers","model":"openai/gpt-4o"}'
};

try {
  const response = await fetch(url, options);
  const data = await response.json();
  console.log(data);
} catch (error) {
  console.error(error);
}
```

```go
package main

import (
	"fmt"
	"strings"
	"net/http"
	"io"
)

func main() {

	url := "https://openrouter.ai/api/v1/responses"

	payload := strings.NewReader("{\n  \"input\": \"Tell me a joke about computers\",\n  \"model\": \"openai/gpt-4o\"\n}")

	req, _ := http.NewRequest("POST", url, payload)

	req.Header.Add("Authorization", "Bearer <token>")
	req.Header.Add("Content-Type", "application/json")

	res, _ := http.DefaultClient.Do(req)

	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)

	fmt.Println(res)
	fmt.Println(string(body))

}
```

```ruby
require 'uri'
require 'net/http'

url = URI("https://openrouter.ai/api/v1/responses")

http = Net::HTTP.new(url.host, url.port)
http.use_ssl = true

request = Net::HTTP::Post.new(url)
request["Authorization"] = 'Bearer <token>'
request["Content-Type"] = 'application/json'
request.body = "{\n  \"input\": \"Tell me a joke about computers\",\n  \"model\": \"openai/gpt-4o\"\n}"

response = http.request(request)
puts response.read_body
```

```java
import com.mashape.unirest.http.HttpResponse;
import com.mashape.unirest.http.Unirest;

HttpResponse<String> response = Unirest.post("https://openrouter.ai/api/v1/responses")
  .header("Authorization", "Bearer <token>")
  .header("Content-Type", "application/json")
  .body("{\n  \"input\": \"Tell me a joke about computers\",\n  \"model\": \"openai/gpt-4o\"\n}")
  .asString();
```

```php
<?php
require_once('vendor/autoload.php');

$client = new \GuzzleHttp\Client();

$response = $client->request('POST', 'https://openrouter.ai/api/v1/responses', [
  'body' => '{
  "input": "Tell me a joke about computers",
  "model": "openai/gpt-4o"
}',
  'headers' => [
    'Authorization' => 'Bearer <token>',
    'Content-Type' => 'application/json',
  ],
]);

echo $response->getBody();
```

```csharp
using RestSharp;

var client = new RestClient("https://openrouter.ai/api/v1/responses");
var request = new RestRequest(Method.POST);
request.AddHeader("Authorization", "Bearer <token>");
request.AddHeader("Content-Type", "application/json");
request.AddParameter("application/json", "{\n  \"input\": \"Tell me a joke about computers\",\n  \"model\": \"openai/gpt-4o\"\n}", ParameterType.RequestBody);
IRestResponse response = client.Execute(request);
```

```swift
import Foundation

let headers = [
  "Authorization": "Bearer <token>",
  "Content-Type": "application/json"
]
let parameters = [
  "input": "Tell me a joke about computers",
  "model": "openai/gpt-4o"
] as [String : Any]

let postData = JSONSerialization.data(withJSONObject: parameters, options: [])

let request = NSMutableURLRequest(url: NSURL(string: "https://openrouter.ai/api/v1/responses")! as URL,
                                        cachePolicy: .useProtocolCachePolicy,
                                    timeoutInterval: 10.0)
request.httpMethod = "POST"
request.allHTTPHeaderFields = headers
request.httpBody = postData as Data

let session = URLSession.shared
let dataTask = session.dataTask(with: request as URLRequest, completionHandler: { (data, response, error) -> Void in
  if (error != nil) {
    print(error as Any)
  } else {
    let httpResponse = response as? HTTPURLResponse
    print(httpResponse)
  }
})

dataTask.resume()
```# Create a chat completion

POST https://openrouter.ai/api/v1/chat/completions
Content-Type: application/json

Sends a request for a model response for the given chat conversation. Supports both streaming and non-streaming modes.

Reference: https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request

## OpenAPI Specification

```yaml
openapi: 3.1.0
info:
  title: OpenRouter API
  version: 1.0.0
paths:
  /chat/completions:
    post:
      operationId: send-chat-completion-request
      summary: Create a chat completion
      description: >-
        Sends a request for a model response for the given chat conversation.
        Supports both streaming and non-streaming modes.
      tags:
        - subpackage_chat
      parameters:
        - name: Authorization
          in: header
          description: API key as bearer token in Authorization header
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Successful chat completion response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ChatResult'
        '400':
          description: Bad Request - Invalid request parameters or malformed input
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BadRequestResponse'
        '401':
          description: Unauthorized - Authentication required or invalid credentials
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UnauthorizedResponse'
        '402':
          description: Payment Required - Insufficient credits or quota to complete request
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PaymentRequiredResponse'
        '404':
          description: Not Found - Resource does not exist
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/NotFoundResponse'
        '408':
          description: Request Timeout - Operation exceeded time limit
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestTimeoutResponse'
        '413':
          description: Payload Too Large - Request payload exceeds size limits
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PayloadTooLargeResponse'
        '422':
          description: Unprocessable Entity - Semantic validation failure
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UnprocessableEntityResponse'
        '429':
          description: Too Many Requests - Rate limit exceeded
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TooManyRequestsResponse'
        '500':
          description: Internal Server Error - Unexpected server error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/InternalServerResponse'
        '502':
          description: Bad Gateway - Provider/upstream API failure
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BadGatewayResponse'
        '503':
          description: Service Unavailable - Service temporarily unavailable
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ServiceUnavailableResponse'
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ChatRequest'
servers:
  - url: https://openrouter.ai/api/v1
components:
  schemas:
    AnthropicCacheControlTtl:
      type: string
      enum:
        - 5m
        - 1h
      title: AnthropicCacheControlTtl
    AnthropicCacheControlDirectiveType:
      type: string
      enum:
        - ephemeral
      title: AnthropicCacheControlDirectiveType
    ChatRequestCacheControl:
      type: object
      properties:
        ttl:
          $ref: '#/components/schemas/AnthropicCacheControlTtl'
        type:
          $ref: '#/components/schemas/AnthropicCacheControlDirectiveType'
      required:
        - type
      title: ChatRequestCacheControl
    ChatDebugOptions:
      type: object
      properties:
        echo_upstream_body:
          type: boolean
          description: >-
            If true, includes the transformed upstream request body in a debug
            chunk at the start of the stream. Only works with streaming mode.
      description: Debug options for inspecting request transformations (streaming only)
      title: ChatDebugOptions
    ImageConfig:
      oneOf:
        - type: string
        - type: number
          format: double
        - type: array
          items:
            description: Any type
      title: ImageConfig
    ChatContentCacheControl:
      type: object
      properties:
        ttl:
          $ref: '#/components/schemas/AnthropicCacheControlTtl'
        type:
          $ref: '#/components/schemas/AnthropicCacheControlDirectiveType'
      required:
        - type
      description: Cache control for the content part
      title: ChatContentCacheControl
    ChatContentTextType:
      type: string
      enum:
        - text
      title: ChatContentTextType
    ChatContentText:
      type: object
      properties:
        cache_control:
          $ref: '#/components/schemas/ChatContentCacheControl'
        text:
          type: string
        type:
          $ref: '#/components/schemas/ChatContentTextType'
      required:
        - text
        - type
      description: Text content part
      title: ChatContentText
    ChatSystemMessageContent1:
      type: array
      items:
        $ref: '#/components/schemas/ChatContentText'
      title: ChatSystemMessageContent1
    ChatSystemMessageContent:
      oneOf:
        - type: string
        - $ref: '#/components/schemas/ChatSystemMessageContent1'
      description: System message content
      title: ChatSystemMessageContent
    ChatSystemMessageRole:
      type: string
      enum:
        - system
      title: ChatSystemMessageRole
    ChatSystemMessage:
      type: object
      properties:
        content:
          $ref: '#/components/schemas/ChatSystemMessageContent'
          description: System message content
        name:
          type: string
          description: Optional name for the system message
        role:
          $ref: '#/components/schemas/ChatSystemMessageRole'
      required:
        - content
        - role
      description: System message for setting behavior
      title: ChatSystemMessage
    ChatContentImageImageUrlDetail:
      type: string
      enum:
        - auto
        - low
        - high
      description: Image detail level for vision models
      title: ChatContentImageImageUrlDetail
    ChatContentImageImageUrl:
      type: object
      properties:
        detail:
          $ref: '#/components/schemas/ChatContentImageImageUrlDetail'
          description: Image detail level for vision models
        url:
          type: string
          description: 'URL of the image (data: URLs supported)'
      required:
        - url
      title: ChatContentImageImageUrl
    ChatContentImageType:
      type: string
      enum:
        - image_url
      title: ChatContentImageType
    ChatContentImage:
      type: object
      properties:
        image_url:
          $ref: '#/components/schemas/ChatContentImageImageUrl'
        type:
          $ref: '#/components/schemas/ChatContentImageType'
      required:
        - image_url
        - type
      description: Image content part for vision models
      title: ChatContentImage
    ChatContentAudioInputAudio:
      type: object
      properties:
        data:
          type: string
          description: Base64 encoded audio data
        format:
          type: string
          description: >-
            Audio format (e.g., wav, mp3, flac, m4a, ogg, aiff, aac, pcm16,
            pcm24). Supported formats vary by provider.
      required:
        - data
        - format
      title: ChatContentAudioInputAudio
    ChatContentAudioType:
      type: string
      enum:
        - input_audio
      title: ChatContentAudioType
    ChatContentAudio:
      type: object
      properties:
        input_audio:
          $ref: '#/components/schemas/ChatContentAudioInputAudio'
        type:
          $ref: '#/components/schemas/ChatContentAudioType'
      required:
        - input_audio
        - type
      description: Audio input content part. Supported audio formats vary by provider.
      title: ChatContentAudio
    LegacyChatContentVideoType:
      type: string
      enum:
        - input_video
      title: LegacyChatContentVideoType
    ChatContentVideoInput:
      type: object
      properties:
        url:
          type: string
          description: 'URL of the video (data: URLs supported)'
      required:
        - url
      description: Video input object
      title: ChatContentVideoInput
    Legacy_ChatContentVideo:
      type: object
      properties:
        type:
          $ref: '#/components/schemas/LegacyChatContentVideoType'
        video_url:
          $ref: '#/components/schemas/ChatContentVideoInput'
      required:
        - type
        - video_url
      description: Video input content part (legacy format - deprecated)
      title: Legacy_ChatContentVideo
    ChatContentVideoType:
      type: string
      enum:
        - video_url
      title: ChatContentVideoType
    ChatContentVideo:
      type: object
      properties:
        type:
          $ref: '#/components/schemas/ChatContentVideoType'
        video_url:
          $ref: '#/components/schemas/ChatContentVideoInput'
      required:
        - type
        - video_url
      description: Video input content part
      title: ChatContentVideo
    ChatContentFileFile:
      type: object
      properties:
        file_data:
          type: string
          description: File content as base64 data URL or URL
        file_id:
          type: string
          description: File ID for previously uploaded files
        filename:
          type: string
          description: Original filename
      title: ChatContentFileFile
    ChatContentFileType:
      type: string
      enum:
        - file
      title: ChatContentFileType
    ChatContentFile:
      type: object
      properties:
        file:
          $ref: '#/components/schemas/ChatContentFileFile'
        type:
          $ref: '#/components/schemas/ChatContentFileType'
      required:
        - file
        - type
      description: File content part for document processing
      title: ChatContentFile
    ChatContentItems:
      oneOf:
        - $ref: '#/components/schemas/ChatContentText'
        - $ref: '#/components/schemas/ChatContentImage'
        - $ref: '#/components/schemas/ChatContentAudio'
        - $ref: '#/components/schemas/Legacy_ChatContentVideo'
        - $ref: '#/components/schemas/ChatContentVideo'
        - $ref: '#/components/schemas/ChatContentFile'
      description: Content part for chat completion messages
      title: ChatContentItems
    ChatUserMessageContent1:
      type: array
      items:
        $ref: '#/components/schemas/ChatContentItems'
      title: ChatUserMessageContent1
    ChatUserMessageContent:
      oneOf:
        - type: string
        - $ref: '#/components/schemas/ChatUserMessageContent1'
      description: User message content
      title: ChatUserMessageContent
    ChatUserMessageRole:
      type: string
      enum:
        - user
      title: ChatUserMessageRole
    ChatUserMessage:
      type: object
      properties:
        content:
          $ref: '#/components/schemas/ChatUserMessageContent'
          description: User message content
        name:
          type: string
          description: Optional name for the user
        role:
          $ref: '#/components/schemas/ChatUserMessageRole'
      required:
        - content
        - role
      description: User message
      title: ChatUserMessage
    ChatDeveloperMessageContent1:
      type: array
      items:
        $ref: '#/components/schemas/ChatContentText'
      title: ChatDeveloperMessageContent1
    ChatDeveloperMessageContent:
      oneOf:
        - type: string
        - $ref: '#/components/schemas/ChatDeveloperMessageContent1'
      description: Developer message content
      title: ChatDeveloperMessageContent
    ChatDeveloperMessageRole:
      type: string
      enum:
        - developer
      title: ChatDeveloperMessageRole
    ChatDeveloperMessage:
      type: object
      properties:
        content:
          $ref: '#/components/schemas/ChatDeveloperMessageContent'
          description: Developer message content
        name:
          type: string
          description: Optional name for the developer message
        role:
          $ref: '#/components/schemas/ChatDeveloperMessageRole'
      required:
        - content
        - role
      description: Developer message
      title: ChatDeveloperMessage
    ChatAudioOutput:
      type: object
      properties:
        data:
          type: string
          description: Base64 encoded audio data
        expires_at:
          type: integer
          description: Audio expiration timestamp
        id:
          type: string
          description: Audio output identifier
        transcript:
          type: string
          description: Audio transcript
      description: Audio output data or reference
      title: ChatAudioOutput
    ChatAssistantMessageContent1:
      type: array
      items:
        $ref: '#/components/schemas/ChatContentItems'
      title: ChatAssistantMessageContent1
    ChatAssistantMessageContent:
      oneOf:
        - type: string
        - $ref: '#/components/schemas/ChatAssistantMessageContent1'
        - description: Any type
      description: Assistant message content
      title: ChatAssistantMessageContent
    ChatAssistantImagesItemsImageUrl:
      type: object
      properties:
        url:
          type: string
          description: URL or base64-encoded data of the generated image
      required:
        - url
      title: ChatAssistantImagesItemsImageUrl
    ChatAssistantImagesItems:
      type: object
      properties:
        image_url:
          $ref: '#/components/schemas/ChatAssistantImagesItemsImageUrl'
      required:
        - image_url
      title: ChatAssistantImagesItems
    ChatAssistantImages:
      type: array
      items:
        $ref: '#/components/schemas/ChatAssistantImagesItems'
      description: Generated images from image generation models
      title: ChatAssistantImages
    ReasoningFormat:
      type: string
      enum:
        - unknown
        - openai-responses-v1
        - azure-openai-responses-v1
        - xai-responses-v1
        - anthropic-claude-v1
        - google-gemini-v1
      title: ReasoningFormat
    ReasoningDetailSummaryType:
      type: string
      enum:
        - reasoning.summary
      title: ReasoningDetailSummaryType
    ReasoningDetailSummary:
      type: object
      properties:
        format:
          $ref: '#/components/schemas/ReasoningFormat'
        id:
          type:
            - string
            - 'null'
        index:
          type: integer
        summary:
          type: string
        type:
          $ref: '#/components/schemas/ReasoningDetailSummaryType'
      required:
        - summary
        - type
      description: Reasoning detail summary schema
      title: ReasoningDetailSummary
    ReasoningDetailEncryptedType:
      type: string
      enum:
        - reasoning.encrypted
      title: ReasoningDetailEncryptedType
    ReasoningDetailEncrypted:
      type: object
      properties:
        data:
          type: string
        format:
          $ref: '#/components/schemas/ReasoningFormat'
        id:
          type:
            - string
            - 'null'
        index:
          type: integer
        type:
          $ref: '#/components/schemas/ReasoningDetailEncryptedType'
      required:
        - data
        - type
      description: Reasoning detail encrypted schema
      title: ReasoningDetailEncrypted
    ReasoningDetailTextType:
      type: string
      enum:
        - reasoning.text
      title: ReasoningDetailTextType
    ReasoningDetailText:
      type: object
      properties:
        format:
          $ref: '#/components/schemas/ReasoningFormat'
        id:
          type:
            - string
            - 'null'
        index:
          type: integer
        signature:
          type:
            - string
            - 'null'
        text:
          type:
            - string
            - 'null'
        type:
          $ref: '#/components/schemas/ReasoningDetailTextType'
      required:
        - type
      description: Reasoning detail text schema
      title: ReasoningDetailText
    ReasoningDetailUnion:
      oneOf:
        - $ref: '#/components/schemas/ReasoningDetailSummary'
        - $ref: '#/components/schemas/ReasoningDetailEncrypted'
        - $ref: '#/components/schemas/ReasoningDetailText'
      description: Reasoning detail union schema
      title: ReasoningDetailUnion
    ChatReasoningDetails:
      type: array
      items:
        $ref: '#/components/schemas/ReasoningDetailUnion'
      description: Reasoning details for extended thinking models
      title: ChatReasoningDetails
    ChatAssistantMessageRole:
      type: string
      enum:
        - assistant
      title: ChatAssistantMessageRole
    ChatToolCallFunction:
      type: object
      properties:
        arguments:
          type: string
          description: Function arguments as JSON string
        name:
          type: string
          description: Function name to call
      required:
        - arguments
        - name
      title: ChatToolCallFunction
    ChatToolCallType:
      type: string
      enum:
        - function
      title: ChatToolCallType
    ChatToolCall:
      type: object
      properties:
        function:
          $ref: '#/components/schemas/ChatToolCallFunction'
        id:
          type: string
          description: Tool call identifier
        type:
          $ref: '#/components/schemas/ChatToolCallType'
      required:
        - function
        - id
        - type
      description: Tool call made by the assistant
      title: ChatToolCall
    ChatAssistantMessage:
      type: object
      properties:
        audio:
          $ref: '#/components/schemas/ChatAudioOutput'
        content:
          $ref: '#/components/schemas/ChatAssistantMessageContent'
          description: Assistant message content
        images:
          $ref: '#/components/schemas/ChatAssistantImages'
        name:
          type: string
          description: Optional name for the assistant
        reasoning:
          type:
            - string
            - 'null'
          description: Reasoning output
        reasoning_details:
          $ref: '#/components/schemas/ChatReasoningDetails'
        refusal:
          type:
            - string
            - 'null'
          description: Refusal message if content was refused
        role:
          $ref: '#/components/schemas/ChatAssistantMessageRole'
        tool_calls:
          type: array
          items:
            $ref: '#/components/schemas/ChatToolCall'
          description: Tool calls made by the assistant
      required:
        - role
      description: Assistant message for requests and responses
      title: ChatAssistantMessage
    ChatToolMessageContent1:
      type: array
      items:
        $ref: '#/components/schemas/ChatContentItems'
      title: ChatToolMessageContent1
    ChatToolMessageContent:
      oneOf:
        - type: string
        - $ref: '#/components/schemas/ChatToolMessageContent1'
      description: Tool response content
      title: ChatToolMessageContent
    ChatToolMessageRole:
      type: string
      enum:
        - tool
      title: ChatToolMessageRole
    ChatToolMessage:
      type: object
      properties:
        content:
          $ref: '#/components/schemas/ChatToolMessageContent'
          description: Tool response content
        role:
          $ref: '#/components/schemas/ChatToolMessageRole'
        tool_call_id:
          type: string
          description: ID of the assistant message tool call this message responds to
      required:
        - content
        - role
        - tool_call_id
      description: Tool response message
      title: ChatToolMessage
    ChatMessages:
      oneOf:
        - $ref: '#/components/schemas/ChatSystemMessage'
        - $ref: '#/components/schemas/ChatUserMessage'
        - $ref: '#/components/schemas/ChatDeveloperMessage'
        - $ref: '#/components/schemas/ChatAssistantMessage'
        - $ref: '#/components/schemas/ChatToolMessage'
      description: Chat completion message with role-based discrimination
      title: ChatMessages
    ChatRequestModalitiesItems:
      type: string
      enum:
        - text
        - image
        - audio
      title: ChatRequestModalitiesItems
    ModelName:
      type: string
      description: Model to use for completion
      title: ModelName
    ChatModelNamesItems:
      type: object
      properties: {}
      title: ChatModelNamesItems
    ChatModelNames:
      type: array
      items:
        $ref: '#/components/schemas/ChatModelNamesItems'
      description: Models to use for completion
      title: ChatModelNames
    AutoRouterPluginId:
      type: string
      enum:
        - auto-router
      title: AutoRouterPluginId
    AutoRouterPlugin:
      type: object
      properties:
        allowed_models:
          type: array
          items:
            type: string
          description: >-
            List of model patterns to filter which models the auto-router can
            route between. Supports wildcards (e.g., "anthropic/*" matches all
            Anthropic models). When not specified, uses the default supported
            models list.
        enabled:
          type: boolean
          description: >-
            Set to false to disable the auto-router plugin for this request.
            Defaults to true.
        id:
          $ref: '#/components/schemas/AutoRouterPluginId'
      required:
        - id
      title: AutoRouterPlugin
    ModerationPluginId:
      type: string
      enum:
        - moderation
      title: ModerationPluginId
    ModerationPlugin:
      type: object
      properties:
        id:
          $ref: '#/components/schemas/ModerationPluginId'
      required:
        - id
      title: ModerationPlugin
    WebSearchEngine:
      type: string
      enum:
        - native
        - exa
        - firecrawl
        - parallel
      description: The search engine to use for web search.
      title: WebSearchEngine
    WebSearchPluginId:
      type: string
      enum:
        - web
      title: WebSearchPluginId
    WebSearchPlugin:
      type: object
      properties:
        enabled:
          type: boolean
          description: >-
            Set to false to disable the web-search plugin for this request.
            Defaults to true.
        engine:
          $ref: '#/components/schemas/WebSearchEngine'
        exclude_domains:
          type: array
          items:
            type: string
          description: >-
            A list of domains to exclude from web search results. Supports
            wildcards (e.g. "*.substack.com") and path filtering (e.g.
            "openai.com/blog").
        id:
          $ref: '#/components/schemas/WebSearchPluginId'
        include_domains:
          type: array
          items:
            type: string
          description: >-
            A list of domains to restrict web search results to. Supports
            wildcards (e.g. "*.substack.com") and path filtering (e.g.
            "openai.com/blog").
        max_results:
          type: integer
        search_prompt:
          type: string
      required:
        - id
      title: WebSearchPlugin
    FileParserPluginId:
      type: string
      enum:
        - file-parser
      title: FileParserPluginId
    PdfParserEngine0:
      type: string
      enum:
        - mistral-ocr
        - native
        - cloudflare-ai
      title: PdfParserEngine0
    PdfParserEngine1:
      type: string
      enum:
        - pdf-text
      title: PdfParserEngine1
    PDFParserEngine:
      oneOf:
        - $ref: '#/components/schemas/PdfParserEngine0'
        - $ref: '#/components/schemas/PdfParserEngine1'
      description: >-
        The engine to use for parsing PDF files. "pdf-text" is deprecated and
        automatically redirected to "cloudflare-ai".
      title: PDFParserEngine
    PDFParserOptions:
      type: object
      properties:
        engine:
          $ref: '#/components/schemas/PDFParserEngine'
      description: Options for PDF parsing.
      title: PDFParserOptions
    FileParserPlugin:
      type: object
      properties:
        enabled:
          type: boolean
          description: >-
            Set to false to disable the file-parser plugin for this request.
            Defaults to true.
        id:
          $ref: '#/components/schemas/FileParserPluginId'
        pdf:
          $ref: '#/components/schemas/PDFParserOptions'
      required:
        - id
      title: FileParserPlugin
    ResponseHealingPluginId:
      type: string
      enum:
        - response-healing
      title: ResponseHealingPluginId
    ResponseHealingPlugin:
      type: object
      properties:
        enabled:
          type: boolean
          description: >-
            Set to false to disable the response-healing plugin for this
            request. Defaults to true.
        id:
          $ref: '#/components/schemas/ResponseHealingPluginId'
      required:
        - id
      title: ResponseHealingPlugin
    ContextCompressionEngine:
      type: string
      enum:
        - middle-out
      description: The compression engine to use. Defaults to "middle-out".
      title: ContextCompressionEngine
    ContextCompressionPluginId:
      type: string
      enum:
        - context-compression
      title: ContextCompressionPluginId
    ContextCompressionPlugin:
      type: object
      properties:
        enabled:
          type: boolean
          description: >-
            Set to false to disable the context-compression plugin for this
            request. Defaults to true.
        engine:
          $ref: '#/components/schemas/ContextCompressionEngine'
        id:
          $ref: '#/components/schemas/ContextCompressionPluginId'
      required:
        - id
      title: ContextCompressionPlugin
    ChatRequestPluginsItems:
      oneOf:
        - $ref: '#/components/schemas/AutoRouterPlugin'
        - $ref: '#/components/schemas/ModerationPlugin'
        - $ref: '#/components/schemas/WebSearchPlugin'
        - $ref: '#/components/schemas/FileParserPlugin'
        - $ref: '#/components/schemas/ResponseHealingPlugin'
        - $ref: '#/components/schemas/ContextCompressionPlugin'
      title: ChatRequestPluginsItems
    ProviderPreferencesDataCollection:
      type: string
      enum:
        - deny
        - allow
      description: >-
        Data collection setting. If no available model provider meets the
        requirement, your request will return an error.

        - allow: (default) allow providers which store user data non-transiently
        and may train on it


        - deny: use only providers which do not collect user data.
      title: ProviderPreferencesDataCollection
    ProviderName:
      type: string
      enum:
        - AkashML
        - AI21
        - AionLabs
        - Alibaba
        - Ambient
        - Baidu
        - Amazon Bedrock
        - Amazon Nova
        - Anthropic
        - Arcee AI
        - AtlasCloud
        - Avian
        - Azure
        - BaseTen
        - BytePlus
        - Black Forest Labs
        - Cerebras
        - Chutes
        - Cirrascale
        - Clarifai
        - Cloudflare
        - Cohere
        - Crusoe
        - DeepInfra
        - DeepSeek
        - DekaLLM
        - Featherless
        - Fireworks
        - Friendli
        - GMICloud
        - Google
        - Google AI Studio
        - Groq
        - Hyperbolic
        - Inception
        - Inceptron
        - InferenceNet
        - Ionstream
        - Infermatic
        - Io Net
        - Inflection
        - Liquid
        - Mara
        - Mancer 2
        - Minimax
        - ModelRun
        - Mistral
        - Modular
        - Moonshot AI
        - Morph
        - NCompass
        - Nebius
        - NextBit
        - Novita
        - Nvidia
        - OpenAI
        - OpenInference
        - Parasail
        - Perplexity
        - Phala
        - Recraft
        - Reka
        - Relace
        - SambaNova
        - Seed
        - SiliconFlow
        - Sourceful
        - StepFun
        - Stealth
        - StreamLake
        - Switchpoint
        - Together
        - Upstage
        - Venice
        - WandB
        - Xiaomi
        - xAI
        - Z.AI
        - FakeProvider
      title: ProviderName
    ProviderPreferencesIgnoreItems:
      oneOf:
        - $ref: '#/components/schemas/ProviderName'
        - type: string
      title: ProviderPreferencesIgnoreItems
    ProviderPreferencesMaxPriceAudio:
      type: object
      properties: {}
      title: ProviderPreferencesMaxPriceAudio
    ProviderPreferencesMaxPriceCompletion:
      type: object
      properties: {}
      title: ProviderPreferencesMaxPriceCompletion
    ProviderPreferencesMaxPriceImage:
      type: object
      properties: {}
      title: ProviderPreferencesMaxPriceImage
    BigNumberUnion:
      type: string
      description: Price per million prompt tokens
      title: BigNumberUnion
    ProviderPreferencesMaxPriceRequest:
      type: object
      properties: {}
      title: ProviderPreferencesMaxPriceRequest
    ProviderPreferencesMaxPrice:
      type: object
      properties:
        audio:
          $ref: '#/components/schemas/ProviderPreferencesMaxPriceAudio'
        completion:
          $ref: '#/components/schemas/ProviderPreferencesMaxPriceCompletion'
        image:
          $ref: '#/components/schemas/ProviderPreferencesMaxPriceImage'
        prompt:
          $ref: '#/components/schemas/BigNumberUnion'
        request:
          $ref: '#/components/schemas/ProviderPreferencesMaxPriceRequest'
      description: >-
        The object specifying the maximum price you want to pay for this
        request. USD price per million tokens, for prompt and completion.
      title: ProviderPreferencesMaxPrice
    ProviderPreferencesOnlyItems:
      oneOf:
        - $ref: '#/components/schemas/ProviderName'
        - type: string
      title: ProviderPreferencesOnlyItems
    ProviderPreferencesOrderItems:
      oneOf:
        - $ref: '#/components/schemas/ProviderName'
        - type: string
      title: ProviderPreferencesOrderItems
    PercentileLatencyCutoffs:
      type: object
      properties:
        p50:
          type:
            - number
            - 'null'
          format: double
          description: Maximum p50 latency (seconds)
        p75:
          type:
            - number
            - 'null'
          format: double
          description: Maximum p75 latency (seconds)
        p90:
          type:
            - number
            - 'null'
          format: double
          description: Maximum p90 latency (seconds)
        p99:
          type:
            - number
            - 'null'
          format: double
          description: Maximum p99 latency (seconds)
      description: >-
        Percentile-based latency cutoffs. All specified cutoffs must be met for
        an endpoint to be preferred.
      title: PercentileLatencyCutoffs
    PreferredMaxLatency:
      oneOf:
        - type: number
          format: double
        - $ref: '#/components/schemas/PercentileLatencyCutoffs'
        - description: Any type
      description: >-
        Preferred maximum latency (in seconds). Can be a number (applies to p50)
        or an object with percentile-specific cutoffs. Endpoints above the
        threshold(s) may still be used, but are deprioritized in routing. When
        using fallback models, this may cause a fallback model to be used
        instead of the primary model if it meets the threshold.
      title: PreferredMaxLatency
    PercentileThroughputCutoffs:
      type: object
      properties:
        p50:
          type:
            - number
            - 'null'
          format: double
          description: Minimum p50 throughput (tokens/sec)
        p75:
          type:
            - number
            - 'null'
          format: double
          description: Minimum p75 throughput (tokens/sec)
        p90:
          type:
            - number
            - 'null'
          format: double
          description: Minimum p90 throughput (tokens/sec)
        p99:
          type:
            - number
            - 'null'
          format: double
          description: Minimum p99 throughput (tokens/sec)
      description: >-
        Percentile-based throughput cutoffs. All specified cutoffs must be met
        for an endpoint to be preferred.
      title: PercentileThroughputCutoffs
    PreferredMinThroughput:
      oneOf:
        - type: number
          format: double
        - $ref: '#/components/schemas/PercentileThroughputCutoffs'
        - description: Any type
      description: >-
        Preferred minimum throughput (in tokens per second). Can be a number
        (applies to p50) or an object with percentile-specific cutoffs.
        Endpoints below the threshold(s) may still be used, but are
        deprioritized in routing. When using fallback models, this may cause a
        fallback model to be used instead of the primary model if it meets the
        threshold.
      title: PreferredMinThroughput
    Quantization:
      type: string
      enum:
        - int4
        - int8
        - fp4
        - fp6
        - fp8
        - fp16
        - bf16
        - fp32
        - unknown
      title: Quantization
    ProviderSort:
      type: string
      enum:
        - price
        - throughput
        - latency
        - exacto
      description: The provider sorting strategy (price, throughput, latency)
      title: ProviderSort
    ProviderSortConfigBy:
      type: string
      enum:
        - price
        - throughput
        - latency
        - exacto
      description: The provider sorting strategy (price, throughput, latency)
      title: ProviderSortConfigBy
    ProviderSortConfigPartition:
      type: string
      enum:
        - model
        - none
      description: >-
        Partitioning strategy for sorting: "model" (default) groups endpoints by
        model before sorting (fallback models remain fallbacks), "none" sorts
        all endpoints together regardless of model.
      title: ProviderSortConfigPartition
    ProviderSortConfig:
      type: object
      properties:
        by:
          oneOf:
            - $ref: '#/components/schemas/ProviderSortConfigBy'
            - type: 'null'
          description: The provider sorting strategy (price, throughput, latency)
        partition:
          oneOf:
            - $ref: '#/components/schemas/ProviderSortConfigPartition'
            - type: 'null'
          description: >-
            Partitioning strategy for sorting: "model" (default) groups
            endpoints by model before sorting (fallback models remain
            fallbacks), "none" sorts all endpoints together regardless of model.
      description: The provider sorting strategy (price, throughput, latency)
      title: ProviderSortConfig
    ProviderPreferencesSort:
      oneOf:
        - $ref: '#/components/schemas/ProviderSort'
        - $ref: '#/components/schemas/ProviderSortConfig'
        - description: Any type
      description: >-
        The sorting strategy to use for this request, if "order" is not
        specified. When set, no load balancing is performed.
      title: ProviderPreferencesSort
    ProviderPreferences:
      type: object
      properties:
        allow_fallbacks:
          type:
            - boolean
            - 'null'
          description: >
            Whether to allow backup providers to serve requests

            - true: (default) when the primary provider (or your custom
            providers in "order") is unavailable, use the next best provider.

            - false: use only the primary/custom provider, and return the
            upstream error if it's unavailable.
        data_collection:
          oneOf:
            - $ref: '#/components/schemas/ProviderPreferencesDataCollection'
            - type: 'null'
          description: >-
            Data collection setting. If no available model provider meets the
            requirement, your request will return an error.

            - allow: (default) allow providers which store user data
            non-transiently and may train on it


            - deny: use only providers which do not collect user data.
        enforce_distillable_text:
          type:
            - boolean
            - 'null'
          description: >-
            Whether to restrict routing to only models that allow text
            distillation. When true, only models where the author has allowed
            distillation will be used.
        ignore:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/ProviderPreferencesIgnoreItems'
          description: >-
            List of provider slugs to ignore. If provided, this list is merged
            with your account-wide ignored provider settings for this request.
        max_price:
          $ref: '#/components/schemas/ProviderPreferencesMaxPrice'
          description: >-
            The object specifying the maximum price you want to pay for this
            request. USD price per million tokens, for prompt and completion.
        only:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/ProviderPreferencesOnlyItems'
          description: >-
            List of provider slugs to allow. If provided, this list is merged
            with your account-wide allowed provider settings for this request.
        order:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/ProviderPreferencesOrderItems'
          description: >-
            An ordered list of provider slugs. The router will attempt to use
            the first provider in the subset of this list that supports your
            requested model, and fall back to the next if it is unavailable. If
            no providers are available, the request will fail with an error
            message.
        preferred_max_latency:
          $ref: '#/components/schemas/PreferredMaxLatency'
        preferred_min_throughput:
          $ref: '#/components/schemas/PreferredMinThroughput'
        quantizations:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/Quantization'
          description: A list of quantization levels to filter the provider by.
        require_parameters:
          type:
            - boolean
            - 'null'
          description: >-
            Whether to filter providers to only those that support the
            parameters you've provided. If this setting is omitted or set to
            false, then providers will receive only the parameters they support,
            and ignore the rest.
        sort:
          $ref: '#/components/schemas/ProviderPreferencesSort'
          description: >-
            The sorting strategy to use for this request, if "order" is not
            specified. When set, no load balancing is performed.
        zdr:
          type:
            - boolean
            - 'null'
          description: >-
            Whether to restrict routing to only ZDR (Zero Data Retention)
            endpoints. When true, only endpoints that do not retain prompts will
            be used.
      description: >-
        When multiple model providers are available, optionally indicate your
        routing preference.
      title: ProviderPreferences
    ChatRequestReasoningEffort:
      type: string
      enum:
        - xhigh
        - high
        - medium
        - low
        - minimal
        - none
      description: Constrains effort on reasoning for reasoning models
      title: ChatRequestReasoningEffort
    ChatReasoningSummaryVerbosityEnum:
      type: string
      enum:
        - auto
        - concise
        - detailed
      title: ChatReasoningSummaryVerbosityEnum
    ChatRequestReasoning:
      type: object
      properties:
        effort:
          oneOf:
            - $ref: '#/components/schemas/ChatRequestReasoningEffort'
            - type: 'null'
          description: Constrains effort on reasoning for reasoning models
        summary:
          $ref: '#/components/schemas/ChatReasoningSummaryVerbosityEnum'
      description: Configuration options for reasoning models
      title: ChatRequestReasoning
    ChatFormatTextConfigType:
      type: string
      enum:
        - text
      title: ChatFormatTextConfigType
    ChatFormatTextConfig:
      type: object
      properties:
        type:
          $ref: '#/components/schemas/ChatFormatTextConfigType'
      required:
        - type
      description: Default text response format
      title: ChatFormatTextConfig
    FormatJsonObjectConfigType:
      type: string
      enum:
        - json_object
      title: FormatJsonObjectConfigType
    FormatJsonObjectConfig:
      type: object
      properties:
        type:
          $ref: '#/components/schemas/FormatJsonObjectConfigType'
      required:
        - type
      description: JSON object response format
      title: FormatJsonObjectConfig
    ChatJsonSchemaConfig:
      type: object
      properties:
        description:
          type: string
          description: Schema description for the model
        name:
          type: string
          description: Schema name (a-z, A-Z, 0-9, underscores, dashes, max 64 chars)
        schema:
          type: object
          additionalProperties:
            description: Any type
          description: JSON Schema object
        strict:
          type:
            - boolean
            - 'null'
          description: Enable strict schema adherence
      required:
        - name
      description: JSON Schema configuration object
      title: ChatJsonSchemaConfig
    ChatFormatJsonSchemaConfigType:
      type: string
      enum:
        - json_schema
      title: ChatFormatJsonSchemaConfigType
    ChatFormatJsonSchemaConfig:
      type: object
      properties:
        json_schema:
          $ref: '#/components/schemas/ChatJsonSchemaConfig'
        type:
          $ref: '#/components/schemas/ChatFormatJsonSchemaConfigType'
      required:
        - json_schema
        - type
      description: JSON Schema response format for structured outputs
      title: ChatFormatJsonSchemaConfig
    ChatFormatGrammarConfigType:
      type: string
      enum:
        - grammar
      title: ChatFormatGrammarConfigType
    ChatFormatGrammarConfig:
      type: object
      properties:
        grammar:
          type: string
          description: Custom grammar for text generation
        type:
          $ref: '#/components/schemas/ChatFormatGrammarConfigType'
      required:
        - grammar
        - type
      description: Custom grammar response format
      title: ChatFormatGrammarConfig
    ChatFormatPythonConfigType:
      type: string
      enum:
        - python
      title: ChatFormatPythonConfigType
    ChatFormatPythonConfig:
      type: object
      properties:
        type:
          $ref: '#/components/schemas/ChatFormatPythonConfigType'
      required:
        - type
      description: Python code response format
      title: ChatFormatPythonConfig
    ChatRequestResponseFormat:
      oneOf:
        - $ref: '#/components/schemas/ChatFormatTextConfig'
        - $ref: '#/components/schemas/FormatJsonObjectConfig'
        - $ref: '#/components/schemas/ChatFormatJsonSchemaConfig'
        - $ref: '#/components/schemas/ChatFormatGrammarConfig'
        - $ref: '#/components/schemas/ChatFormatPythonConfig'
      description: Response format configuration
      title: ChatRequestResponseFormat
    ChatRequestServiceTier:
      type: string
      enum:
        - auto
        - default
        - flex
        - priority
        - scale
      description: The service tier to use for processing this request.
      title: ChatRequestServiceTier
    ChatRequestStop:
      oneOf:
        - type: string
        - type: array
          items:
            type: string
        - description: Any type
      description: Stop sequences (up to 4)
      title: ChatRequestStop
    ChatStreamOptions:
      type: object
      properties:
        include_usage:
          type: boolean
          description: >-
            Deprecated: This field has no effect. Full usage details are always
            included.
      description: Streaming configuration options
      title: ChatStreamOptions
    ChatToolChoice0:
      type: string
      enum:
        - none
      title: ChatToolChoice0
    ChatToolChoice1:
      type: string
      enum:
        - auto
      title: ChatToolChoice1
    ChatToolChoice2:
      type: string
      enum:
        - required
      title: ChatToolChoice2
    ChatNamedToolChoiceFunction:
      type: object
      properties:
        name:
          type: string
          description: Function name to call
      required:
        - name
      title: ChatNamedToolChoiceFunction
    ChatNamedToolChoiceType:
      type: string
      enum:
        - function
      title: ChatNamedToolChoiceType
    ChatNamedToolChoice:
      type: object
      properties:
        function:
          $ref: '#/components/schemas/ChatNamedToolChoiceFunction'
        type:
          $ref: '#/components/schemas/ChatNamedToolChoiceType'
      required:
        - function
        - type
      description: Named tool choice for specific function
      title: ChatNamedToolChoice
    ChatToolChoice:
      oneOf:
        - $ref: '#/components/schemas/ChatToolChoice0'
        - $ref: '#/components/schemas/ChatToolChoice1'
        - $ref: '#/components/schemas/ChatToolChoice2'
        - $ref: '#/components/schemas/ChatNamedToolChoice'
      description: Tool choice configuration
      title: ChatToolChoice
    ChatFunctionToolOneOf0Function:
      type: object
      properties:
        description:
          type: string
          description: Function description for the model
        name:
          type: string
          description: Function name (a-z, A-Z, 0-9, underscores, dashes, max 64 chars)
        parameters:
          type: object
          additionalProperties:
            description: Any type
          description: Function parameters as JSON Schema object
        strict:
          type:
            - boolean
            - 'null'
          description: Enable strict schema adherence
      required:
        - name
      description: Function definition for tool calling
      title: ChatFunctionToolOneOf0Function
    ChatFunctionToolOneOf0Type:
      type: string
      enum:
        - function
      title: ChatFunctionToolOneOf0Type
    ChatFunctionTool0:
      type: object
      properties:
        cache_control:
          $ref: '#/components/schemas/ChatContentCacheControl'
        function:
          $ref: '#/components/schemas/ChatFunctionToolOneOf0Function'
          description: Function definition for tool calling
        type:
          $ref: '#/components/schemas/ChatFunctionToolOneOf0Type'
      required:
        - function
        - type
      title: ChatFunctionTool0
    DatetimeServerToolConfig:
      type: object
      properties:
        timezone:
          type: string
          description: IANA timezone name (e.g. "America/New_York"). Defaults to UTC.
      description: Configuration for the openrouter:datetime server tool
      title: DatetimeServerToolConfig
    DatetimeServerToolType:
      type: string
      enum:
        - openrouter:datetime
      title: DatetimeServerToolType
    DatetimeServerTool:
      type: object
      properties:
        parameters:
          $ref: '#/components/schemas/DatetimeServerToolConfig'
        type:
          $ref: '#/components/schemas/DatetimeServerToolType'
      required:
        - type
      description: 'OpenRouter built-in server tool: returns the current date and time'
      title: DatetimeServerTool
    ImageGenerationServerToolConfig:
      type: object
      properties:
        model:
          type: string
          description: >-
            Which image generation model to use (e.g. "openai/gpt-5-image").
            Defaults to "openai/gpt-5-image".
      description: >-
        Configuration for the openrouter:image_generation server tool. Accepts
        all image_config params (aspect_ratio, quality, size, background,
        output_format, output_compression, moderation, etc.) plus a model field.
      title: ImageGenerationServerToolConfig
    ImageGenerationServerToolOpenRouterType:
      type: string
      enum:
        - openrouter:image_generation
      title: ImageGenerationServerToolOpenRouterType
    ImageGenerationServerTool_OpenRouter:
      type: object
      properties:
        parameters:
          $ref: '#/components/schemas/ImageGenerationServerToolConfig'
        type:
          $ref: '#/components/schemas/ImageGenerationServerToolOpenRouterType'
      required:
        - type
      description: >-
        OpenRouter built-in server tool: generates images from text prompts
        using an image generation model
      title: ImageGenerationServerTool_OpenRouter
    SearchModelsServerToolConfig:
      type: object
      properties:
        max_results:
          type: integer
          description: Maximum number of models to return. Defaults to 5, max 20.
      description: Configuration for the openrouter:experimental__search_models server tool
      title: SearchModelsServerToolConfig
    ChatSearchModelsServerToolType:
      type: string
      enum:
        - openrouter:experimental__search_models
      title: ChatSearchModelsServerToolType
    ChatSearchModelsServerTool:
      type: object
      properties:
        parameters:
          $ref: '#/components/schemas/SearchModelsServerToolConfig'
        type:
          $ref: '#/components/schemas/ChatSearchModelsServerToolType'
      required:
        - type
      description: >-
        OpenRouter built-in server tool: searches and filters AI models
        available on OpenRouter
      title: ChatSearchModelsServerTool
    WebSearchEngineEnum:
      type: string
      enum:
        - auto
        - native
        - exa
        - firecrawl
        - parallel
      description: >-
        Which search engine to use. "auto" (default) uses native if the provider
        supports it, otherwise Exa. "native" forces the provider's built-in
        search. "exa" forces the Exa search API. "firecrawl" uses Firecrawl
        (requires BYOK). "parallel" uses the Parallel search API.
      title: WebSearchEngineEnum
    SearchQualityLevel:
      type: string
      enum:
        - low
        - medium
        - high
      description: >-
        How much context to retrieve per result. Defaults to medium (15000
        chars). Only applies when using the Exa engine; ignored with native
        provider search.
      title: SearchQualityLevel
    WebSearchUserLocationServerToolType:
      type: string
      enum:
        - approximate
      title: WebSearchUserLocationServerToolType
    WebSearchUserLocationServerTool:
      type: object
      properties:
        city:
          type: string
        country:
          type: string
        region:
          type: string
        timezone:
          type: string
        type:
          $ref: '#/components/schemas/WebSearchUserLocationServerToolType'
      description: Approximate user location for location-biased results.
      title: WebSearchUserLocationServerTool
    WebSearchConfig:
      type: object
      properties:
        allowed_domains:
          type: array
          items:
            type: string
          description: >-
            Limit search results to these domains. Supported by Exa, Parallel,
            and most native providers (Anthropic, OpenAI, xAI). Not supported
            with Firecrawl or Perplexity.
        engine:
          $ref: '#/components/schemas/WebSearchEngineEnum'
        excluded_domains:
          type: array
          items:
            type: string
          description: >-
            Exclude search results from these domains. Supported by Exa,
            Parallel, Anthropic, and xAI. Not supported with Firecrawl, OpenAI
            (silently ignored), or Perplexity.
        max_results:
          type: integer
          description: >-
            Maximum number of search results to return per search call. Defaults
            to 5. Applies to Exa, Firecrawl, and Parallel engines; ignored with
            native provider search.
        max_total_results:
          type: integer
          description: >-
            Maximum total number of search results across all search calls in a
            single request. Once this limit is reached, the tool will stop
            returning new results. Useful for controlling cost and context size
            in agentic loops.
        search_context_size:
          $ref: '#/components/schemas/SearchQualityLevel'
        user_location:
          $ref: '#/components/schemas/WebSearchUserLocationServerTool'
      title: WebSearchConfig
    OpenRouterWebSearchServerToolType:
      type: string
      enum:
        - openrouter:web_search
      title: OpenRouterWebSearchServerToolType
    OpenRouterWebSearchServerTool:
      type: object
      properties:
        parameters:
          $ref: '#/components/schemas/WebSearchConfig'
        type:
          $ref: '#/components/schemas/OpenRouterWebSearchServerToolType'
      required:
        - type
      description: >-
        OpenRouter built-in server tool: searches the web for current
        information
      title: OpenRouterWebSearchServerTool
    ChatWebSearchShorthandType:
      type: string
      enum:
        - web_search
        - web_search_preview
        - web_search_preview_2025_03_11
        - web_search_2025_08_26
      title: ChatWebSearchShorthandType
    ChatWebSearchShorthand:
      type: object
      properties:
        allowed_domains:
          type: array
          items:
            type: string
          description: >-
            Limit search results to these domains. Supported by Exa, Parallel,
            and most native providers (Anthropic, OpenAI, xAI). Not supported
            with Firecrawl or Perplexity.
        engine:
          $ref: '#/components/schemas/WebSearchEngineEnum'
        excluded_domains:
          type: array
          items:
            type: string
          description: >-
            Exclude search results from these domains. Supported by Exa,
            Parallel, Anthropic, and xAI. Not supported with Firecrawl, OpenAI
            (silently ignored), or Perplexity.
        max_results:
          type: integer
          description: >-
            Maximum number of search results to return per search call. Defaults
            to 5. Applies to Exa, Firecrawl, and Parallel engines; ignored with
            native provider search.
        max_total_results:
          type: integer
          description: >-
            Maximum total number of search results across all search calls in a
            single request. Once this limit is reached, the tool will stop
            returning new results. Useful for controlling cost and context size
            in agentic loops.
        parameters:
          $ref: '#/components/schemas/WebSearchConfig'
        search_context_size:
          $ref: '#/components/schemas/SearchQualityLevel'
        type:
          $ref: '#/components/schemas/ChatWebSearchShorthandType'
        user_location:
          $ref: '#/components/schemas/WebSearchUserLocationServerTool'
      required:
        - type
      description: >-
        Web search tool using OpenAI Responses API syntax. Automatically
        converted to openrouter:web_search.
      title: ChatWebSearchShorthand
    ChatFunctionTool:
      oneOf:
        - $ref: '#/components/schemas/ChatFunctionTool0'
        - $ref: '#/components/schemas/DatetimeServerTool'
        - $ref: '#/components/schemas/ImageGenerationServerTool_OpenRouter'
        - $ref: '#/components/schemas/ChatSearchModelsServerTool'
        - $ref: '#/components/schemas/OpenRouterWebSearchServerTool'
        - $ref: '#/components/schemas/ChatWebSearchShorthand'
      description: >-
        Tool definition for function calling (regular function or OpenRouter
        built-in server tool)
      title: ChatFunctionTool
    TraceConfig:
      type: object
      properties:
        generation_name:
          type: string
        parent_span_id:
          type: string
        span_name:
          type: string
        trace_id:
          type: string
        trace_name:
          type: string
      description: >-
        Metadata for observability and tracing. Known keys (trace_id,
        trace_name, span_name, generation_name, parent_span_id) have special
        handling. Additional keys are passed through as custom metadata to
        configured broadcast destinations.
      title: TraceConfig
    ChatRequest:
      type: object
      properties:
        cache_control:
          $ref: '#/components/schemas/ChatRequestCacheControl'
        debug:
          $ref: '#/components/schemas/ChatDebugOptions'
        frequency_penalty:
          type:
            - number
            - 'null'
          format: double
          description: Frequency penalty (-2.0 to 2.0)
        image_config:
          $ref: '#/components/schemas/ImageConfig'
        logit_bias:
          type:
            - object
            - 'null'
          additionalProperties:
            type: number
            format: double
          description: Token logit bias adjustments
        logprobs:
          type:
            - boolean
            - 'null'
          description: Return log probabilities
        max_completion_tokens:
          type:
            - integer
            - 'null'
          description: Maximum tokens in completion
        max_tokens:
          type:
            - integer
            - 'null'
          description: >-
            Maximum tokens (deprecated, use max_completion_tokens). Note: some
            providers enforce a minimum of 16.
        messages:
          type: array
          items:
            $ref: '#/components/schemas/ChatMessages'
          description: List of messages for the conversation
        metadata:
          type: object
          additionalProperties:
            type: string
          description: >-
            Key-value pairs for additional object information (max 16 pairs, 64
            char keys, 512 char values)
        modalities:
          type: array
          items:
            $ref: '#/components/schemas/ChatRequestModalitiesItems'
          description: >-
            Output modalities for the response. Supported values are "text",
            "image", and "audio".
        model:
          $ref: '#/components/schemas/ModelName'
        models:
          $ref: '#/components/schemas/ChatModelNames'
        parallel_tool_calls:
          type:
            - boolean
            - 'null'
          description: >-
            Whether to enable parallel function calling during tool use. When
            true, the model may generate multiple tool calls in a single
            response.
        plugins:
          type: array
          items:
            $ref: '#/components/schemas/ChatRequestPluginsItems'
          description: >-
            Plugins you want to enable for this request, including their
            settings.
        presence_penalty:
          type:
            - number
            - 'null'
          format: double
          description: Presence penalty (-2.0 to 2.0)
        provider:
          $ref: '#/components/schemas/ProviderPreferences'
        reasoning:
          $ref: '#/components/schemas/ChatRequestReasoning'
          description: Configuration options for reasoning models
        response_format:
          $ref: '#/components/schemas/ChatRequestResponseFormat'
          description: Response format configuration
        route:
          description: Any type
        seed:
          type:
            - integer
            - 'null'
          description: Random seed for deterministic outputs
        service_tier:
          oneOf:
            - $ref: '#/components/schemas/ChatRequestServiceTier'
            - type: 'null'
          description: The service tier to use for processing this request.
        session_id:
          type: string
          description: >-
            A unique identifier for grouping related requests (e.g., a
            conversation or agent workflow) for observability. If provided in
            both the request body and the x-session-id header, the body value
            takes precedence. Maximum of 256 characters.
        stop:
          $ref: '#/components/schemas/ChatRequestStop'
          description: Stop sequences (up to 4)
        stream:
          type: boolean
          default: false
          description: Enable streaming response
        stream_options:
          $ref: '#/components/schemas/ChatStreamOptions'
        temperature:
          type:
            - number
            - 'null'
          format: double
          description: Sampling temperature (0-2)
        tool_choice:
          $ref: '#/components/schemas/ChatToolChoice'
        tools:
          type: array
          items:
            $ref: '#/components/schemas/ChatFunctionTool'
          description: Available tools for function calling
        top_logprobs:
          type:
            - integer
            - 'null'
          description: Number of top log probabilities to return (0-20)
        top_p:
          type:
            - number
            - 'null'
          format: double
          description: Nucleus sampling parameter (0-1)
        trace:
          $ref: '#/components/schemas/TraceConfig'
        user:
          type: string
          description: Unique user identifier
      required:
        - messages
      description: Chat completion request parameters
      title: ChatRequest
    ChatFinishReasonEnum:
      type: string
      enum:
        - tool_calls
        - stop
        - length
        - content_filter
        - error
      title: ChatFinishReasonEnum
    ChatTokenLogprobTopLogprobsItems:
      type: object
      properties:
        bytes:
          type:
            - array
            - 'null'
          items:
            type: integer
        logprob:
          type: number
          format: double
        token:
          type: string
      required:
        - bytes
        - logprob
        - token
      title: ChatTokenLogprobTopLogprobsItems
    ChatTokenLogprob:
      type: object
      properties:
        bytes:
          type:
            - array
            - 'null'
          items:
            type: integer
          description: UTF-8 bytes of the token
        logprob:
          type: number
          format: double
          description: Log probability of the token
        token:
          type: string
          description: The token
        top_logprobs:
          type: array
          items:
            $ref: '#/components/schemas/ChatTokenLogprobTopLogprobsItems'
          description: Top alternative tokens with probabilities
      required:
        - bytes
        - logprob
        - token
        - top_logprobs
      description: Token log probability information
      title: ChatTokenLogprob
    ChatTokenLogprobs:
      type: object
      properties:
        content:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/ChatTokenLogprob'
          description: Log probabilities for content tokens
        refusal:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/ChatTokenLogprob'
          description: Log probabilities for refusal tokens
      required:
        - content
      description: Log probabilities for the completion
      title: ChatTokenLogprobs
    ChatChoice:
      type: object
      properties:
        finish_reason:
          $ref: '#/components/schemas/ChatFinishReasonEnum'
        index:
          type: integer
          description: Choice index
        logprobs:
          $ref: '#/components/schemas/ChatTokenLogprobs'
        message:
          $ref: '#/components/schemas/ChatAssistantMessage'
      required:
        - finish_reason
        - index
        - message
      description: Chat completion choice
      title: ChatChoice
    ChatResultObject:
      type: string
      enum:
        - chat.completion
      title: ChatResultObject
    ChatUsageCompletionTokensDetails:
      type: object
      properties:
        accepted_prediction_tokens:
          type:
            - integer
            - 'null'
          description: Accepted prediction tokens
        audio_tokens:
          type:
            - integer
            - 'null'
          description: Tokens used for audio output
        reasoning_tokens:
          type:
            - integer
            - 'null'
          description: Tokens used for reasoning
        rejected_prediction_tokens:
          type:
            - integer
            - 'null'
          description: Rejected prediction tokens
      description: Detailed completion token usage
      title: ChatUsageCompletionTokensDetails
    ChatUsagePromptTokensDetails:
      type: object
      properties:
        audio_tokens:
          type: integer
          description: Audio input tokens
        cache_write_tokens:
          type: integer
          description: >-
            Tokens written to cache. Only returned for models with explicit
            caching and cache write pricing.
        cached_tokens:
          type: integer
          description: Cached prompt tokens
        video_tokens:
          type: integer
          description: Video input tokens
      description: Detailed prompt token usage
      title: ChatUsagePromptTokensDetails
    ChatUsage:
      type: object
      properties:
        completion_tokens:
          type: integer
          description: Number of tokens in the completion
        completion_tokens_details:
          oneOf:
            - $ref: '#/components/schemas/ChatUsageCompletionTokensDetails'
            - type: 'null'
          description: Detailed completion token usage
        prompt_tokens:
          type: integer
          description: Number of tokens in the prompt
        prompt_tokens_details:
          oneOf:
            - $ref: '#/components/schemas/ChatUsagePromptTokensDetails'
            - type: 'null'
          description: Detailed prompt token usage
        total_tokens:
          type: integer
          description: Total number of tokens
      required:
        - completion_tokens
        - prompt_tokens
        - total_tokens
      description: Token usage statistics
      title: ChatUsage
    ChatResult:
      type: object
      properties:
        choices:
          type: array
          items:
            $ref: '#/components/schemas/ChatChoice'
          description: List of completion choices
        created:
          type: integer
          description: Unix timestamp of creation
        id:
          type: string
          description: Unique completion identifier
        model:
          type: string
          description: Model used for completion
        object:
          $ref: '#/components/schemas/ChatResultObject'
        service_tier:
          type:
            - string
            - 'null'
          description: The service tier used by the upstream provider for this request
        system_fingerprint:
          type:
            - string
            - 'null'
          description: System fingerprint
        usage:
          $ref: '#/components/schemas/ChatUsage'
      required:
        - choices
        - created
        - id
        - model
        - object
        - system_fingerprint
      description: Chat completion response
      title: ChatResult
    BadRequestResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for BadRequestResponse
      title: BadRequestResponseErrorData
    BadRequestResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/BadRequestResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Bad Request - Invalid request parameters or malformed input
      title: BadRequestResponse
    UnauthorizedResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for UnauthorizedResponse
      title: UnauthorizedResponseErrorData
    UnauthorizedResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/UnauthorizedResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Unauthorized - Authentication required or invalid credentials
      title: UnauthorizedResponse
    PaymentRequiredResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for PaymentRequiredResponse
      title: PaymentRequiredResponseErrorData
    PaymentRequiredResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/PaymentRequiredResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Payment Required - Insufficient credits or quota to complete request
      title: PaymentRequiredResponse
    NotFoundResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for NotFoundResponse
      title: NotFoundResponseErrorData
    NotFoundResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/NotFoundResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Not Found - Resource does not exist
      title: NotFoundResponse
    RequestTimeoutResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for RequestTimeoutResponse
      title: RequestTimeoutResponseErrorData
    RequestTimeoutResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/RequestTimeoutResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Request Timeout - Operation exceeded time limit
      title: RequestTimeoutResponse
    PayloadTooLargeResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for PayloadTooLargeResponse
      title: PayloadTooLargeResponseErrorData
    PayloadTooLargeResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/PayloadTooLargeResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Payload Too Large - Request payload exceeds size limits
      title: PayloadTooLargeResponse
    UnprocessableEntityResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for UnprocessableEntityResponse
      title: UnprocessableEntityResponseErrorData
    UnprocessableEntityResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/UnprocessableEntityResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Unprocessable Entity - Semantic validation failure
      title: UnprocessableEntityResponse
    TooManyRequestsResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for TooManyRequestsResponse
      title: TooManyRequestsResponseErrorData
    TooManyRequestsResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/TooManyRequestsResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Too Many Requests - Rate limit exceeded
      title: TooManyRequestsResponse
    InternalServerResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for InternalServerResponse
      title: InternalServerResponseErrorData
    InternalServerResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/InternalServerResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Internal Server Error - Unexpected server error
      title: InternalServerResponse
    BadGatewayResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for BadGatewayResponse
      title: BadGatewayResponseErrorData
    BadGatewayResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/BadGatewayResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Bad Gateway - Provider/upstream API failure
      title: BadGatewayResponse
    ServiceUnavailableResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for ServiceUnavailableResponse
      title: ServiceUnavailableResponseErrorData
    ServiceUnavailableResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/ServiceUnavailableResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Service Unavailable - Service temporarily unavailable
      title: ServiceUnavailableResponse
  securitySchemes:
    apiKey:
      type: http
      scheme: bearer
      description: API key as bearer token in Authorization header

```

## SDK Code Examples

```python
import requests

url = "https://openrouter.ai/api/v1/chat/completions"

payload = {
    "messages": [
        {
            "content": "You are a helpful assistant.",
            "role": "system"
        },
        {
            "content": "What is the capital of France?",
            "role": "user"
        }
    ],
    "max_tokens": 150,
    "model": "openai/gpt-4",
    "temperature": 0.7
}
headers = {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
}

response = requests.post(url, json=payload, headers=headers)

print(response.json())
```

```javascript
const url = 'https://openrouter.ai/api/v1/chat/completions';
const options = {
  method: 'POST',
  headers: {Authorization: 'Bearer <token>', 'Content-Type': 'application/json'},
  body: '{"messages":[{"content":"You are a helpful assistant.","role":"system"},{"content":"What is the capital of France?","role":"user"}],"max_tokens":150,"model":"openai/gpt-4","temperature":0.7}'
};

try {
  const response = await fetch(url, options);
  const data = await response.json();
  console.log(data);
} catch (error) {
  console.error(error);
}
```

```go
package main

import (
	"fmt"
	"strings"
	"net/http"
	"io"
)

func main() {

	url := "https://openrouter.ai/api/v1/chat/completions"

	payload := strings.NewReader("{\n  \"messages\": [\n    {\n      \"content\": \"You are a helpful assistant.\",\n      \"role\": \"system\"\n    },\n    {\n      \"content\": \"What is the capital of France?\",\n      \"role\": \"user\"\n    }\n  ],\n  \"max_tokens\": 150,\n  \"model\": \"openai/gpt-4\",\n  \"temperature\": 0.7\n}")

	req, _ := http.NewRequest("POST", url, payload)

	req.Header.Add("Authorization", "Bearer <token>")
	req.Header.Add("Content-Type", "application/json")

	res, _ := http.DefaultClient.Do(req)

	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)

	fmt.Println(res)
	fmt.Println(string(body))

}
```

```ruby
require 'uri'
require 'net/http'

url = URI("https://openrouter.ai/api/v1/chat/completions")

http = Net::HTTP.new(url.host, url.port)
http.use_ssl = true

request = Net::HTTP::Post.new(url)
request["Authorization"] = 'Bearer <token>'
request["Content-Type"] = 'application/json'
request.body = "{\n  \"messages\": [\n    {\n      \"content\": \"You are a helpful assistant.\",\n      \"role\": \"system\"\n    },\n    {\n      \"content\": \"What is the capital of France?\",\n      \"role\": \"user\"\n    }\n  ],\n  \"max_tokens\": 150,\n  \"model\": \"openai/gpt-4\",\n  \"temperature\": 0.7\n}"

response = http.request(request)
puts response.read_body
```

```java
import com.mashape.unirest.http.HttpResponse;
import com.mashape.unirest.http.Unirest;

HttpResponse<String> response = Unirest.post("https://openrouter.ai/api/v1/chat/completions")
  .header("Authorization", "Bearer <token>")
  .header("Content-Type", "application/json")
  .body("{\n  \"messages\": [\n    {\n      \"content\": \"You are a helpful assistant.\",\n      \"role\": \"system\"\n    },\n    {\n      \"content\": \"What is the capital of France?\",\n      \"role\": \"user\"\n    }\n  ],\n  \"max_tokens\": 150,\n  \"model\": \"openai/gpt-4\",\n  \"temperature\": 0.7\n}")
  .asString();
```

```php
<?php
require_once('vendor/autoload.php');

$client = new \GuzzleHttp\Client();

$response = $client->request('POST', 'https://openrouter.ai/api/v1/chat/completions', [
  'body' => '{
  "messages": [
    {
      "content": "You are a helpful assistant.",
      "role": "system"
    },
    {
      "content": "What is the capital of France?",
      "role": "user"
    }
  ],
  "max_tokens": 150,
  "model": "openai/gpt-4",
  "temperature": 0.7
}',
  'headers' => [
    'Authorization' => 'Bearer <token>',
    'Content-Type' => 'application/json',
  ],
]);

echo $response->getBody();
```

```csharp
using RestSharp;

var client = new RestClient("https://openrouter.ai/api/v1/chat/completions");
var request = new RestRequest(Method.POST);
request.AddHeader("Authorization", "Bearer <token>");
request.AddHeader("Content-Type", "application/json");
request.AddParameter("application/json", "{\n  \"messages\": [\n    {\n      \"content\": \"You are a helpful assistant.\",\n      \"role\": \"system\"\n    },\n    {\n      \"content\": \"What is the capital of France?\",\n      \"role\": \"user\"\n    }\n  ],\n  \"max_tokens\": 150,\n  \"model\": \"openai/gpt-4\",\n  \"temperature\": 0.7\n}", ParameterType.RequestBody);
IRestResponse response = client.Execute(request);
```

```swift
import Foundation

let headers = [
  "Authorization": "Bearer <token>",
  "Content-Type": "application/json"
]
let parameters = [
  "messages": [
    [
      "content": "You are a helpful assistant.",
      "role": "system"
    ],
    [
      "content": "What is the capital of France?",
      "role": "user"
    ]
  ],
  "max_tokens": 150,
  "model": "openai/gpt-4",
  "temperature": 0.7
] as [String : Any]

let postData = JSONSerialization.data(withJSONObject: parameters, options: [])

let request = NSMutableURLRequest(url: NSURL(string: "https://openrouter.ai/api/v1/chat/completions")! as URL,
                                        cachePolicy: .useProtocolCachePolicy,
                                    timeoutInterval: 10.0)
request.httpMethod = "POST"
request.allHTTPHeaderFields = headers
request.httpBody = postData as Data

let session = URLSession.shared
let dataTask = session.dataTask(with: request as URLRequest, completionHandler: { (data, response, error) -> Void in
  if (error != nil) {
    print(error as Any)
  } else {
    let httpResponse = response as? HTTPURLResponse
    print(httpResponse)
  }
})

dataTask.resume()
```# Submit an embedding request

POST https://openrouter.ai/api/v1/embeddings
Content-Type: application/json

Submits an embedding request to the embeddings router

Reference: https://openrouter.ai/docs/api/api-reference/embeddings/create-embeddings

## OpenAPI Specification

```yaml
openapi: 3.1.0
info:
  title: OpenRouter API
  version: 1.0.0
paths:
  /embeddings:
    post:
      operationId: create-embeddings
      summary: Submit an embedding request
      description: Submits an embedding request to the embeddings router
      tags:
        - subpackage_embeddings
      parameters:
        - name: Authorization
          in: header
          description: API key as bearer token in Authorization header
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Embedding response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Embeddings_createEmbeddings_Response_200'
        '400':
          description: Bad Request - Invalid request parameters or malformed input
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BadRequestResponse'
        '401':
          description: Unauthorized - Authentication required or invalid credentials
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UnauthorizedResponse'
        '402':
          description: Payment Required - Insufficient credits or quota to complete request
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PaymentRequiredResponse'
        '404':
          description: Not Found - Resource does not exist
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/NotFoundResponse'
        '429':
          description: Too Many Requests - Rate limit exceeded
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TooManyRequestsResponse'
        '500':
          description: Internal Server Error - Unexpected server error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/InternalServerResponse'
        '502':
          description: Bad Gateway - Provider/upstream API failure
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BadGatewayResponse'
        '503':
          description: Service Unavailable - Service temporarily unavailable
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ServiceUnavailableResponse'
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                dimensions:
                  type: integer
                  description: The number of dimensions for the output embeddings
                encoding_format:
                  $ref: >-
                    #/components/schemas/EmbeddingsPostRequestBodyContentApplicationJsonSchemaEncodingFormat
                  description: The format of the output embeddings
                input:
                  $ref: >-
                    #/components/schemas/EmbeddingsPostRequestBodyContentApplicationJsonSchemaInput
                  description: Text, token, or multimodal input(s) to embed
                input_type:
                  type: string
                  description: The type of input (e.g. search_query, search_document)
                model:
                  type: string
                  description: The model to use for embeddings
                provider:
                  $ref: >-
                    #/components/schemas/EmbeddingsPostRequestBodyContentApplicationJsonSchemaProvider
                user:
                  type: string
                  description: A unique identifier for the end-user
              required:
                - input
                - model
servers:
  - url: https://openrouter.ai/api/v1
components:
  schemas:
    EmbeddingsPostRequestBodyContentApplicationJsonSchemaEncodingFormat:
      type: string
      enum:
        - float
        - base64
      description: The format of the output embeddings
      title: EmbeddingsPostRequestBodyContentApplicationJsonSchemaEncodingFormat
    EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4ItemsContentItemsOneOf0Type:
      type: string
      enum:
        - text
      title: >-
        EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4ItemsContentItemsOneOf0Type
    EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4ItemsContentItems0:
      type: object
      properties:
        text:
          type: string
        type:
          $ref: >-
            #/components/schemas/EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4ItemsContentItemsOneOf0Type
      required:
        - text
        - type
      title: >-
        EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4ItemsContentItems0
    EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4ItemsContentItemsOneOf1ImageUrl:
      type: object
      properties:
        url:
          type: string
      required:
        - url
      title: >-
        EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4ItemsContentItemsOneOf1ImageUrl
    EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4ItemsContentItemsOneOf1Type:
      type: string
      enum:
        - image_url
      title: >-
        EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4ItemsContentItemsOneOf1Type
    EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4ItemsContentItems1:
      type: object
      properties:
        image_url:
          $ref: >-
            #/components/schemas/EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4ItemsContentItemsOneOf1ImageUrl
        type:
          $ref: >-
            #/components/schemas/EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4ItemsContentItemsOneOf1Type
      required:
        - image_url
        - type
      title: >-
        EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4ItemsContentItems1
    EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4ItemsContentItems:
      oneOf:
        - $ref: >-
            #/components/schemas/EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4ItemsContentItems0
        - $ref: >-
            #/components/schemas/EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4ItemsContentItems1
      title: >-
        EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4ItemsContentItems
    EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4Items:
      type: object
      properties:
        content:
          type: array
          items:
            $ref: >-
              #/components/schemas/EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4ItemsContentItems
      required:
        - content
      title: EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4Items
    EmbeddingsPostRequestBodyContentApplicationJsonSchemaInput4:
      type: array
      items:
        $ref: >-
          #/components/schemas/EmbeddingsPostRequestBodyContentApplicationJsonSchemaInputOneOf4Items
      title: EmbeddingsPostRequestBodyContentApplicationJsonSchemaInput4
    EmbeddingsPostRequestBodyContentApplicationJsonSchemaInput:
      oneOf:
        - type: string
        - type: array
          items:
            type: string
        - type: array
          items:
            type: number
            format: double
        - type: array
          items:
            type: array
            items:
              type: number
              format: double
        - $ref: >-
            #/components/schemas/EmbeddingsPostRequestBodyContentApplicationJsonSchemaInput4
      description: Text, token, or multimodal input(s) to embed
      title: EmbeddingsPostRequestBodyContentApplicationJsonSchemaInput
    ProviderPreferencesDataCollection:
      type: string
      enum:
        - deny
        - allow
      description: >-
        Data collection setting. If no available model provider meets the
        requirement, your request will return an error.

        - allow: (default) allow providers which store user data non-transiently
        and may train on it


        - deny: use only providers which do not collect user data.
      title: ProviderPreferencesDataCollection
    ProviderName:
      type: string
      enum:
        - AkashML
        - AI21
        - AionLabs
        - Alibaba
        - Ambient
        - Baidu
        - Amazon Bedrock
        - Amazon Nova
        - Anthropic
        - Arcee AI
        - AtlasCloud
        - Avian
        - Azure
        - BaseTen
        - BytePlus
        - Black Forest Labs
        - Cerebras
        - Chutes
        - Cirrascale
        - Clarifai
        - Cloudflare
        - Cohere
        - Crusoe
        - DeepInfra
        - DeepSeek
        - DekaLLM
        - Featherless
        - Fireworks
        - Friendli
        - GMICloud
        - Google
        - Google AI Studio
        - Groq
        - Hyperbolic
        - Inception
        - Inceptron
        - InferenceNet
        - Ionstream
        - Infermatic
        - Io Net
        - Inflection
        - Liquid
        - Mara
        - Mancer 2
        - Minimax
        - ModelRun
        - Mistral
        - Modular
        - Moonshot AI
        - Morph
        - NCompass
        - Nebius
        - NextBit
        - Novita
        - Nvidia
        - OpenAI
        - OpenInference
        - Parasail
        - Perplexity
        - Phala
        - Recraft
        - Reka
        - Relace
        - SambaNova
        - Seed
        - SiliconFlow
        - Sourceful
        - StepFun
        - Stealth
        - StreamLake
        - Switchpoint
        - Together
        - Upstage
        - Venice
        - WandB
        - Xiaomi
        - xAI
        - Z.AI
        - FakeProvider
      title: ProviderName
    ProviderPreferencesIgnoreItems:
      oneOf:
        - $ref: '#/components/schemas/ProviderName'
        - type: string
      title: ProviderPreferencesIgnoreItems
    ProviderPreferencesMaxPriceAudio:
      type: object
      properties: {}
      title: ProviderPreferencesMaxPriceAudio
    ProviderPreferencesMaxPriceCompletion:
      type: object
      properties: {}
      title: ProviderPreferencesMaxPriceCompletion
    ProviderPreferencesMaxPriceImage:
      type: object
      properties: {}
      title: ProviderPreferencesMaxPriceImage
    BigNumberUnion:
      type: string
      description: Price per million prompt tokens
      title: BigNumberUnion
    ProviderPreferencesMaxPriceRequest:
      type: object
      properties: {}
      title: ProviderPreferencesMaxPriceRequest
    ProviderPreferencesMaxPrice:
      type: object
      properties:
        audio:
          $ref: '#/components/schemas/ProviderPreferencesMaxPriceAudio'
        completion:
          $ref: '#/components/schemas/ProviderPreferencesMaxPriceCompletion'
        image:
          $ref: '#/components/schemas/ProviderPreferencesMaxPriceImage'
        prompt:
          $ref: '#/components/schemas/BigNumberUnion'
        request:
          $ref: '#/components/schemas/ProviderPreferencesMaxPriceRequest'
      description: >-
        The object specifying the maximum price you want to pay for this
        request. USD price per million tokens, for prompt and completion.
      title: ProviderPreferencesMaxPrice
    ProviderPreferencesOnlyItems:
      oneOf:
        - $ref: '#/components/schemas/ProviderName'
        - type: string
      title: ProviderPreferencesOnlyItems
    ProviderPreferencesOrderItems:
      oneOf:
        - $ref: '#/components/schemas/ProviderName'
        - type: string
      title: ProviderPreferencesOrderItems
    PercentileLatencyCutoffs:
      type: object
      properties:
        p50:
          type:
            - number
            - 'null'
          format: double
          description: Maximum p50 latency (seconds)
        p75:
          type:
            - number
            - 'null'
          format: double
          description: Maximum p75 latency (seconds)
        p90:
          type:
            - number
            - 'null'
          format: double
          description: Maximum p90 latency (seconds)
        p99:
          type:
            - number
            - 'null'
          format: double
          description: Maximum p99 latency (seconds)
      description: >-
        Percentile-based latency cutoffs. All specified cutoffs must be met for
        an endpoint to be preferred.
      title: PercentileLatencyCutoffs
    PreferredMaxLatency:
      oneOf:
        - type: number
          format: double
        - $ref: '#/components/schemas/PercentileLatencyCutoffs'
        - description: Any type
      description: >-
        Preferred maximum latency (in seconds). Can be a number (applies to p50)
        or an object with percentile-specific cutoffs. Endpoints above the
        threshold(s) may still be used, but are deprioritized in routing. When
        using fallback models, this may cause a fallback model to be used
        instead of the primary model if it meets the threshold.
      title: PreferredMaxLatency
    PercentileThroughputCutoffs:
      type: object
      properties:
        p50:
          type:
            - number
            - 'null'
          format: double
          description: Minimum p50 throughput (tokens/sec)
        p75:
          type:
            - number
            - 'null'
          format: double
          description: Minimum p75 throughput (tokens/sec)
        p90:
          type:
            - number
            - 'null'
          format: double
          description: Minimum p90 throughput (tokens/sec)
        p99:
          type:
            - number
            - 'null'
          format: double
          description: Minimum p99 throughput (tokens/sec)
      description: >-
        Percentile-based throughput cutoffs. All specified cutoffs must be met
        for an endpoint to be preferred.
      title: PercentileThroughputCutoffs
    PreferredMinThroughput:
      oneOf:
        - type: number
          format: double
        - $ref: '#/components/schemas/PercentileThroughputCutoffs'
        - description: Any type
      description: >-
        Preferred minimum throughput (in tokens per second). Can be a number
        (applies to p50) or an object with percentile-specific cutoffs.
        Endpoints below the threshold(s) may still be used, but are
        deprioritized in routing. When using fallback models, this may cause a
        fallback model to be used instead of the primary model if it meets the
        threshold.
      title: PreferredMinThroughput
    Quantization:
      type: string
      enum:
        - int4
        - int8
        - fp4
        - fp6
        - fp8
        - fp16
        - bf16
        - fp32
        - unknown
      title: Quantization
    ProviderSort:
      type: string
      enum:
        - price
        - throughput
        - latency
        - exacto
      description: The provider sorting strategy (price, throughput, latency)
      title: ProviderSort
    ProviderSortConfigBy:
      type: string
      enum:
        - price
        - throughput
        - latency
        - exacto
      description: The provider sorting strategy (price, throughput, latency)
      title: ProviderSortConfigBy
    ProviderSortConfigPartition:
      type: string
      enum:
        - model
        - none
      description: >-
        Partitioning strategy for sorting: "model" (default) groups endpoints by
        model before sorting (fallback models remain fallbacks), "none" sorts
        all endpoints together regardless of model.
      title: ProviderSortConfigPartition
    ProviderSortConfig:
      type: object
      properties:
        by:
          oneOf:
            - $ref: '#/components/schemas/ProviderSortConfigBy'
            - type: 'null'
          description: The provider sorting strategy (price, throughput, latency)
        partition:
          oneOf:
            - $ref: '#/components/schemas/ProviderSortConfigPartition'
            - type: 'null'
          description: >-
            Partitioning strategy for sorting: "model" (default) groups
            endpoints by model before sorting (fallback models remain
            fallbacks), "none" sorts all endpoints together regardless of model.
      description: The provider sorting strategy (price, throughput, latency)
      title: ProviderSortConfig
    ProviderPreferencesSort:
      oneOf:
        - $ref: '#/components/schemas/ProviderSort'
        - $ref: '#/components/schemas/ProviderSortConfig'
        - description: Any type
      description: >-
        The sorting strategy to use for this request, if "order" is not
        specified. When set, no load balancing is performed.
      title: ProviderPreferencesSort
    EmbeddingsPostRequestBodyContentApplicationJsonSchemaProvider:
      type: object
      properties:
        allow_fallbacks:
          type:
            - boolean
            - 'null'
          description: >
            Whether to allow backup providers to serve requests

            - true: (default) when the primary provider (or your custom
            providers in "order") is unavailable, use the next best provider.

            - false: use only the primary/custom provider, and return the
            upstream error if it's unavailable.
        data_collection:
          oneOf:
            - $ref: '#/components/schemas/ProviderPreferencesDataCollection'
            - type: 'null'
          description: >-
            Data collection setting. If no available model provider meets the
            requirement, your request will return an error.

            - allow: (default) allow providers which store user data
            non-transiently and may train on it


            - deny: use only providers which do not collect user data.
        enforce_distillable_text:
          type:
            - boolean
            - 'null'
          description: >-
            Whether to restrict routing to only models that allow text
            distillation. When true, only models where the author has allowed
            distillation will be used.
        ignore:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/ProviderPreferencesIgnoreItems'
          description: >-
            List of provider slugs to ignore. If provided, this list is merged
            with your account-wide ignored provider settings for this request.
        max_price:
          $ref: '#/components/schemas/ProviderPreferencesMaxPrice'
          description: >-
            The object specifying the maximum price you want to pay for this
            request. USD price per million tokens, for prompt and completion.
        only:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/ProviderPreferencesOnlyItems'
          description: >-
            List of provider slugs to allow. If provided, this list is merged
            with your account-wide allowed provider settings for this request.
        order:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/ProviderPreferencesOrderItems'
          description: >-
            An ordered list of provider slugs. The router will attempt to use
            the first provider in the subset of this list that supports your
            requested model, and fall back to the next if it is unavailable. If
            no providers are available, the request will fail with an error
            message.
        preferred_max_latency:
          $ref: '#/components/schemas/PreferredMaxLatency'
        preferred_min_throughput:
          $ref: '#/components/schemas/PreferredMinThroughput'
        quantizations:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/Quantization'
          description: A list of quantization levels to filter the provider by.
        require_parameters:
          type:
            - boolean
            - 'null'
          description: >-
            Whether to filter providers to only those that support the
            parameters you've provided. If this setting is omitted or set to
            false, then providers will receive only the parameters they support,
            and ignore the rest.
        sort:
          $ref: '#/components/schemas/ProviderPreferencesSort'
          description: >-
            The sorting strategy to use for this request, if "order" is not
            specified. When set, no load balancing is performed.
        zdr:
          type:
            - boolean
            - 'null'
          description: >-
            Whether to restrict routing to only ZDR (Zero Data Retention)
            endpoints. When true, only endpoints that do not retain prompts will
            be used.
      title: EmbeddingsPostRequestBodyContentApplicationJsonSchemaProvider
    EmbeddingsPostResponsesContentApplicationJsonSchemaDataItemsEmbedding:
      oneOf:
        - type: array
          items:
            type: number
            format: double
        - type: string
      description: Embedding vector as an array of floats or a base64 string
      title: EmbeddingsPostResponsesContentApplicationJsonSchemaDataItemsEmbedding
    EmbeddingsPostResponsesContentApplicationJsonSchemaDataItemsObject:
      type: string
      enum:
        - embedding
      title: EmbeddingsPostResponsesContentApplicationJsonSchemaDataItemsObject
    EmbeddingsPostResponsesContentApplicationJsonSchemaDataItems:
      type: object
      properties:
        embedding:
          $ref: >-
            #/components/schemas/EmbeddingsPostResponsesContentApplicationJsonSchemaDataItemsEmbedding
          description: Embedding vector as an array of floats or a base64 string
        index:
          type: integer
          description: Index of the embedding in the input list
        object:
          $ref: >-
            #/components/schemas/EmbeddingsPostResponsesContentApplicationJsonSchemaDataItemsObject
      required:
        - embedding
        - object
      description: A single embedding object
      title: EmbeddingsPostResponsesContentApplicationJsonSchemaDataItems
    EmbeddingsPostResponsesContentApplicationJsonSchemaObject:
      type: string
      enum:
        - list
      title: EmbeddingsPostResponsesContentApplicationJsonSchemaObject
    EmbeddingsPostResponsesContentApplicationJsonSchemaUsage:
      type: object
      properties:
        cost:
          type: number
          format: double
          description: Cost of the request in credits
        prompt_tokens:
          type: integer
          description: Number of tokens in the input
        total_tokens:
          type: integer
          description: Total number of tokens used
      required:
        - prompt_tokens
        - total_tokens
      description: Token usage statistics
      title: EmbeddingsPostResponsesContentApplicationJsonSchemaUsage
    Embeddings_createEmbeddings_Response_200:
      type: object
      properties:
        data:
          type: array
          items:
            $ref: >-
              #/components/schemas/EmbeddingsPostResponsesContentApplicationJsonSchemaDataItems
          description: List of embedding objects
        id:
          type: string
          description: Unique identifier for the embeddings response
        model:
          type: string
          description: The model used for embeddings
        object:
          $ref: >-
            #/components/schemas/EmbeddingsPostResponsesContentApplicationJsonSchemaObject
        usage:
          $ref: >-
            #/components/schemas/EmbeddingsPostResponsesContentApplicationJsonSchemaUsage
          description: Token usage statistics
      required:
        - data
        - model
        - object
      description: Embeddings response containing embedding vectors
      title: Embeddings_createEmbeddings_Response_200
    BadRequestResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for BadRequestResponse
      title: BadRequestResponseErrorData
    BadRequestResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/BadRequestResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Bad Request - Invalid request parameters or malformed input
      title: BadRequestResponse
    UnauthorizedResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for UnauthorizedResponse
      title: UnauthorizedResponseErrorData
    UnauthorizedResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/UnauthorizedResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Unauthorized - Authentication required or invalid credentials
      title: UnauthorizedResponse
    PaymentRequiredResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for PaymentRequiredResponse
      title: PaymentRequiredResponseErrorData
    PaymentRequiredResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/PaymentRequiredResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Payment Required - Insufficient credits or quota to complete request
      title: PaymentRequiredResponse
    NotFoundResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for NotFoundResponse
      title: NotFoundResponseErrorData
    NotFoundResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/NotFoundResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Not Found - Resource does not exist
      title: NotFoundResponse
    TooManyRequestsResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for TooManyRequestsResponse
      title: TooManyRequestsResponseErrorData
    TooManyRequestsResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/TooManyRequestsResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Too Many Requests - Rate limit exceeded
      title: TooManyRequestsResponse
    InternalServerResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for InternalServerResponse
      title: InternalServerResponseErrorData
    InternalServerResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/InternalServerResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Internal Server Error - Unexpected server error
      title: InternalServerResponse
    BadGatewayResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for BadGatewayResponse
      title: BadGatewayResponseErrorData
    BadGatewayResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/BadGatewayResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Bad Gateway - Provider/upstream API failure
      title: BadGatewayResponse
    ServiceUnavailableResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for ServiceUnavailableResponse
      title: ServiceUnavailableResponseErrorData
    ServiceUnavailableResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/ServiceUnavailableResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Service Unavailable - Service temporarily unavailable
      title: ServiceUnavailableResponse
  securitySchemes:
    apiKey:
      type: http
      scheme: bearer
      description: API key as bearer token in Authorization header

```

## SDK Code Examples

```python
import requests

url = "https://openrouter.ai/api/v1/embeddings"

payload = {
    "input": "The quick brown fox jumps over the lazy dog",
    "model": "openai/text-embedding-3-small",
    "dimensions": 1536
}
headers = {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
}

response = requests.post(url, json=payload, headers=headers)

print(response.json())
```

```javascript
const url = 'https://openrouter.ai/api/v1/embeddings';
const options = {
  method: 'POST',
  headers: {Authorization: 'Bearer <token>', 'Content-Type': 'application/json'},
  body: '{"input":"The quick brown fox jumps over the lazy dog","model":"openai/text-embedding-3-small","dimensions":1536}'
};

try {
  const response = await fetch(url, options);
  const data = await response.json();
  console.log(data);
} catch (error) {
  console.error(error);
}
```

```go
package main

import (
	"fmt"
	"strings"
	"net/http"
	"io"
)

func main() {

	url := "https://openrouter.ai/api/v1/embeddings"

	payload := strings.NewReader("{\n  \"input\": \"The quick brown fox jumps over the lazy dog\",\n  \"model\": \"openai/text-embedding-3-small\",\n  \"dimensions\": 1536\n}")

	req, _ := http.NewRequest("POST", url, payload)

	req.Header.Add("Authorization", "Bearer <token>")
	req.Header.Add("Content-Type", "application/json")

	res, _ := http.DefaultClient.Do(req)

	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)

	fmt.Println(res)
	fmt.Println(string(body))

}
```

```ruby
require 'uri'
require 'net/http'

url = URI("https://openrouter.ai/api/v1/embeddings")

http = Net::HTTP.new(url.host, url.port)
http.use_ssl = true

request = Net::HTTP::Post.new(url)
request["Authorization"] = 'Bearer <token>'
request["Content-Type"] = 'application/json'
request.body = "{\n  \"input\": \"The quick brown fox jumps over the lazy dog\",\n  \"model\": \"openai/text-embedding-3-small\",\n  \"dimensions\": 1536\n}"

response = http.request(request)
puts response.read_body
```

```java
import com.mashape.unirest.http.HttpResponse;
import com.mashape.unirest.http.Unirest;

HttpResponse<String> response = Unirest.post("https://openrouter.ai/api/v1/embeddings")
  .header("Authorization", "Bearer <token>")
  .header("Content-Type", "application/json")
  .body("{\n  \"input\": \"The quick brown fox jumps over the lazy dog\",\n  \"model\": \"openai/text-embedding-3-small\",\n  \"dimensions\": 1536\n}")
  .asString();
```

```php
<?php
require_once('vendor/autoload.php');

$client = new \GuzzleHttp\Client();

$response = $client->request('POST', 'https://openrouter.ai/api/v1/embeddings', [
  'body' => '{
  "input": "The quick brown fox jumps over the lazy dog",
  "model": "openai/text-embedding-3-small",
  "dimensions": 1536
}',
  'headers' => [
    'Authorization' => 'Bearer <token>',
    'Content-Type' => 'application/json',
  ],
]);

echo $response->getBody();
```

```csharp
using RestSharp;

var client = new RestClient("https://openrouter.ai/api/v1/embeddings");
var request = new RestRequest(Method.POST);
request.AddHeader("Authorization", "Bearer <token>");
request.AddHeader("Content-Type", "application/json");
request.AddParameter("application/json", "{\n  \"input\": \"The quick brown fox jumps over the lazy dog\",\n  \"model\": \"openai/text-embedding-3-small\",\n  \"dimensions\": 1536\n}", ParameterType.RequestBody);
IRestResponse response = client.Execute(request);
```

```swift
import Foundation

let headers = [
  "Authorization": "Bearer <token>",
  "Content-Type": "application/json"
]
let parameters = [
  "input": "The quick brown fox jumps over the lazy dog",
  "model": "openai/text-embedding-3-small",
  "dimensions": 1536
] as [String : Any]

let postData = JSONSerialization.data(withJSONObject: parameters, options: [])

let request = NSMutableURLRequest(url: NSURL(string: "https://openrouter.ai/api/v1/embeddings")! as URL,
                                        cachePolicy: .useProtocolCachePolicy,
                                    timeoutInterval: 10.0)
request.httpMethod = "POST"
request.allHTTPHeaderFields = headers
request.httpBody = postData as Data

let session = URLSession.shared
let dataTask = session.dataTask(with: request as URLRequest, completionHandler: { (data, response, error) -> Void in
  if (error != nil) {
    print(error as Any)
  } else {
    let httpResponse = response as? HTTPURLResponse
    print(httpResponse)
  }
})

dataTask.resume()
```# List all embeddings models

GET https://openrouter.ai/api/v1/embeddings/models

Returns a list of all available embeddings models and their properties

Reference: https://openrouter.ai/docs/api/api-reference/embeddings/list-embeddings-models

## OpenAPI Specification

```yaml
openapi: 3.1.0
info:
  title: OpenRouter API
  version: 1.0.0
paths:
  /embeddings/models:
    get:
      operationId: list-embeddings-models
      summary: List all embeddings models
      description: Returns a list of all available embeddings models and their properties
      tags:
        - subpackage_embeddings
      parameters:
        - name: Authorization
          in: header
          description: API key as bearer token in Authorization header
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Returns a list of embeddings models
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ModelsListResponse'
        '400':
          description: Bad Request - Invalid request parameters or malformed input
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BadRequestResponse'
        '500':
          description: Internal Server Error - Unexpected server error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/InternalServerResponse'
servers:
  - url: https://openrouter.ai/api/v1
components:
  schemas:
    InputModality:
      type: string
      enum:
        - text
        - image
        - file
        - audio
        - video
      title: InputModality
    ModelArchitectureInstructType:
      type: string
      enum:
        - none
        - airoboros
        - alpaca
        - alpaca-modif
        - chatml
        - claude
        - code-llama
        - gemma
        - llama2
        - llama3
        - mistral
        - nemotron
        - neural
        - openchat
        - phi3
        - rwkv
        - vicuna
        - zephyr
        - deepseek-r1
        - deepseek-v3.1
        - qwq
        - qwen3
      description: Instruction format type
      title: ModelArchitectureInstructType
    OutputModality:
      type: string
      enum:
        - text
        - image
        - embeddings
        - audio
        - video
        - rerank
      title: OutputModality
    ModelGroup:
      type: string
      enum:
        - Router
        - Media
        - Other
        - GPT
        - Claude
        - Gemini
        - Gemma
        - Grok
        - Cohere
        - Nova
        - Qwen
        - Yi
        - DeepSeek
        - Mistral
        - Llama2
        - Llama3
        - Llama4
        - PaLM
        - RWKV
        - Qwen3
      description: Tokenizer type used by the model
      title: ModelGroup
    ModelArchitecture:
      type: object
      properties:
        input_modalities:
          type: array
          items:
            $ref: '#/components/schemas/InputModality'
          description: Supported input modalities
        instruct_type:
          oneOf:
            - $ref: '#/components/schemas/ModelArchitectureInstructType'
            - type: 'null'
          description: Instruction format type
        modality:
          type:
            - string
            - 'null'
          description: Primary modality of the model
        output_modalities:
          type: array
          items:
            $ref: '#/components/schemas/OutputModality'
          description: Supported output modalities
        tokenizer:
          $ref: '#/components/schemas/ModelGroup'
      required:
        - input_modalities
        - modality
        - output_modalities
      description: Model architecture information
      title: ModelArchitecture
    DefaultParameters:
      type: object
      properties:
        frequency_penalty:
          type:
            - number
            - 'null'
          format: double
        presence_penalty:
          type:
            - number
            - 'null'
          format: double
        repetition_penalty:
          type:
            - number
            - 'null'
          format: double
        temperature:
          type:
            - number
            - 'null'
          format: double
        top_k:
          type:
            - integer
            - 'null'
        top_p:
          type:
            - number
            - 'null'
          format: double
      description: Default parameters for this model
      title: DefaultParameters
    ModelLinks:
      type: object
      properties:
        details:
          type: string
          description: URL for the model details/endpoints API
      required:
        - details
      description: Related API endpoints and resources for this model.
      title: ModelLinks
    PerRequestLimits:
      type: object
      properties:
        completion_tokens:
          type: number
          format: double
          description: Maximum completion tokens per request
        prompt_tokens:
          type: number
          format: double
          description: Maximum prompt tokens per request
      required:
        - completion_tokens
        - prompt_tokens
      description: Per-request token limits
      title: PerRequestLimits
    PublicPricingAudio:
      type: object
      properties: {}
      title: PublicPricingAudio
    PublicPricingAudioOutput:
      type: object
      properties: {}
      title: PublicPricingAudioOutput
    PublicPricingCompletion:
      type: object
      properties: {}
      title: PublicPricingCompletion
    PublicPricingImage:
      type: object
      properties: {}
      title: PublicPricingImage
    PublicPricingImageOutput:
      type: object
      properties: {}
      title: PublicPricingImageOutput
    PublicPricingImageToken:
      type: object
      properties: {}
      title: PublicPricingImageToken
    PublicPricingInputAudioCache:
      type: object
      properties: {}
      title: PublicPricingInputAudioCache
    PublicPricingInputCacheRead:
      type: object
      properties: {}
      title: PublicPricingInputCacheRead
    PublicPricingInputCacheWrite:
      type: object
      properties: {}
      title: PublicPricingInputCacheWrite
    PublicPricingInternalReasoning:
      type: object
      properties: {}
      title: PublicPricingInternalReasoning
    PublicPricingPrompt:
      type: object
      properties: {}
      title: PublicPricingPrompt
    PublicPricingRequest:
      type: object
      properties: {}
      title: PublicPricingRequest
    PublicPricingWebSearch:
      type: object
      properties: {}
      title: PublicPricingWebSearch
    PublicPricing:
      type: object
      properties:
        audio:
          $ref: '#/components/schemas/PublicPricingAudio'
        audio_output:
          $ref: '#/components/schemas/PublicPricingAudioOutput'
        completion:
          $ref: '#/components/schemas/PublicPricingCompletion'
        discount:
          type: number
          format: double
        image:
          $ref: '#/components/schemas/PublicPricingImage'
        image_output:
          $ref: '#/components/schemas/PublicPricingImageOutput'
        image_token:
          $ref: '#/components/schemas/PublicPricingImageToken'
        input_audio_cache:
          $ref: '#/components/schemas/PublicPricingInputAudioCache'
        input_cache_read:
          $ref: '#/components/schemas/PublicPricingInputCacheRead'
        input_cache_write:
          $ref: '#/components/schemas/PublicPricingInputCacheWrite'
        internal_reasoning:
          $ref: '#/components/schemas/PublicPricingInternalReasoning'
        prompt:
          $ref: '#/components/schemas/PublicPricingPrompt'
        request:
          $ref: '#/components/schemas/PublicPricingRequest'
        web_search:
          $ref: '#/components/schemas/PublicPricingWebSearch'
      required:
        - completion
        - prompt
      description: Pricing information for the model
      title: PublicPricing
    Parameter:
      type: string
      enum:
        - temperature
        - top_p
        - top_k
        - min_p
        - top_a
        - frequency_penalty
        - presence_penalty
        - repetition_penalty
        - max_tokens
        - max_completion_tokens
        - logit_bias
        - logprobs
        - top_logprobs
        - seed
        - response_format
        - structured_outputs
        - stop
        - tools
        - tool_choice
        - parallel_tool_calls
        - include_reasoning
        - reasoning
        - reasoning_effort
        - web_search_options
        - verbosity
      title: Parameter
    TopProviderInfo:
      type: object
      properties:
        context_length:
          type:
            - integer
            - 'null'
          description: Context length from the top provider
        is_moderated:
          type: boolean
          description: Whether the top provider moderates content
        max_completion_tokens:
          type:
            - integer
            - 'null'
          description: Maximum completion tokens from the top provider
      required:
        - is_moderated
      description: Information about the top provider for this model
      title: TopProviderInfo
    Model:
      type: object
      properties:
        architecture:
          $ref: '#/components/schemas/ModelArchitecture'
        canonical_slug:
          type: string
          description: Canonical slug for the model
        context_length:
          type:
            - integer
            - 'null'
          description: Maximum context length in tokens
        created:
          type: integer
          description: Unix timestamp of when the model was created
        default_parameters:
          $ref: '#/components/schemas/DefaultParameters'
        description:
          type: string
          description: Description of the model
        expiration_date:
          type:
            - string
            - 'null'
          description: >-
            The date after which the model may be removed. ISO 8601 date string
            (YYYY-MM-DD) or null if no expiration.
        hugging_face_id:
          type:
            - string
            - 'null'
          description: Hugging Face model identifier, if applicable
        id:
          type: string
          description: Unique identifier for the model
        knowledge_cutoff:
          type:
            - string
            - 'null'
          description: >-
            The date up to which the model was trained on data. ISO 8601 date
            string (YYYY-MM-DD) or null if unknown.
        links:
          $ref: '#/components/schemas/ModelLinks'
        name:
          type: string
          description: Display name of the model
        per_request_limits:
          $ref: '#/components/schemas/PerRequestLimits'
        pricing:
          $ref: '#/components/schemas/PublicPricing'
        supported_parameters:
          type: array
          items:
            $ref: '#/components/schemas/Parameter'
          description: List of supported parameters for this model
        top_provider:
          $ref: '#/components/schemas/TopProviderInfo'
      required:
        - architecture
        - canonical_slug
        - context_length
        - created
        - default_parameters
        - id
        - links
        - name
        - per_request_limits
        - pricing
        - supported_parameters
        - top_provider
      description: Information about an AI model available on OpenRouter
      title: Model
    ModelsListResponseData:
      type: array
      items:
        $ref: '#/components/schemas/Model'
      description: List of available models
      title: ModelsListResponseData
    ModelsListResponse:
      type: object
      properties:
        data:
          $ref: '#/components/schemas/ModelsListResponseData'
      required:
        - data
      description: List of available models
      title: ModelsListResponse
    BadRequestResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for BadRequestResponse
      title: BadRequestResponseErrorData
    BadRequestResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/BadRequestResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Bad Request - Invalid request parameters or malformed input
      title: BadRequestResponse
    InternalServerResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for InternalServerResponse
      title: InternalServerResponseErrorData
    InternalServerResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/InternalServerResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Internal Server Error - Unexpected server error
      title: InternalServerResponse
  securitySchemes:
    apiKey:
      type: http
      scheme: bearer
      description: API key as bearer token in Authorization header

```

## SDK Code Examples

```python
import requests

url = "https://openrouter.ai/api/v1/embeddings/models"

headers = {"Authorization": "Bearer <token>"}

response = requests.get(url, headers=headers)

print(response.json())
```

```javascript
const url = 'https://openrouter.ai/api/v1/embeddings/models';
const options = {method: 'GET', headers: {Authorization: 'Bearer <token>'}};

try {
  const response = await fetch(url, options);
  const data = await response.json();
  console.log(data);
} catch (error) {
  console.error(error);
}
```

```go
package main

import (
	"fmt"
	"net/http"
	"io"
)

func main() {

	url := "https://openrouter.ai/api/v1/embeddings/models"

	req, _ := http.NewRequest("GET", url, nil)

	req.Header.Add("Authorization", "Bearer <token>")

	res, _ := http.DefaultClient.Do(req)

	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)

	fmt.Println(res)
	fmt.Println(string(body))

}
```

```ruby
require 'uri'
require 'net/http'

url = URI("https://openrouter.ai/api/v1/embeddings/models")

http = Net::HTTP.new(url.host, url.port)
http.use_ssl = true

request = Net::HTTP::Get.new(url)
request["Authorization"] = 'Bearer <token>'

response = http.request(request)
puts response.read_body
```

```java
import com.mashape.unirest.http.HttpResponse;
import com.mashape.unirest.http.Unirest;

HttpResponse<String> response = Unirest.get("https://openrouter.ai/api/v1/embeddings/models")
  .header("Authorization", "Bearer <token>")
  .asString();
```

```php
<?php
require_once('vendor/autoload.php');

$client = new \GuzzleHttp\Client();

$response = $client->request('GET', 'https://openrouter.ai/api/v1/embeddings/models', [
  'headers' => [
    'Authorization' => 'Bearer <token>',
  ],
]);

echo $response->getBody();
```

```csharp
using RestSharp;

var client = new RestClient("https://openrouter.ai/api/v1/embeddings/models");
var request = new RestRequest(Method.GET);
request.AddHeader("Authorization", "Bearer <token>");
IRestResponse response = client.Execute(request);
```

```swift
import Foundation

let headers = ["Authorization": "Bearer <token>"]

let request = NSMutableURLRequest(url: NSURL(string: "https://openrouter.ai/api/v1/embeddings/models")! as URL,
                                        cachePolicy: .useProtocolCachePolicy,
                                    timeoutInterval: 10.0)
request.httpMethod = "GET"
request.allHTTPHeaderFields = headers

let session = URLSession.shared
let dataTask = session.dataTask(with: request as URLRequest, completionHandler: { (data, response, error) -> Void in
  if (error != nil) {
    print(error as Any)
  } else {
    let httpResponse = response as? HTTPURLResponse
    print(httpResponse)
  }
})

dataTask.resume()
```# Submit a rerank request

POST https://openrouter.ai/api/v1/rerank
Content-Type: application/json

Submits a rerank request to the rerank router

Reference: https://openrouter.ai/docs/api/api-reference/rerank/create-rerank

## OpenAPI Specification

```yaml
openapi: 3.1.0
info:
  title: OpenRouter API
  version: 1.0.0
paths:
  /rerank:
    post:
      operationId: create-rerank
      summary: Submit a rerank request
      description: Submits a rerank request to the rerank router
      tags:
        - subpackage_rerank
      parameters:
        - name: Authorization
          in: header
          description: API key as bearer token in Authorization header
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Rerank response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Rerank_createRerank_Response_200'
        '400':
          description: Bad Request - Invalid request parameters or malformed input
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BadRequestResponse'
        '401':
          description: Unauthorized - Authentication required or invalid credentials
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UnauthorizedResponse'
        '402':
          description: Payment Required - Insufficient credits or quota to complete request
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PaymentRequiredResponse'
        '404':
          description: Not Found - Resource does not exist
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/NotFoundResponse'
        '429':
          description: Too Many Requests - Rate limit exceeded
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TooManyRequestsResponse'
        '500':
          description: Internal Server Error - Unexpected server error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/InternalServerResponse'
        '502':
          description: Bad Gateway - Provider/upstream API failure
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BadGatewayResponse'
        '503':
          description: Service Unavailable - Service temporarily unavailable
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ServiceUnavailableResponse'
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                documents:
                  type: array
                  items:
                    type: string
                  description: The list of documents to rerank
                model:
                  type: string
                  description: The rerank model to use
                provider:
                  $ref: >-
                    #/components/schemas/RerankPostRequestBodyContentApplicationJsonSchemaProvider
                query:
                  type: string
                  description: The search query to rerank documents against
                top_n:
                  type: integer
                  description: Number of most relevant documents to return
              required:
                - documents
                - model
                - query
servers:
  - url: https://openrouter.ai/api/v1
components:
  schemas:
    ProviderPreferencesDataCollection:
      type: string
      enum:
        - deny
        - allow
      description: >-
        Data collection setting. If no available model provider meets the
        requirement, your request will return an error.

        - allow: (default) allow providers which store user data non-transiently
        and may train on it


        - deny: use only providers which do not collect user data.
      title: ProviderPreferencesDataCollection
    ProviderName:
      type: string
      enum:
        - AkashML
        - AI21
        - AionLabs
        - Alibaba
        - Ambient
        - Baidu
        - Amazon Bedrock
        - Amazon Nova
        - Anthropic
        - Arcee AI
        - AtlasCloud
        - Avian
        - Azure
        - BaseTen
        - BytePlus
        - Black Forest Labs
        - Cerebras
        - Chutes
        - Cirrascale
        - Clarifai
        - Cloudflare
        - Cohere
        - Crusoe
        - DeepInfra
        - DeepSeek
        - DekaLLM
        - Featherless
        - Fireworks
        - Friendli
        - GMICloud
        - Google
        - Google AI Studio
        - Groq
        - Hyperbolic
        - Inception
        - Inceptron
        - InferenceNet
        - Ionstream
        - Infermatic
        - Io Net
        - Inflection
        - Liquid
        - Mara
        - Mancer 2
        - Minimax
        - ModelRun
        - Mistral
        - Modular
        - Moonshot AI
        - Morph
        - NCompass
        - Nebius
        - NextBit
        - Novita
        - Nvidia
        - OpenAI
        - OpenInference
        - Parasail
        - Perplexity
        - Phala
        - Recraft
        - Reka
        - Relace
        - SambaNova
        - Seed
        - SiliconFlow
        - Sourceful
        - StepFun
        - Stealth
        - StreamLake
        - Switchpoint
        - Together
        - Upstage
        - Venice
        - WandB
        - Xiaomi
        - xAI
        - Z.AI
        - FakeProvider
      title: ProviderName
    ProviderPreferencesIgnoreItems:
      oneOf:
        - $ref: '#/components/schemas/ProviderName'
        - type: string
      title: ProviderPreferencesIgnoreItems
    ProviderPreferencesMaxPriceAudio:
      type: object
      properties: {}
      title: ProviderPreferencesMaxPriceAudio
    ProviderPreferencesMaxPriceCompletion:
      type: object
      properties: {}
      title: ProviderPreferencesMaxPriceCompletion
    ProviderPreferencesMaxPriceImage:
      type: object
      properties: {}
      title: ProviderPreferencesMaxPriceImage
    BigNumberUnion:
      type: string
      description: Price per million prompt tokens
      title: BigNumberUnion
    ProviderPreferencesMaxPriceRequest:
      type: object
      properties: {}
      title: ProviderPreferencesMaxPriceRequest
    ProviderPreferencesMaxPrice:
      type: object
      properties:
        audio:
          $ref: '#/components/schemas/ProviderPreferencesMaxPriceAudio'
        completion:
          $ref: '#/components/schemas/ProviderPreferencesMaxPriceCompletion'
        image:
          $ref: '#/components/schemas/ProviderPreferencesMaxPriceImage'
        prompt:
          $ref: '#/components/schemas/BigNumberUnion'
        request:
          $ref: '#/components/schemas/ProviderPreferencesMaxPriceRequest'
      description: >-
        The object specifying the maximum price you want to pay for this
        request. USD price per million tokens, for prompt and completion.
      title: ProviderPreferencesMaxPrice
    ProviderPreferencesOnlyItems:
      oneOf:
        - $ref: '#/components/schemas/ProviderName'
        - type: string
      title: ProviderPreferencesOnlyItems
    ProviderPreferencesOrderItems:
      oneOf:
        - $ref: '#/components/schemas/ProviderName'
        - type: string
      title: ProviderPreferencesOrderItems
    PercentileLatencyCutoffs:
      type: object
      properties:
        p50:
          type:
            - number
            - 'null'
          format: double
          description: Maximum p50 latency (seconds)
        p75:
          type:
            - number
            - 'null'
          format: double
          description: Maximum p75 latency (seconds)
        p90:
          type:
            - number
            - 'null'
          format: double
          description: Maximum p90 latency (seconds)
        p99:
          type:
            - number
            - 'null'
          format: double
          description: Maximum p99 latency (seconds)
      description: >-
        Percentile-based latency cutoffs. All specified cutoffs must be met for
        an endpoint to be preferred.
      title: PercentileLatencyCutoffs
    PreferredMaxLatency:
      oneOf:
        - type: number
          format: double
        - $ref: '#/components/schemas/PercentileLatencyCutoffs'
        - description: Any type
      description: >-
        Preferred maximum latency (in seconds). Can be a number (applies to p50)
        or an object with percentile-specific cutoffs. Endpoints above the
        threshold(s) may still be used, but are deprioritized in routing. When
        using fallback models, this may cause a fallback model to be used
        instead of the primary model if it meets the threshold.
      title: PreferredMaxLatency
    PercentileThroughputCutoffs:
      type: object
      properties:
        p50:
          type:
            - number
            - 'null'
          format: double
          description: Minimum p50 throughput (tokens/sec)
        p75:
          type:
            - number
            - 'null'
          format: double
          description: Minimum p75 throughput (tokens/sec)
        p90:
          type:
            - number
            - 'null'
          format: double
          description: Minimum p90 throughput (tokens/sec)
        p99:
          type:
            - number
            - 'null'
          format: double
          description: Minimum p99 throughput (tokens/sec)
      description: >-
        Percentile-based throughput cutoffs. All specified cutoffs must be met
        for an endpoint to be preferred.
      title: PercentileThroughputCutoffs
    PreferredMinThroughput:
      oneOf:
        - type: number
          format: double
        - $ref: '#/components/schemas/PercentileThroughputCutoffs'
        - description: Any type
      description: >-
        Preferred minimum throughput (in tokens per second). Can be a number
        (applies to p50) or an object with percentile-specific cutoffs.
        Endpoints below the threshold(s) may still be used, but are
        deprioritized in routing. When using fallback models, this may cause a
        fallback model to be used instead of the primary model if it meets the
        threshold.
      title: PreferredMinThroughput
    Quantization:
      type: string
      enum:
        - int4
        - int8
        - fp4
        - fp6
        - fp8
        - fp16
        - bf16
        - fp32
        - unknown
      title: Quantization
    ProviderSort:
      type: string
      enum:
        - price
        - throughput
        - latency
        - exacto
      description: The provider sorting strategy (price, throughput, latency)
      title: ProviderSort
    ProviderSortConfigBy:
      type: string
      enum:
        - price
        - throughput
        - latency
        - exacto
      description: The provider sorting strategy (price, throughput, latency)
      title: ProviderSortConfigBy
    ProviderSortConfigPartition:
      type: string
      enum:
        - model
        - none
      description: >-
        Partitioning strategy for sorting: "model" (default) groups endpoints by
        model before sorting (fallback models remain fallbacks), "none" sorts
        all endpoints together regardless of model.
      title: ProviderSortConfigPartition
    ProviderSortConfig:
      type: object
      properties:
        by:
          oneOf:
            - $ref: '#/components/schemas/ProviderSortConfigBy'
            - type: 'null'
          description: The provider sorting strategy (price, throughput, latency)
        partition:
          oneOf:
            - $ref: '#/components/schemas/ProviderSortConfigPartition'
            - type: 'null'
          description: >-
            Partitioning strategy for sorting: "model" (default) groups
            endpoints by model before sorting (fallback models remain
            fallbacks), "none" sorts all endpoints together regardless of model.
      description: The provider sorting strategy (price, throughput, latency)
      title: ProviderSortConfig
    ProviderPreferencesSort:
      oneOf:
        - $ref: '#/components/schemas/ProviderSort'
        - $ref: '#/components/schemas/ProviderSortConfig'
        - description: Any type
      description: >-
        The sorting strategy to use for this request, if "order" is not
        specified. When set, no load balancing is performed.
      title: ProviderPreferencesSort
    RerankPostRequestBodyContentApplicationJsonSchemaProvider:
      type: object
      properties:
        allow_fallbacks:
          type:
            - boolean
            - 'null'
          description: >
            Whether to allow backup providers to serve requests

            - true: (default) when the primary provider (or your custom
            providers in "order") is unavailable, use the next best provider.

            - false: use only the primary/custom provider, and return the
            upstream error if it's unavailable.
        data_collection:
          oneOf:
            - $ref: '#/components/schemas/ProviderPreferencesDataCollection'
            - type: 'null'
          description: >-
            Data collection setting. If no available model provider meets the
            requirement, your request will return an error.

            - allow: (default) allow providers which store user data
            non-transiently and may train on it


            - deny: use only providers which do not collect user data.
        enforce_distillable_text:
          type:
            - boolean
            - 'null'
          description: >-
            Whether to restrict routing to only models that allow text
            distillation. When true, only models where the author has allowed
            distillation will be used.
        ignore:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/ProviderPreferencesIgnoreItems'
          description: >-
            List of provider slugs to ignore. If provided, this list is merged
            with your account-wide ignored provider settings for this request.
        max_price:
          $ref: '#/components/schemas/ProviderPreferencesMaxPrice'
          description: >-
            The object specifying the maximum price you want to pay for this
            request. USD price per million tokens, for prompt and completion.
        only:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/ProviderPreferencesOnlyItems'
          description: >-
            List of provider slugs to allow. If provided, this list is merged
            with your account-wide allowed provider settings for this request.
        order:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/ProviderPreferencesOrderItems'
          description: >-
            An ordered list of provider slugs. The router will attempt to use
            the first provider in the subset of this list that supports your
            requested model, and fall back to the next if it is unavailable. If
            no providers are available, the request will fail with an error
            message.
        preferred_max_latency:
          $ref: '#/components/schemas/PreferredMaxLatency'
        preferred_min_throughput:
          $ref: '#/components/schemas/PreferredMinThroughput'
        quantizations:
          type:
            - array
            - 'null'
          items:
            $ref: '#/components/schemas/Quantization'
          description: A list of quantization levels to filter the provider by.
        require_parameters:
          type:
            - boolean
            - 'null'
          description: >-
            Whether to filter providers to only those that support the
            parameters you've provided. If this setting is omitted or set to
            false, then providers will receive only the parameters they support,
            and ignore the rest.
        sort:
          $ref: '#/components/schemas/ProviderPreferencesSort'
          description: >-
            The sorting strategy to use for this request, if "order" is not
            specified. When set, no load balancing is performed.
        zdr:
          type:
            - boolean
            - 'null'
          description: >-
            Whether to restrict routing to only ZDR (Zero Data Retention)
            endpoints. When true, only endpoints that do not retain prompts will
            be used.
      title: RerankPostRequestBodyContentApplicationJsonSchemaProvider
    RerankPostResponsesContentApplicationJsonSchemaResultsItemsDocument:
      type: object
      properties:
        text:
          type: string
          description: The document text
      required:
        - text
      description: The document object containing the original text
      title: RerankPostResponsesContentApplicationJsonSchemaResultsItemsDocument
    RerankPostResponsesContentApplicationJsonSchemaResultsItems:
      type: object
      properties:
        document:
          $ref: >-
            #/components/schemas/RerankPostResponsesContentApplicationJsonSchemaResultsItemsDocument
          description: The document object containing the original text
        index:
          type: integer
          description: Index of the document in the original input list
        relevance_score:
          type: number
          format: double
          description: Relevance score of the document to the query
      required:
        - document
        - index
        - relevance_score
      description: A single rerank result
      title: RerankPostResponsesContentApplicationJsonSchemaResultsItems
    RerankPostResponsesContentApplicationJsonSchemaUsage:
      type: object
      properties:
        cost:
          type: number
          format: double
          description: Cost of the request in credits
        search_units:
          type: integer
          description: Number of search units consumed (Cohere billing)
        total_tokens:
          type: integer
          description: Total number of tokens used
      description: Usage statistics
      title: RerankPostResponsesContentApplicationJsonSchemaUsage
    Rerank_createRerank_Response_200:
      type: object
      properties:
        id:
          type: string
          description: Unique identifier for the rerank response (ORID format)
        model:
          type: string
          description: The model used for reranking
        provider:
          type: string
          description: The provider that served the rerank request
        results:
          type: array
          items:
            $ref: >-
              #/components/schemas/RerankPostResponsesContentApplicationJsonSchemaResultsItems
          description: List of rerank results sorted by relevance
        usage:
          $ref: >-
            #/components/schemas/RerankPostResponsesContentApplicationJsonSchemaUsage
          description: Usage statistics
      required:
        - model
        - results
      description: Rerank response containing ranked results
      title: Rerank_createRerank_Response_200
    BadRequestResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for BadRequestResponse
      title: BadRequestResponseErrorData
    BadRequestResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/BadRequestResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Bad Request - Invalid request parameters or malformed input
      title: BadRequestResponse
    UnauthorizedResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for UnauthorizedResponse
      title: UnauthorizedResponseErrorData
    UnauthorizedResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/UnauthorizedResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Unauthorized - Authentication required or invalid credentials
      title: UnauthorizedResponse
    PaymentRequiredResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for PaymentRequiredResponse
      title: PaymentRequiredResponseErrorData
    PaymentRequiredResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/PaymentRequiredResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Payment Required - Insufficient credits or quota to complete request
      title: PaymentRequiredResponse
    NotFoundResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for NotFoundResponse
      title: NotFoundResponseErrorData
    NotFoundResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/NotFoundResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Not Found - Resource does not exist
      title: NotFoundResponse
    TooManyRequestsResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for TooManyRequestsResponse
      title: TooManyRequestsResponseErrorData
    TooManyRequestsResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/TooManyRequestsResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Too Many Requests - Rate limit exceeded
      title: TooManyRequestsResponse
    InternalServerResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for InternalServerResponse
      title: InternalServerResponseErrorData
    InternalServerResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/InternalServerResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Internal Server Error - Unexpected server error
      title: InternalServerResponse
    BadGatewayResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for BadGatewayResponse
      title: BadGatewayResponseErrorData
    BadGatewayResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/BadGatewayResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Bad Gateway - Provider/upstream API failure
      title: BadGatewayResponse
    ServiceUnavailableResponseErrorData:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
        metadata:
          type:
            - object
            - 'null'
          additionalProperties:
            description: Any type
      required:
        - code
        - message
      description: Error data for ServiceUnavailableResponse
      title: ServiceUnavailableResponseErrorData
    ServiceUnavailableResponse:
      type: object
      properties:
        error:
          $ref: '#/components/schemas/ServiceUnavailableResponseErrorData'
        user_id:
          type:
            - string
            - 'null'
      required:
        - error
      description: Service Unavailable - Service temporarily unavailable
      title: ServiceUnavailableResponse
  securitySchemes:
    apiKey:
      type: http
      scheme: bearer
      description: API key as bearer token in Authorization header

```

## SDK Code Examples

```python
import requests

url = "https://openrouter.ai/api/v1/rerank"

payload = {
    "documents": ["Paris is the capital of France.", "Berlin is the capital of Germany."],
    "model": "cohere/rerank-v3.5",
    "query": "What is the capital of France?",
    "top_n": 3
}
headers = {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
}

response = requests.post(url, json=payload, headers=headers)

print(response.json())
```

```javascript
const url = 'https://openrouter.ai/api/v1/rerank';
const options = {
  method: 'POST',
  headers: {Authorization: 'Bearer <token>', 'Content-Type': 'application/json'},
  body: '{"documents":["Paris is the capital of France.","Berlin is the capital of Germany."],"model":"cohere/rerank-v3.5","query":"What is the capital of France?","top_n":3}'
};

try {
  const response = await fetch(url, options);
  const data = await response.json();
  console.log(data);
} catch (error) {
  console.error(error);
}
```

```go
package main

import (
	"fmt"
	"strings"
	"net/http"
	"io"
)

func main() {

	url := "https://openrouter.ai/api/v1/rerank"

	payload := strings.NewReader("{\n  \"documents\": [\n    \"Paris is the capital of France.\",\n    \"Berlin is the capital of Germany.\"\n  ],\n  \"model\": \"cohere/rerank-v3.5\",\n  \"query\": \"What is the capital of France?\",\n  \"top_n\": 3\n}")

	req, _ := http.NewRequest("POST", url, payload)

	req.Header.Add("Authorization", "Bearer <token>")
	req.Header.Add("Content-Type", "application/json")

	res, _ := http.DefaultClient.Do(req)

	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)

	fmt.Println(res)
	fmt.Println(string(body))

}
```

```ruby
require 'uri'
require 'net/http'

url = URI("https://openrouter.ai/api/v1/rerank")

http = Net::HTTP.new(url.host, url.port)
http.use_ssl = true

request = Net::HTTP::Post.new(url)
request["Authorization"] = 'Bearer <token>'
request["Content-Type"] = 'application/json'
request.body = "{\n  \"documents\": [\n    \"Paris is the capital of France.\",\n    \"Berlin is the capital of Germany.\"\n  ],\n  \"model\": \"cohere/rerank-v3.5\",\n  \"query\": \"What is the capital of France?\",\n  \"top_n\": 3\n}"

response = http.request(request)
puts response.read_body
```

```java
import com.mashape.unirest.http.HttpResponse;
import com.mashape.unirest.http.Unirest;

HttpResponse<String> response = Unirest.post("https://openrouter.ai/api/v1/rerank")
  .header("Authorization", "Bearer <token>")
  .header("Content-Type", "application/json")
  .body("{\n  \"documents\": [\n    \"Paris is the capital of France.\",\n    \"Berlin is the capital of Germany.\"\n  ],\n  \"model\": \"cohere/rerank-v3.5\",\n  \"query\": \"What is the capital of France?\",\n  \"top_n\": 3\n}")
  .asString();
```

```php
<?php
require_once('vendor/autoload.php');

$client = new \GuzzleHttp\Client();

$response = $client->request('POST', 'https://openrouter.ai/api/v1/rerank', [
  'body' => '{
  "documents": [
    "Paris is the capital of France.",
    "Berlin is the capital of Germany."
  ],
  "model": "cohere/rerank-v3.5",
  "query": "What is the capital of France?",
  "top_n": 3
}',
  'headers' => [
    'Authorization' => 'Bearer <token>',
    'Content-Type' => 'application/json',
  ],
]);

echo $response->getBody();
```

```csharp
using RestSharp;

var client = new RestClient("https://openrouter.ai/api/v1/rerank");
var request = new RestRequest(Method.POST);
request.AddHeader("Authorization", "Bearer <token>");
request.AddHeader("Content-Type", "application/json");
request.AddParameter("application/json", "{\n  \"documents\": [\n    \"Paris is the capital of France.\",\n    \"Berlin is the capital of Germany.\"\n  ],\n  \"model\": \"cohere/rerank-v3.5\",\n  \"query\": \"What is the capital of France?\",\n  \"top_n\": 3\n}", ParameterType.RequestBody);
IRestResponse response = client.Execute(request);
```

```swift
import Foundation

let headers = [
  "Authorization": "Bearer <token>",
  "Content-Type": "application/json"
]
let parameters = [
  "documents": ["Paris is the capital of France.", "Berlin is the capital of Germany."],
  "model": "cohere/rerank-v3.5",
  "query": "What is the capital of France?",
  "top_n": 3
] as [String : Any]

let postData = JSONSerialization.data(withJSONObject: parameters, options: [])

let request = NSMutableURLRequest(url: NSURL(string: "https://openrouter.ai/api/v1/rerank")! as URL,
                                        cachePolicy: .useProtocolCachePolicy,
                                    timeoutInterval: 10.0)
request.httpMethod = "POST"
request.allHTTPHeaderFields = headers
request.httpBody = postData as Data

let session = URLSession.shared
let dataTask = session.dataTask(with: request as URLRequest, completionHandler: { (data, response, error) -> Void in
  if (error != nil) {
    print(error as Any)
  } else {
    let httpResponse = response as? HTTPURLResponse
    print(httpResponse)
  }
})

dataTask.resume()
```