import fs from "fs"
import path from "path"

type MemoryItem = {
  query: string
  timestamp: number
}

// Define where the memory will be saved
const MEMORY_FILE = path.join(__dirname, "memory.json")

// Load existing memory from disk, or start fresh if it doesn't exist
let memory: Record<string, MemoryItem[]> = {}

if (fs.existsSync(MEMORY_FILE)) {
  try {
    const data = fs.readFileSync(MEMORY_FILE, "utf-8")
    memory = JSON.parse(data)
  } catch (e) {
    console.error("Failed to parse memory.json, starting fresh.")
    memory = {}
  }
}

// Helper to save memory to disk
function saveMemory() {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2))
}

export function addMemory(agentId: string, query: string) {
  if (!memory[agentId]) {
    memory[agentId] = []
  }

  memory[agentId].push({
    query,
    timestamp: Date.now()
  })

  // Keep only the last 10 queries per agent to prevent massive files
  if (memory[agentId].length > 10) {
    memory[agentId].shift()
  }

  // Save to disk every time a new memory is added
  saveMemory()
}

export function getMemoryContext(agentId: string) {
  if (!memory[agentId]) return ""

  return memory[agentId].map(m => m.query).join("\n")
}