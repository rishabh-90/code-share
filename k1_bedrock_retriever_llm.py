#!/usr/bin/env python3
"""
K-1 Retriever + LLM Extractor (AWS Bedrock Edition)
---------------------------------------------------

No OCR. No layout regex. Up to 100 keys.

What it does
- Loads a K-1 PDF (digital text) and splits it into page/paragraph chunks
- Embeds all chunks with **Amazon Titan Embeddings v2** via Bedrock
- For each key (<=100) with a short definition, retrieves top-N relevant chunks (cosine)
- Calls **Anthropic Claude 3 Haiku** on Bedrock to extract:
  {"key":"","value":"","page":0,"evidence":"","confidence":0.0}
- Applies light type validation (date, year, number, percent, EIN)
- Writes results to JSON + CSV with page citations

Prereqs
  - AWS credentials configured with access to Bedrock in your region
  - Region example: us-east-1 or us-west-2 (enable Bedrock models there)
  - Python packages:
      pip install pymupdf boto3 numpy python-dateutil pydantic
  - Keys JSON (<=100 keys) like:
    [
      {"key":"FDK1_PSHIP_EIN","definition":"Employer Identification Number of the partnership (9 digits)","type":"ein"},
      {"key":"FDK1_CURRENT_YEAR","definition":"Tax year for the K-1, 4-digit year","type":"year"},
      {"key":"FDK1_CALENDAR_START","definition":"Start date of the tax period, Month D, YYYY","type":"date"},
      {"key":"FDK1_CALENDAR_END","definition":"End date of the tax period, Month D, YYYY","type":"date"}
    ]

Usage
  python k1_bedrock_retriever_llm.py --pdf /path/to/k1.pdf --keys /path/to/keys.json --out outdir --region us-east-1 --topk 3

Notes
- Bedrock model IDs default to:
    EMBED_MODEL = "amazon.titan-embed-text-v2:0"
    LLM_MODEL   = "anthropic.claude-3-haiku-20240307-v1:0"
  You can override with CLI flags.
"""

import argparse
import json
import sys
from typing import List, Tuple, Dict, Any

import fitz  # PyMuPDF
import boto3
import numpy as np
from pydantic import BaseModel
from dateutil.parser import parse as dateparse
from botocore.exceptions import BotoCoreError, ClientError

# ----------------------------
# Defaults (can override via CLI)
# ----------------------------

DEFAULT_EMBED_MODEL = "amazon.titan-embed-text-v2:0"
DEFAULT_LLM_MODEL   = "anthropic.claude-3-haiku-20240307-v1:0"

# ----------------------------
# Data models
# ----------------------------

class KeyDef(BaseModel):
    key: str
    definition: str
    type: str = "string"  # string | number | percent | date | year | ein

class Hit(BaseModel):
    key: str
    value: str
    page: int
    evidence: str
    confidence: float = 0.0
    method: str = "llm"

# ----------------------------
# PDF chunking
# ----------------------------

def chunk_pdf(pdf_path: str, max_chars: int = 1200) -> List[Tuple[int, str]]:
    doc = fitz.open(pdf_path)
    chunks: List[Tuple[int, str]] = []
    for i in range(len(doc)):
        pno = i + 1
        text = doc[i].get_text("text") or ""
        text = text.replace("\r", "\n")
        text = "\n".join(line.strip() for line in text.splitlines())
        start = 0
        while start < len(text):
            end = min(len(text), start + max_chars)
            chunk = text[start:end]
            last_nl = chunk.rfind("\n")
            if last_nl > 400:
                end = start + last_nl
                chunk = text[start:end]
            if chunk.strip():
                chunks.append((pno, chunk.strip()))
            start = end
    doc.close()
    return chunks

# ----------------------------
# Bedrock clients
# ----------------------------

def get_bedrock_client(region: str):
    return boto3.client("bedrock-runtime", region_name=region)

# ----------------------------
# Embeddings
# ----------------------------

def embed_texts(client, model_id: str, texts: List[str]) -> np.ndarray:
    out_vecs: List[List[float]] = []
    B = 16
    for i in range(0, len(texts), B):
        batch = texts[i:i+B]
        try:
            body = {
                "inputText": batch if len(batch) > 1 else batch[0],
                "embeddingConfig": {"outputEmbeddingLength": 1024}
            }
            resp = client.invoke_model(
                modelId=model_id,
                accept="application/json",
                contentType="application/json",
                body=json.dumps(body).encode("utf-8"),
            )
            payload = json.loads(resp["body"].read().decode("utf-8"))
            # Titan v2 returns {"embeddings":[{"embedding":[...]}]} for list input
            if "embeddings" in payload:
                for e in payload["embeddings"]:
                    out_vecs.append(e["embedding"])
            elif "embedding" in payload:
                out_vecs.append(payload["embedding"])
            else:
                raise RuntimeError(f"Unexpected embedding payload keys: {list(payload.keys())}")
        except (BotoCoreError, ClientError) as e:
            print(f"[ERROR] Bedrock embeddings call failed: {e}", file=sys.stderr)
            raise
    return np.array(out_vecs, dtype=np.float32)

def cosine_sim(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    a_norm = a / np.clip(np.linalg.norm(a, axis=1, keepdims=True), 1e-9, None)
    b_norm = b / np.clip(np.linalg.norm(b, axis=1, keepdims=True), 1e-9, None)
    return a_norm @ b_norm.T

def build_index(client, embed_model: str, chunks: List[Tuple[int, str]]) -> Dict[str, Any]:
    pages = [p for p,_ in chunks]
    texts = [t for _,t in chunks]
    vecs = embed_texts(client, embed_model, texts)
    return {"pages": np.array(pages), "texts": texts, "vecs": vecs}

def retrieve_for_key(client, embed_model: str, index: Dict[str, Any], keydef: KeyDef, top_k: int = 3) -> List[Tuple[int, str]]:
    query = f"Extract value for key '{keydef.key}'. Definition: {keydef.definition}"
    qvec = embed_texts(client, embed_model, [query])
    sims = cosine_sim(qvec, index["vecs"])[0]
    top_idx = np.argsort(-sims)[:top_k]
    out = []
    for idx in top_idx:
        out.append((int(index["pages"][idx]), index["texts"][idx]))
    return out

# ----------------------------
# Claude 3 Haiku on Bedrock
# ----------------------------

def claude_messages_bedrock(client, model_id: str, system_prompt: str, user_prompt: str, max_tokens: int = 1024, temperature: float = 0.0) -> str:
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens,
        "temperature": temperature,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": [{"type": "text", "text": user_prompt}]}
        ]
    }
    try:
        resp = client.invoke_model(
            modelId=model_id,
            accept="application/json",
            contentType="application/json",
            body=json.dumps(body).encode("utf-8"),
        )
        data = json.loads(resp["body"].read().decode("utf-8"))
        # Extract text
        out_text = ""
        for item in data.get("content", []):
            if item.get("type") == "text":
                out_text += item.get("text", "")
        return out_text.strip()
    except (BotoCoreError, ClientError) as e:
        print(f"[ERROR] Bedrock Claude call failed: {e}", file=sys.stderr)
        raise

def llm_extract(client, llm_model: str, keydef: KeyDef, contexts: List[Tuple[int, str]]) -> Hit:
    ctx_blocks = []
    for pno, txt in contexts:
        ctx_blocks.append(f"--- Page {pno} ---\n{txt}\n")
    ctx_concat = "\n".join(ctx_blocks)[:12000]

    system_prompt = (
        "You are an extraction assistant. Return ONLY strict JSON. "
        "Schema: {\"key\":\"\",\"value\":\"\",\"page\":0,\"evidence\":\"\",\"confidence\":0.0}. "
        "Use page numbers from the provided context. Omit prose."
    )
    user_prompt = f"""
Extract a single field from the K-1 context.

Field:
- key: {keydef.key}
- definition: {keydef.definition}
- type rule: {{
  "string": "exact string",
  "number": "parse as decimal number",
  "percent": "numeric percent (e.g., 12.5)",
  "date": "ISO YYYY-MM-DD if possible",
  "year": "4-digit year YYYY",
  "ein": "9-digit in NN-NNNNNNN format if possible"
}} (use: {keydef.type})

Context (candidate snippets):
{ctx_concat}

Return ONLY JSON as:
{{"key":"","value":"","page":0,"evidence":"","confidence":0.0}}

If not found, return {{}}
"""

    raw = claude_messages_bedrock(client, llm_model, system_prompt, user_prompt, max_tokens=800, temperature=0.0)
    txt = raw.strip()
    # Try to parse JSON; if there's extra text, extract the first {...} block
    data = {}
    try:
        data = json.loads(txt)
    except Exception:
        # fallback: find first JSON object
        start = txt.find("{")
        end = txt.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                data = json.loads(txt[start:end+1])
            except Exception:
                data = {}
    if not data:
        return Hit(key=keydef.key, value="", page=0, evidence="", confidence=0.0)
    # Ensure fields
    for fld in ["key","value","page","evidence","confidence"]:
        data.setdefault(fld, "" if fld in ("key","value","evidence") else 0)
    return Hit(**data)

# ----------------------------
# Validation
# ----------------------------

def validate_hit(k: KeyDef, h: Hit) -> bool:
    if not h.value:
        return False
    t = k.type.lower()
    try:
        if t == "year":
            y = int(str(h.value).strip()[:4])
            return 1900 <= y <= 2100
        if t == "date":
            _ = dateparse(str(h.value), fuzzy=True)
            return True
        if t == "number":
            _ = float(str(h.value).replace(",","").strip())
            return True
        if t == "percent":
            _ = float(str(h.value).replace("%","").replace(",","").strip())
            return True
        if t == "ein":
            digits = "".join(ch for ch in str(h.value) if ch.isdigit())
            return len(digits) == 9
        return True
    except Exception:
        return False

# ----------------------------
# I/O
# ----------------------------

def write_outputs(outdir: str, hits: List[Hit]):
    out = [h.dict() for h in hits]
    out_json = Path(outdir) / "extraction_bedrock.json"
    out_csv = Path(outdir) / "extraction_bedrock.csv"
    Path(outdir).mkdir(parents=True, exist_ok=True)

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)

    import csv
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["key","value","page","evidence","confidence"])
        for h in hits:
            w.writerow([h.key, h.value, h.page, h.evidence, h.confidence])

    print(f"[OK] Wrote {out_json}")
    print(f"[OK] Wrote {out_csv}")

# ----------------------------
# Main
# ----------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True, help="Path to K-1 PDF (digital text)")
    ap.add_argument("--keys", required=True, help="Path to keys.json (<=100 keys)")
    ap.add_argument("--out", default="out_k1_bedrock", help="Output directory")
    ap.add_argument("--region", default="us-east-1", help="AWS region for Bedrock")
    ap.add_argument("--embed-model", default=DEFAULT_EMBED_MODEL, help="Bedrock embedding model ID")
    ap.add_argument("--llm-model", default=DEFAULT_LLM_MODEL, help="Bedrock chat model ID")
    ap.add_argument("--topk", type=int, default=3, help="Top-K chunks per key")
    args = ap.parse_args()

    # Load keys
    with open(args.keys, "r", encoding="utf-8") as f:
        key_list = json.load(f)
    keys = [KeyDef(**k) for k in key_list][:100]

    client = get_bedrock_client(args.region)

    print("[INFO] Chunking PDF...")
    chunks = chunk_pdf(args.pdf, max_chars=1200)
    print(f"[INFO] Total chunks: {len(chunks)}")

    print("[INFO] Building embedding index with Titan...")
    index = build_index(client, args.embed_model, chunks)

    hits: List[Hit] = []
    for k in keys:
        ctxs = retrieve_for_key(client, args.embed_model, index, k, top_k=args.topk)
        hit = llm_extract(client, args.llm_model, k, ctxs)
        if not validate_hit(k, hit):
            hit.confidence = min(hit.confidence, 0.2)
        hits.append(hit)

    write_outputs(args.out, hits)

if __name__ == "__main__":
    main()
