import "dotenv/config"
import express, { Request, Response } from "express"
import cors from "cors"
import Groq from "groq-sdk"
import { safeParseJSON } from "./utils/parseAI"
import { sites } from "./data/sites"
import { registerSite } from "./sdk/register"
import { discovery } from "./data/discovery"
import { search } from "./sdk/search"
import { resolveAction } from "./sdk/resolve"
import searchRoute from "./routes/search"
import searchPage from "./routes/searchPage"
import mcpRoute from "./routes/mcp"
import mcpToolsRouter from "./routes/mcpTools"

const app = express()

app.use(cors())
app.use(express.json())

// Open AI-Native Internet Endpoints (No Keys, Pure Protocol)
app.use("/mcp/tools", mcpToolsRouter)
app.use("/mcp", mcpRoute)
app.use("/api/search", searchRoute)
app.use("/search", searchPage)

function mustString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

/**
 * NATIVE GROQ INITIALIZATION
 */
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
})

/**
 * TYPES
 */
type GraphNode = {
  domain: string
  actions: string[]
  links: string[]
}

type Session = {
  id: string
  memory: Record<string, any>
}

type ParsedIntent = {
  raw: string
  intent: string
}

/**
 * STATE
 */
const graph: Record<string, GraphNode> = {}
const sessions: Record<string, Session> = {}

/**
 * SESSION
 */
function getSession(sessionId?: string) {
  if (!sessionId) return null

  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      id: sessionId,
      memory: {}
    }
  }

  return sessions[sessionId]
}

/**
 * GRAPH BUILD
 */
function buildGraph() {
  Object.entries(sites).forEach(([domain, site]) => {
    graph[domain] = {
      domain,
      actions: site.actions.map(a => a.id),
      links: []
    }
  })

  for (const a of Object.keys(graph)) {
    for (const b of Object.keys(graph)) {
      if (a === b) continue

      const siteA = sites[a as keyof typeof sites]
      const siteB = sites[b as keyof typeof sites]

      if (!siteA || !siteB) continue

      const nameA = siteA.name.toLowerCase()
      const nameB = siteB.name.toLowerCase()

      const firstWordA = nameA.split(" ")[0] ?? ""
      const firstWordB = nameB.split(" ")[0] ?? ""

      if (
        nameA.includes(firstWordB) ||
        nameB.includes(firstWordA)
      ) {
        graph[a]?.links.push(b)
      }
    }
  }
}

buildGraph()

/**
 * SMART GRAPH TRAVERSAL
 */
async function traverseGraph(start: string, query: string) {
  const visited = new Set<string>()
  const path: any[] = []

  let current: string | undefined = start

  for (let i = 0; i < 3; i++) {
    if (!current || visited.has(current)) break

    const site = sites[current as keyof typeof sites]
    if (!site) break

    visited.add(current)

    const results = search(query)

    const node = graph[current]
    if (!node) break

    const possibleDomains = [current, ...node.links]

    let best: any = null
    let bestScore = 0

    for (const r of results) {
      if (possibleDomains.includes(r.domain) && r.score > bestScore) {
        best = r
        bestScore = r.score
      }
    }

    if (!best) break

    const action = site.actions.find(a => a.id === best.action)
    if (!action) break

    const result = await resolveAction(current, action.id, query)

    path.push({
      domain: current,
      action: action.id,
      result
    })

    /**
     * 🔥 SMART NEXT STEP
     */
    const nextOptions = node.links

    let bestNext: string | undefined
    let nextScore = 0

    for (const option of nextOptions) {
      const match = results.find(r => r.domain === option)

      if (match && match.score > nextScore) {
        nextScore = match.score
        bestNext = option
      }
    }

    current = bestNext
  }

  return path
}

/**
 * ROOT
 */
app.get("/", (req: Request, res: Response) => {
  res.json({
    name: "locali.run",
    description: "AI-accessible internet layer — Locali AI Web Protocol (LAWP)"
  })
})

/**
 * SEARCH
 */
app.get("/search", (req: Request, res: Response) => {
  const q = mustString(req.query.q)

  if (!q) return res.json({ error: "missing query" })

  return res.json({
    query: q,
    results: search(q)
  })
})

/**
 * RESOLVE
 */
app.get("/resolve", async (req: Request, res: Response) => {
  const domain = mustString(req.query.domain)
  const action = mustString(req.query.action)
  const input = mustString(req.query.input)

  if (!domain || !action) {
    return res.json({ error: "missing domain or action" })
  }

  const result = await resolveAction(domain, action, input ?? undefined)

  return res.json(result)
})

/**
 * ACT
 */
app.post("/act", async (req: Request, res: Response) => {
  const { domain, actionId, input } = req.body

  if (!domain || !actionId) {
    return res.json({ error: "missing fields" })
  }

  const result = await resolveAction(domain, actionId, input)

  return res.json(result)
})

/**
 * AI (GROQ)
 */
app.post("/ai", async (req: Request, res: Response) => {
  const { query } = req.body

  if (!query) {
    return res.json({ error: "missing query" })
  }

  const results = search(query)

  if (!results.length) {
    return res.json({ error: "no results" })
  }

  const formatted = results
    .map(r => `${r.domain} -> ${r.action} (score: ${r.score})`)
    .join("\n")

  const prompt = `
User query: "${query}"

Available actions:
${formatted}

Pick the BEST action.
Respond ONLY in JSON like:
{ "domain": "...", "action": "..." }
`

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }]
    })

    const text = completion.choices[0]?.message?.content || "{}"

    let parsed
    try {
      parsed = safeParseJSON(text)

      if (!parsed) {
        return res.json({
          error: "AI parsing failed",
          raw: text
        })
      }
    } catch {
      return res.json({
        error: "invalid AI JSON",
        raw: text,
        debug: { results }
      })
    }

    return res.json({
      query,
      ai_pick: parsed,
      debug: {
        results
      }
    })

  } catch (err) {
    return res.json({ error: "groq failed", details: err })
  }
})

//Plan
app.post("/plan", async (req: Request, res: Response) => {
  const { query } = req.body

  if (!query) {
    return res.json({ error: "missing query" })
  }

  const results = search(query)

  if (!results.length) {
    return res.json({ error: "no results" })
  }

  const formatted = results
    .map(r => `${r.domain} -> ${r.action}`)
    .join("\n")

  const prompt = `
User query: "${query}"

Available actions:
${formatted}

Create a STEP-BY-STEP plan.

Respond ONLY in JSON like:
[
  { "domain": "...", "action": "..." }
]
`

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }]
    })

    const text = completion.choices[0]?.message?.content || "[]"

    let plan
    try {
      plan = safeParseJSON(text)

      if (!Array.isArray(plan)) {
        return res.json({
          error: "invalid plan format",
          raw: text
        })
      }
    } catch {
      return res.json({ error: "invalid AI JSON", raw: text })
    }

    const outputs = []

    for (const step of plan) {
      if (!step.domain || !step.action) continue

      const result = await resolveAction(
        step.domain,
        step.action,
        query
      )

      outputs.push({
        step,
        result
      })
    }

    return res.json({
      query,
      plan,
      outputs
    })

  } catch (err) {
    return res.json({ error: "groq failed", details: err })
  }
})

//Debug
app.post("/debug", async (req: Request, res: Response) => {
  const { query, start } = req.body

  if (!query) {
    return res.json({ error: "missing query" })
  }

  const results = search(query)
  const path = start ? await traverseGraph(start, query) : []

  return res.json({
    query,
    search_results: results,
    graph_path: path
  })
})

/**
 * NAVIGATE
 */
app.post("/navigate", async (req: Request, res: Response) => {
  const { start, query } = req.body

  if (!start || !query) {
    return res.json({ error: "missing start or query" })
  }

  const path = await traverseGraph(start, query)

  return res.json({
    start,
    query,
    path
  })
})

/**
 * DEMO UI (Phase 4 Showcase)
 */
app.get("/demo", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>locali.run // AI Vision</title>
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
          background: #0a0a0a; 
          color: #ededed; 
          max-width: 800px; 
          margin: 0 auto; 
          padding: 4rem 2rem; 
        }
        h1 { font-weight: 600; letter-spacing: -0.05em; margin-bottom: 2rem; }
        .tag { font-size: 0.9rem; color: #888; font-weight: normal; margin-left: 0.5rem; }
        input { 
          width: 100%; 
          padding: 1.2rem; 
          background: #111; 
          border: 1px solid #333; 
          color: white; 
          border-radius: 12px; 
          margin-bottom: 2rem; 
          font-size: 1.1rem; 
          outline: none;
          transition: border-color 0.2s;
        }
        input:focus { border-color: #666; }
        .step { 
          background: #111; 
          border: 1px solid #222; 
          padding: 1.5rem; 
          border-radius: 12px; 
          margin-bottom: 1rem; 
          animation: fadeIn 0.5s ease-out;
        }
        .domain { color: #888; font-size: 0.85rem; margin-bottom: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em;}
        .action { font-size: 1.2rem; font-weight: 600; margin-bottom: 1rem; color: #fff; }
        .result { 
          background: #000; 
          padding: 1rem; 
          border-radius: 8px; 
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; 
          font-size: 0.9rem;
          color: #10b981;
          white-space: pre-wrap; 
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      </style>
    </head>
    <body>
      <h1>locali.run <span class="tag">AI Web Protocol v1</span></h1>
      <input type="text" id="query" placeholder="Ask the AI agent (e.g. 'book a haircut and check weather')..." autocomplete="off" />
      <div id="output"></div>

      <script>
        document.getElementById('query').addEventListener('keypress', async (e) => {
          if (e.key === 'Enter') {
            const q = e.target.value;
            const out = document.getElementById('output');
            out.innerHTML = '<p style="color: #888;">AI is parsing intent and navigating the LAWP network...</p>';

            try {
              const res = await fetch('/ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: q })
              });
              const data = await res.json();

              if(data.ai_pick) {
                out.innerHTML = \`
                  <div class="step">
                    <div class="domain">Target Node // \${data.ai_pick.domain}</div>
                    <div class="action">Action selected: \${data.ai_pick.action}</div>
                    <div class="result">\${JSON.stringify(data.debug?.results, null, 2)}</div>
                  </div>
                \`;
              } else {
                out.innerHTML = '<p style="color: #ef4444;">No LAWP nodes matched the intent.</p>';
              }
            } catch (err) {
              out.innerHTML = '<p style="color: #ef4444;">Connection failed.</p>';
            }
          }
        });
      </script>
    </body>
    </html>
  `);
});

// CRITICAL VERCEL CONFIG: Only bind server listener if running locally
if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 3000
  app.listen(PORT, () => console.log(`locali.run running local on port ${PORT}`))
}

export default app