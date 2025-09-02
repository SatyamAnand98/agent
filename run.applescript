(*
  Local Code Agent bootstrap for macOS
  - Installs Homebrew (if needed)
  - Installs Docker Desktop, Ollama, Node, jq
  - Starts Docker and waits until ready
  - Starts Ollama service and pulls models
  - Runs docker compose for Qdrant
  - npm install, index, analyze in your agent folder

  Adjust these two paths if your folders move:
*)
on run
  set agentDir to "/Users/satyamanand/Downloads/agentTest/agent"
  set codebaseDir to "/Users/satyamanand/Downloads/gumlet"

  set logFile to agentDir & "/setup_agent.log"
  my sh("mkdir -p " & my q(agentDir))
  my sh("echo '--- Local Code Agent setup started ---' > " & my q(logFile))

  -- Ensure Command Line Tools (won't block if already installed)
  try
    my sh("xcode-select -p >/dev/null 2>&1 && echo '[ok] Xcode CLT present' | tee -a " & my q(logFile))
  on error
    try
      do shell script "xcode-select --install >/dev/null 2>&1 || true"
      my sh("echo '[note] Triggered Xcode CLT installer (GUI). You can continue after it completes.' | tee -a " & my q(logFile))
    end try
  end try

  -- Install Homebrew if missing
  set brewCheck to my shOut("bash -lc 'command -v brew >/dev/null 2>&1 && echo yes || echo no'")
  if brewCheck contains "no" then
    do shell script "bash -lc " & my q("NONINTERACTIVE=1 /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"") with administrator privileges
    my sh("echo '[ok] Homebrew installed' | tee -a " & my q(logFile))
  else
    my sh("echo '[ok] Homebrew present' | tee -a " & my q(logFile))
  end if

  -- Common PATH for shells launched by AppleScript
  set envPath to "export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin; "
  
  -- Install core tools (Ollama, Node, jq) and Docker Desktop
  do shell script "bash -lc " & my q(envPath & "brew update && brew install ollama node jq && brew install --cask docker") with administrator privileges
  my sh("echo '[ok] Installed ollama, node, jq, and Docker Desktop (via Homebrew)' | tee -a " & my q(logFile))

  -- Start Docker Desktop and wait for engine
  do shell script "bash -lc " & my q(envPath & "open -a Docker || true")
  my sh("echo '[...] Waiting for Docker engine...' | tee -a " & my q(logFile))
  my sh("bash -lc " & my q(envPath & "i=0; until docker system info >/dev/null 2>&1; do i=$((i+1)); if [ $i -gt 120 ]; then echo '[err] Docker did not become ready in time' | tee -a " & my q(logFile) & "; exit 1; fi; sleep 3; done; echo '[ok] Docker engine ready' | tee -a " & my q(logFile)))

  -- Start Ollama as a background service and pull models
  my sh("bash -lc " & my q(envPath & "brew services start ollama >/dev/null 2>&1 || true"))
  my sh("bash -lc " & my q(envPath & "sleep 2; ollama serve >/dev/null 2>&1 & disown || true"))
  my sh("echo '[...] Pulling Ollama models (nomic-embed-text, qwen2.5-coder:7b)...' | tee -a " & my q(logFile))
  my sh("bash -lc " & my q(envPath & "ollama pull nomic-embed-text && ollama pull qwen2.5-coder:7b")) -- will reuse cache if already present
  my sh("echo '[ok] Models available' | tee -a " & my q(logFile))

  -- Ensure agent folder exists and install deps
  my sh("bash -lc " & my q(envPath & "cd " & my q(agentDir) & " && npm install"))
  my sh("echo '[ok] npm install finished' | tee -a " & my q(logFile))

  -- Bring up Qdrant (docker compose from the agent folder)
  my sh("bash -lc " & my q(envPath & "cd " & my q(agentDir) & " && docker compose up -d"))
  my sh("echo '[ok] Qdrant up (docker compose)' | tee -a " & my q(logFile))

  -- Create a minimal prompt.txt if none exists
  my sh("bash -lc " & my q(envPath & "cd " & my q(agentDir) & " && if [ ! -f prompt.txt ]; then cat > prompt.txt <<'EOF'\njira: https://gumlet.atlassian.net/browse/GUM-1866\ntopic: IO River cache purge for image & video\ndescription: add cache purging for image & video using https://www.ioriver.io/docs/api/purge/\nprompt: >\n  Implement cache purging for image and video using IO River API.\n  1) create service client\n  2) expose /v1/purge/ioriver\n  3) support paths/tags/all\nEOF\nfi"))
  my sh("echo '[ok] prompt.txt ready' | tee -a " & my q(logFile))

  -- Index the codebase into Qdrant
  my sh("echo '[...] Indexing codebase...' | tee -a " & my q(logFile))
  my sh("bash -lc " & my q(envPath & "cd " & my q(agentDir) & " && npm run index 2>&1 | tee -a " & my q(logFile)))
  my sh("echo '[ok] Index complete' | tee -a " & my q(logFile))

  -- Analyze (dry-run)
  my sh("echo '[...] Analyze (dry-run) ...' | tee -a " & my q(logFile))
  my sh("bash -lc " & my q(envPath & "cd " & my q(agentDir) & " && npm run analyze 2>&1 | tee -a " & my q(logFile)))

  -- Optional: locate (helpful for discovery)
  my sh("bash -lc " & my q(envPath & "cd " & my q(agentDir) & " && if npm run | grep -q ' locate'; then npm run locate 2>&1 | tee -a " & my q(logFile) & "; fi"))

  -- Done
  my sh("echo '--- Setup finished ---' | tee -a " & my q(logFile))
  display notification "Setup + index + analyze complete. See setup_agent.log in your agent folder." with title "Local Code Agent"
end run

-- Helpers

on sh(cmd)
  set full to "bash -lc 'export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin; " & cmd & "'"
  do shell script full
end sh

on shOut(cmd)
  set full to "bash -lc '" & cmd & "'"
  return do shell script full
end shOut

on q(s)
  return quoted form of s
end q
