import fs from "fs/promises";
import { existsSync } from "node:fs";
import path from "mode:path";
import crypto from "node:crypto";
import dotenv from "dotenv";
import FastGlob from "fast-glob";
import { QdrantClient } from "@qdrant/js-client-rest";
import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

const {
  QDRANT_URL = "http://localhost:6333",
  QDRANT_COLLECTION = "php_codebase",
  CHUNK_SIZE = "1000",
  CHUNK_OVERLAP = "150",
  BATCH_SIZE = "128",
  EMBED_SERVER = "http://localhost:8001/embed",
} = process.env;

const CHUNK = parseInt(CHUNK_SIZE);
const OVERLAP = parseInt(CHUNK_OVERLAP);
const BATCH = parseInt(BATCH_SIZE);
const INDEXED_FILE = "indexed.json";
const PATHS_FILE = "paths.txt";
const IGNORED_FILES = ["registration.php"];

async function getEmbeddings(texts) {
  const res = await fetch(EMBED_SERVER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(texts)
  });
  const data = await res.json();

  return data.vectors;
}

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

async function readPaths() {
  if (!existsSync(PATHS_FILE)) throw new Error(`Brak pliku ${PATHS_FILE}`);
  const raw = await fs.readFile(PATHS_FILE, "utf8");
  return raw.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));
}

async function scanPhpFiles(dirs, filesToOmit = []) {
  const patterns = dirs.map(d => path.join(d, "**/*.php"));
    const ignorePatterns = filesToOmit.map(f => `**/${f}`);
    return await FastGlob(patterns, {
      absolute: true,
      followSymbolicLinks: true,
      ignore: ignorePatterns,
  });
}

function chunkText(text, size = CHUNK, overlap = OVERLAP) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

async function loadIndexed() {
  if (!existsSync(INDEXED_FILE)) return {};
  return JSON.parse(await fs.readFile(INDEXED_FILE, "utf8"));
}

async function saveIndexed(indexed) {
  await fs.writeFile(INDEXED_FILE, JSON.stringify(indexed, null, 2), "utf8");
}

const qdrant = new QdrantClient({ url: QDRANT_URL });

async function ensureCollection(vectorSize) {
  try {
    await qdrant.getCollection(QDRANT_COLLECTION);
  } catch {
    console.log("Tworzę kolekcję:", QDRANT_COLLECTION);
    await qdrant.createCollection(QDRANT_COLLECTION, {
      vectors: { size: vectorSize, distance: "Cosine" }
    });
  }
}

async function main() {
  console.log("🔍 Start indeksowania kodu PHP do Qdrant z e5-small-v2...");

  const dirs = await readPaths();
  const files = await scanPhpFiles(dirs, IGNORED_FILES);
  console.log(`📁 Znaleziono ${files.length} plików PHP.`);

  const indexed = await loadIndexed();
  const toProcess = [];

  for (const file of files) {
    try {
      const content = await fs.readFile(file, "utf8");
      const hash = sha1(content);
      if (indexed[file] === hash) continue;
      toProcess.push({ file, content, hash });
    } catch (err) {
      console.warn("❗ Błąd odczytu pliku:", file, err.message);
    }
  }

  if (!toProcess.length) {
    console.log("✅ Brak nowych plików do indeksowania.");
    return;
  }

  const allChunks = [];
  for (const { file, content } of toProcess) {
    const chunks = chunkText(content);
    chunks.forEach((chunk, i) => {
      allChunks.push({
        id: `${sha1(file)}-${i}`,
        text: chunk,
        payload: { file, chunk_index: i }
      });
    });
  }

  console.log(`🧩 Łącznie ${allChunks.length} chunków do embeddowania.`);

  let collectionCreated = false;

  for (let i = 0; i < allChunks.length; i += BATCH) {
    const batch = allChunks.slice(i, i + BATCH);
    const texts = batch.map(b => b.text);

    console.log(`→ Batch ${i / BATCH + 1}/${Math.ceil(allChunks.length / BATCH)}: ${texts.length} fragmentów...`);
    const vectors = await getEmbeddings(texts);

    if (!collectionCreated) {
      await ensureCollection(vectors[0].length);
      collectionCreated = true;
    }

    const points = batch.map((b, idx) => ({
      id: uuidv4(),
      vector: vectors[idx],
      payload: {
          file: b.file,
          chunk_index: b.payload.chunk_index,
          content: b.text,
      }
    }));

    await qdrant.upsert(QDRANT_COLLECTION, { points });
  }

  for (const { file, hash } of toProcess) indexed[file] = hash;
  await saveIndexed(indexed);

  console.log("✅ Indeksowanie zakończone!");
}

main().catch(err => {
  console.error("💥 Błąd:", err);
  process.exit(1);
});
