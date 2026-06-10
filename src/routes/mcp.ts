import { Router } from "express"
import OpenAI from "openai"
import { addMemory, getMemoryContext } from "../memory/store"

const router = Router()
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

router.post("/", async (req, res) => {
  try {
    const { input, agentId } = req.body

if (!agentId) {
  return res.status(400).json({ error: "Missing agentId" })
}

addMemory(agentId, input)

const memoryContext = getMemoryContext(agentId)

    if (!input) {
      return res.status(400).json({ error: "Missing input" })
    }

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
You are a planning engine.

You have memory of previous queries:
${memoryContext}

Use this to improve your answer.

Return ONLY valid JSON.

Format:
{
  "title": "",
  "summary": "",
  "steps": [
    { "id": "1", "text": "" }
  ],
  "graph": {
    "nodes": [
      { "id": "1", "label": "" }
    ],
    "edges": [
      { "from": "1", "to": "2" }
    ]
  }
}
`
        },
        {
          role: "user",
          content: input
        }
      ],
      temperature: 0.2
    })

    const content = completion.choices?.[0]?.message?.content

    if (!content) {
      return res.status(500).json({ error: "No response from AI" })
    }

    let data

    try {
      data = JSON.parse(content)
    } catch {
      return res.status(500).json({ error: "Invalid JSON" })
    }

    return res.json({
      tool: "locali.run",
      result: data
    })

  } catch {
    return res.status(500).json({ error: "MCP failed" })
  }
})

export default router