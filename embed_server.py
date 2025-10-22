from fastapi import FastAPI, Body
from sentence_transformers import SentenceTransformer
import uvicorn

app = FastAPI()
model = SentenceTransformer("intfloat/e5-small-v2")

@app.post("/embed")
def embed(texts: list[str] = Body(...)):
    embeddings = model.encode(texts, normalize_embeddings=True)
    return {"embeddings": embeddings.tolist()}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
