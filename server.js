import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { QdrantClient } from "@qdrant/js-client-rest";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

const PORT = process.env.SERVER_PORT || 3000;
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || "php_codebase";
const EMBED_SERVER = process.env.EMBED_SERVER || "http://localhost:8001/embed";
const TOP_K = parseInt(process.env.TOP_K || "5");

const app = express();
app.use(express.json());

const qdrant = new QdrantClient({ url: QDRANT_URL });

// Funkcja do uzyskania embeddingu zapytania
async function getQueryEmbedding(query) {
  const res = await fetch(EMBED_SERVER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([query])
  });
  const data = await res.json();

  return data.embeddings[0]; // zwraca wektor pojedynczego zapytania
}

// Endpoint RAG
app.post("/search", async (req, res) => {
  const { query, topK } = req.body;
  if (!query) return res.status(400).json({ error: "Missing `query` in request body" });

  try {
    const embedding = await getQueryEmbedding(query);

    const searchResult = await qdrant.search(QDRANT_COLLECTION, {
      vector: embedding,
      limit: topK || TOP_K,
      with_payload: true
    });

    // Zwracamy top-N chunków z payload
    const chunks = searchResult.map(r => ({
      id: r.id,
      score: r.score,
      file: r.payload.file,
      chunk_index: r.payload.chunk_index,
      text: r.payload.content || null  // jeśli chcesz dodać cały tekst do RAG
    }));

    res.json({ query, topK: chunks.length, results: chunks });
  } catch (err) {
    console.error("❌ Search error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 RAG server running at http://localhost:${PORT}`);
  console.log(`💡 POST /search { "query": "...", "topK": 5 }`);
});

