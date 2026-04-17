/**
 * Agent module — single orchestrator with tool-calling.
 * Fase 2: Agent Architecture
 */

export { AGENT_TOOLS, type AgentToolName, type ToolDefinition } from './tool-definitions';
export { executeToolCall, type ToolCallResult, type ToolExecutionTrace, type ToolTrustLevel } from './tool-executor';
export { buildAgentSystemPrompt, type AgentPromptContext } from './agent-prompt';
export { runAgent, type AgentMessage, type AgentResult } from './agent-orchestrator';
