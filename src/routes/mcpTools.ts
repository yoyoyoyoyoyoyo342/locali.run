import { Router, Request, Response } from "express"

const router = Router()

router.get("/", (req: Request, res: Response) => {
  return res.json({
    tools: [
      {
        name: "locali_search",
        description: "Search the AI-native internet layer for structured plans, steps, and visual graph dependencies.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The goal or intent to map out (e.g., 'how to build a saas')"
            },
            agentId: {
              type: "string",
              description: "Unique identifier for the calling agent to isolate session memory."
            }
          },
          required: ["query", "agentId"]
        }
      }
    ]
  })
})

export default router