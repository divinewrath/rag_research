import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { QdrantClient } from "@qdrant/js-client-rest";

dotenv.config();

const {
    SERVER_PORT = 3000,
    QDRANT_URL = "http://localhost:6333",
    QDRANT_COLLECTION = "php_codebase",
    EMBED_SERVER = "http://localhost:8001/embed",
    TOP_K = "5"
} = process.env;

const TOP_K_VALUE = parseInt(TOP_K);

const app = express();
app.use(express.json());

const qdrant = new QdrantClient({ url: QDRANT_URL });

async function getQueryEmbedding(query) {
  const res = await fetch(EMBED_SERVER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([query])
  });
  const data = await res.json();

  return data.embeddings[0];
}

app.post("/search", async (req, res) => {
  const { query, topK } = req.body;
  if (!query) return res.status(400).json({ error: "Missing `query` in request body" });

  try {
    const embedding = await getQueryEmbedding(query);

    const searchResult = await qdrant.search(QDRANT_COLLECTION, {
      vector: embedding,
      limit: topK || TOP_K_VALUE,
      with_payload: true
    });

    const chunks = searchResult.map(r => ({
      id: r.id,
      score: r.score,
      file: r.payload.file,
      chunk_index: r.payload.chunk_index,
      text: r.payload.content || null
    }));

    res.json({ query, topK: chunks.length, results: chunks });
  } catch (err) {
    console.error("❌ Search error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(SERVER_PORT, () => {
  console.log(`🚀 RAG server running at http://localhost:${SERVER_PORT}`);
  console.log(`💡 POST /search { "query": "...", "topK": 5 }`);
});

