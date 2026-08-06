# ARCHITECTURE.md

## Overview

The extension is built as a VS Code extension in TypeScript. It has no backend 
server — everything runs locally as part of the extension host process or as 
child processes managed by the extension. Ollama runs as a local process on the 
user's machine and is called via its REST API on localhost.

## Platform

v1 targets macOS only. This simplifies hardware detection, installation 
scripting, and testing significantly. Windows and Linux are post-v1. Linux is the
first post-v1 target (Phase 9); see [`PLATFORMS.md`](./PLATFORMS.md) and
DECISIONS 018.

## High-Level Component Map

```
┌─────────────────────────────────────────────────────┐
│                    VS Code Editor                    │
│                                                      │
│  ┌─────────────────┐      ┌──────────────────────┐  │
│  │   Sidebar Panel  │      │   Inline Completions │  │
│  │   (Chat UI)      │      │   (Ghost Text)       │  │
│  └────────┬────────┘      └──────────┬───────────┘  │
│           │                          │               │
│  ┌────────▼──────────────────────────▼───────────┐  │
│  │              Extension Host (TypeScript)        │  │
│  │                                                 │  │
│  │  ┌─────────────┐  ┌──────────┐  ┌──────────┐  │  │
│  │  │   Ollama    │  │ Context  │  │ Hardware │  │  │
│  │  │   Service   │  │ Service  │  │ Detector │  │  │
│  │  └──────┬──────┘  └────┬─────┘  └────┬─────┘  │  │
│  │         │              │              │         │  │
│  │  ┌──────▼──────┐  ┌────▼─────┐       │         │  │
│  │  │   Prompt    │  │ LanceDB  │       │         │  │
│  │  │   Engine    │  │  Index   │       │         │  │
│  │  └─────────────┘  └──────────┘       │         │  │
│  │                                      │         │  │
│  │  ┌───────────────────────────────────▼──────┐  │  │
│  │  │           Onboarding Manager             │  │  │
│  │  └──────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
          │
          ▼
   ┌─────────────┐
   │   Ollama    │
   │  (localhost │
   │   :11434)   │
   └─────────────┘
```

> **Note (decision 011):** The Helicone observability proxy shown in earlier
> drafts is deferred to post-v1. In v1 the Ollama Service calls Ollama
> directly via a configurable base URL (default `localhost:11434`). A local
> observability proxy can be reintroduced later behind that same base URL.

## Components

### Extension Host
The core TypeScript process that VS Code runs. Orchestrates all other 
components. Activated when VS Code opens a workspace folder.

### Sidebar Panel (Chat UI)
A VS Code WebviewPanel rendered in the primary sidebar. Built with plain 
HTML/CSS/JS inside the webview. Communicates with the extension host via 
VS Code's message passing API (postMessage). Styled to feel like Cursor's 
chat panel.

### Inline Completions
Registered as a VS Code InlineCompletionItemProvider. Triggered when the 
user pauses typing. Sends surrounding code context to Ollama and returns 
ghost text suggestions. Debounced to avoid hammering the local model.

### Ollama Service
Wrapper around Ollama's REST API (localhost:11434). Handles:
- Checking if Ollama is installed and running
- Pulling models
- Sending chat and completion requests
- Streaming responses back to the UI
All calls go directly to Ollama via a configurable base URL (default
`localhost:11434`). The Helicone observability proxy is deferred to post-v1
(decision 011); when reintroduced it sits behind this same base URL with no
call-site changes.

### Context Service
Responsible for retrieving relevant code context for any given query.
- On workspace open: indexes all code files into LanceDB
- On query: performs semantic search against the index to find relevant files
- Assembles retrieved chunks into a context block for the prompt
- Watches for file changes and updates the index incrementally

### Hardware Detector
Runs once on first activation. Detects:
- Available RAM
- Apple Silicon vs Intel (for GPU inference capability)
- Disk space available
Maps detected hardware to a model tier (see HARDWARE_PROFILES.md).

### Prompt Engine
Assembles the final prompt sent to Ollama. Takes:
- User's message or code context
- Retrieved codebase chunks from Context Service
- Conversation history
- System prompt
Outputs a structured prompt appropriate for the selected model.

### Onboarding Manager
Runs on first install. Orchestrates the full setup sequence:
1. Detect hardware
2. Check/install Ollama
3. Pull the appropriate model
4. Index the current workspace
5. Show the user the extension is ready
Handles errors and edge cases at each step (see ONBOARDING_FLOW.md).

### LanceDB Index
Embedded vector database stored on disk inside the extension's global 
storage directory. No separate process. Stores embeddings of all code files 
in the current workspace. One index per workspace.

### Observability (Deferred — post-v1)
There is no observability proxy in v1 (decision 011). The Ollama Service
talks to Ollama directly. Post-v1, a local observability layer — a thin
in-house proxy or an opt-in Helicone cloud dashboard — may be added behind
the Ollama Service's configurable base URL to provide request/response
logging, latency tracking, error visibility, and token usage tracking.
Any such layer must keep all data on the machine.

## Communication Patterns

### Webview ↔ Extension Host
Uses VS Code's built-in postMessage API. Webview sends user actions 
(message sent, settings changed). Extension host sends responses 
(streaming tokens, status updates, errors).

### Extension Host ↔ Ollama
HTTP REST calls directly to localhost:11434 (configurable base URL).
Streaming responses handled via async generators, tokens forwarded to the
webview as they arrive.

### Extension Host ↔ LanceDB
Direct function calls via the LanceDB TypeScript SDK. Synchronous for 
queries, async for indexing operations.

## Data Storage

All data lives in VS Code's globalStorageUri for the extension:

```
~/.vscode/extensions/localpilot/
├── models/          # Managed by Ollama, not us
├── index/           # LanceDB vector index (per workspace)
├── config.json      # User preferences, selected model, onboarding state
└── logs/            # Extension diagnostic logs (no proxy logs in v1)
```

Nothing is stored outside this directory. Nothing is transmitted externally.

## What This Architecture Intentionally Avoids

- No backend server of any kind
- No cloud API calls (a post-v1 opt-in observability dashboard, off by
  default, is the only contemplated exception — see decision 011)
- No observability proxy in v1 (Helicone deferred — decision 011)
- No separate database process (LanceDB is embedded)
- No electron or custom app shell — pure VS Code extension
- No telemetry of any kind in v1
