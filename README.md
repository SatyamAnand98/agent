# Local Code Agent

**local-code-agent** is an AI-powered developer tool that helps you **search, analyze, and edit your codebase** using local models only.  
It combines:  
- **[Ollama](https://ollama.com/)** (for embeddings + LLM reasoning)  
- **[Qdrant](https://qdrant.tech/)** (vector database for semantic code search)  
- A simple **Node.js CLI**  

Everything runs locally on your Mac — **no code leaves your machine**.

---

## Features

- **Index** your entire codebase into a vector DB for semantic search.  
- **Analyze** prompts in context of your repo (shows top-matching files/snippets).  
- **Apply** safe, AI-generated code edits (dry-run by default).  
- **Locate** where logic is implemented (semantic + keyword).  
- **Ask** natural-language questions about your code and get grounded answers.  
- **Search** raw embeddings for debugging or custom use.  
- **Clear** and re-index collections when switching embedding models.  

---

## Requirements

- macOS (tested on MacBook Pro 16GB RAM / 256GB SSD)  
- [Homebrew](https://brew.sh/)  
- [Docker Desktop](https://www.docker.com/products/docker-desktop) (for Qdrant)  
- [Node.js](https://nodejs.org/) v18+  
- [Ollama](https://ollama.com/)  

### Ollama models (already installed)

```bash
ollama list
```
```
NAME                       SIZE
nomic-embed-text:latest    274 MB   # embeddings (768-dim)
qwen2.5-coder:7b           4.7 GB   # code reasoning / patch planning
llama3.1:8b                4.9 GB   # natural-language Q&A
all-minilm:latest           45 MB   # optional lightweight embedder
```

---

## Setup

Clone your repo and the agent:

```bash
git clone https://github.com/SatyamAnand98/agent ~/Downloads/agentTest/agent
cd ~/Downloads/agentTest/agent
npm install
```

Start **Qdrant**:

```bash
docker compose up -d
```

Configure `agent.config.json`:

```json
{
  "codebasePath": "/Users/satyamanand/Downloads/gumlet", // replace this path with your code base
  "collection": "code_chunks",
  "embedModel": "nomic-embed-text",
  "llmModel": "qwen2.5-coder:7b",
  "include": ["**/*.{ts,tsx,js,jsx,py,go,rb,java,cs,php}", "**/*.{md,txt,json,yml,yaml}"],
  "exclude": ["node_modules/**", ".git/**", "dist/**", "build/**", "**/*.min.*", "**/*.lock"],
  "maxFileBytes": 200000,
  "chunk": { "lines": 120, "overlap": 20 },
  "dryRun": true
}
```

---

## Usage

All commands are npm scripts. Run them inside `agent/`.

### 1. Index your codebase
```bash
npm run index
```
Creates vector embeddings for all source files.

### 2. Analyze a prompt
```bash
npm run analyze
```
Reads `prompt.txt` and shows the top-matching files/snippets.

### 3. Apply a plan
```bash
npm run apply
```
Suggests or applies code changes (respects `dryRun` in config).  
- `dryRun: true` → only shows what it *would* change.  
- `dryRun: false` → actually writes patches to your repo.  

### 4. Locate relevant code
```bash
npm run locate -- "where is caching implemented?"
```
Semantic + keyword search across the repo.

### 5. Ask natural language questions
```bash
npm run ask -- "Give me short descriptions of all webhook events"
```
If no argument, it reads the `prompt:` block in `prompt.txt`.

### 6. Search raw embeddings
```bash
npm run search -- "jwt verification"
```

### 7. Clear collection
```bash
npm run clear
```
Deletes the current Qdrant collection (use before re-indexing with a different embed model).

### 8. Start (index → analyze → ask)
```bash
npm start
```

---

## Workflow Example

1. Write your task in `prompt.txt`:
   ```yaml
   jira: https://gumlet.atlassian.net/browse/GUM-1866
   topic: IO River cache purge
   description: Add cache purging for image & video
   prompt: >
     Implement cache purging for image and video using IO River API:
       - Create service client
       - Wire into /v1/purge route
       - Support paths/tags/all
   ```

2. Index (first time):
   ```bash
   npm run index
   ```

3. Analyze:
   ```bash
   npm run analyze
   ```

4. Apply (dry-run):
   ```bash
   npm run apply
   ```

5. Review diffs → flip `"dryRun": false` → re-run `apply`.

---

## Qdrant Dashboard

Visit [http://localhost:6333/dashboard](http://localhost:6333/dashboard) to inspect collections, chunks, and embeddings.

---

## Notes

- Works **offline** — no API calls outside your machine.  
- `qwen2.5-coder:7b` is ideal for code refactoring.  
- `llama3.1:8b` is a good switch for “explain” style Q&A.  
- You can safely re-run `index` after large codebase changes.  
- Always commit your repo before running with `dryRun: false`.
